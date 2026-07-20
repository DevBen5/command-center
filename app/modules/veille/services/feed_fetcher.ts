import dns from 'node:dns/promises'
import { isBlockedAddress, isPublicFeedUrl } from '#modules/veille/validators/veille'

/** Un flux ne répond pas, refuse de répondre, ou répond quelque chose qu'on refuse de lire. */
export class FeedUnavailableError extends Error {}

export type FeedResponse =
  | { status: 'not-modified' }
  | { status: 'ok'; body: string; etag: string | null; lastModified: string | null }

/** Ce qu'on renvoie au serveur pour espérer un 304 et s'épargner un re-parse. */
export type ConditionalHeaders = {
  etag?: string | null
  lastModified?: string | null
}

/** Un flux qui met plus de 10 s à répondre est un flux en panne. */
const TIMEOUT_MS = 10_000

/**
 * Un flux qui dépasse 5 Mo n'est plus un flux. Sans ce plafond, une réponse géante emporte le
 * processus — et l'agrégateur avec.
 */
const MAX_BYTES = 5 * 1024 * 1024

/**
 * Trois sauts. Les refuser tous, comme le fait le client LLM, casserait beaucoup de flux
 * légitimes : http→https, changement de domaine, FeedBurner. Mais chaque `Location` repasse la
 * garde **en entier** — c'est là qu'est le vrai risque. L'utilisateur saisit une URL publique ;
 * c'est le serveur distant qui choisit la redirection, et rien ne l'empêche de viser
 * `169.254.169.254`.
 */
const MAX_REDIRECTS = 3

const USER_AGENT = 'command-center/1.0 (+agrégateur de veille personnel)'

/**
 * Le seul point du module qui parle au réseau.
 *
 * ⚠️ `rss-parser` sait télécharger tout seul (`parseURL`) : **ne l'utilise jamais**. Sa méthode
 * réseau contourne cette garde et suit les redirections sans rien vérifier. Le parseur ne doit
 * voir que du XML déjà rapatrié ici.
 *
 * Injecté par le conteneur pour que les tests le remplacent (`FakeFeedFetcher`) : aucun test ne
 * touche le réseau.
 */
export default class FeedFetcher {
  async fetch(feedUrl: string, conditional: ConditionalHeaders = {}): Promise<FeedResponse> {
    // Une seule échéance pour toute l'opération, redirections comprises : trois sauts à 10 s
    // chacun feraient une requête de 30 s.
    const deadline = AbortSignal.timeout(TIMEOUT_MS)

    let current = feedUrl

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await this.assertReachableTarget(current)

      const response = await this.request(current, conditional, deadline)

      if (response.status === 304) {
        await this.drain(response)
        return { status: 'not-modified' }
      }

      if (response.status >= 300 && response.status < 400) {
        // ⚠️ Drainé **avant** `nextHop`, qui lève sur trois cas (pas de `Location`, `Location`
        // illisible, chaîne trop longue). Dans l'autre ordre, la libération serait sautée
        // précisément sur les chemins d'échec — les plus fréquents chez un agrégateur. Les
        // en-têtes, eux, restent lisibles après `cancel()`.
        await this.drain(response)
        current = this.nextHop(response, current, hop)
        continue
      }

      if (!response.ok) {
        await this.drain(response)
        throw new FeedUnavailableError(
          `Le flux a répondu ${response.status} ${response.statusText}.`.trim()
        )
      }

      return {
        status: 'ok',
        body: await this.readBounded(response),
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
      }
    }

    throw new FeedUnavailableError(
      `Le flux enchaîne plus de ${MAX_REDIRECTS} redirections : la chaîne n'est pas suivie plus loin.`
    )
  }

  /**
   * Vérifie l'URL **et** les adresses derrière son nom.
   *
   * Le contrôle de forme ne suffit pas : `flux.example.com` peut parfaitement pointer sur
   * `127.0.0.1`. On résout donc, et on refuse dès qu'**une** des adresses est interdite — un nom
   * qui répond à la fois du public et du privé n'est pas un flux de bonne foi.
   *
   * ⚠️ `protected` et non `private` : c'est une **couture de test**, et elle est nécessaire.
   * Cette garde refuse le loopback — donc un serveur jetable sur `127.0.0.1` est rejeté avant
   * la moindre requête, et la mécanique des redirections deviendrait intestable. Le test
   * (`veille_feed_redirect.spec.ts`) l'assouplit pour le **premier** saut uniquement, et laisse
   * la garde réelle juger la cible du `Location` — ce qui est précisément la propriété à prouver.
   * N'assouplis jamais cette méthode dans le code de production.
   */
  protected async assertReachableTarget(rawUrl: string): Promise<void> {
    if (!isPublicFeedUrl(rawUrl)) {
      throw new FeedUnavailableError(
        `L'adresse ${rawUrl} n'est pas une cible publique autorisée (adresse locale, privée, ` +
          `lien-local, ou protocole non http(s)).`
      )
    }

    const { hostname } = new URL(rawUrl)

    // Une IP littérale a déjà été vérifiée par `isPublicFeedUrl` : pas de DNS à faire.
    if (isBlockedAddress(hostname)) return

    let addresses: { address: string }[]
    try {
      addresses = await dns.lookup(hostname, { all: true })
    } catch {
      throw new FeedUnavailableError(`Le nom ${hostname} ne se résout pas.`)
    }

    const blocked = addresses.find((entry) => isBlockedAddress(entry.address))
    if (blocked) {
      throw new FeedUnavailableError(
        `Le nom ${hostname} pointe sur une adresse interne (${blocked.address}) : requête refusée.`
      )
    }
  }

  private async request(
    rawUrl: string,
    conditional: ConditionalHeaders,
    deadline: AbortSignal
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'accept':
        'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
      'user-agent': USER_AGENT,
    }
    // La politesse minimale envers un serveur qu'on interroge toutes les heures.
    if (conditional.etag) headers['if-none-match'] = conditional.etag
    if (conditional.lastModified) headers['if-modified-since'] = conditional.lastModified

    try {
      return await fetch(rawUrl, {
        method: 'GET',
        headers,
        // ⚠️ Le défaut d'undici est `follow` (20 sauts, sans aucune vérification) : ce choix
        // s'écrit, il ne s'hérite pas. Les 3xx sont traités à la main, cf. `nextHop`.
        redirect: 'manual',
        signal: deadline,
      })
    } catch {
      throw new FeedUnavailableError(
        `Le flux est injoignable ou n'a pas répondu en moins de ${TIMEOUT_MS / 1000} s.`
      )
    }
  }

  /**
   * Libère la connexion quand on ne lira pas le corps.
   *
   * Tant qu'un corps n'est pas drainé, undici garde la connexion dans son pool. Et les réponses
   * qu'on ne lit pas sont justement les plus fréquentes ici : redirections, 404, 500, 304.
   *
   * L'échec du `cancel` est avalé **à dessein** : le flux a pu être interrompu par l'échéance,
   * auquel cas il est déjà mort. C'est du nettoyage — il n'y a rien à rattraper, et rien à dire.
   */
  private async drain(response: Response): Promise<void> {
    try {
      await response.body?.cancel()
    } catch {
      /* déjà fermé ou interrompu : rien à libérer */
    }
  }

  /** Valide et résout la cible d'une redirection. La garde est rejouée au tour de boucle suivant. */
  private nextHop(response: Response, from: string, hop: number): string {
    if (hop === MAX_REDIRECTS) {
      throw new FeedUnavailableError(
        `Le flux enchaîne plus de ${MAX_REDIRECTS} redirections : la chaîne n'est pas suivie plus loin.`
      )
    }

    const location = response.headers.get('location')
    if (!location) {
      throw new FeedUnavailableError(
        `Le flux a répondu ${response.status} sans en-tête « Location » : redirection inexploitable.`
      )
    }

    try {
      // Une `Location` relative est licite (RFC 7231) et doit être résolue contre l'URL courante.
      return new URL(location, from).toString()
    } catch {
      throw new FeedUnavailableError(
        `Le flux redirige vers une adresse illisible (« ${location} »).`
      )
    }
  }

  /**
   * Lit le corps sans jamais dépasser le plafond.
   *
   * `content-length` sert de raccourci quand il est là — mais il est déclaratif : on compte les
   * octets réellement reçus de toute façon.
   */
  private async readBounded(response: Response): Promise<string> {
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      throw new FeedUnavailableError(
        `Le flux annonce ${Math.round(declared / 1024 / 1024)} Mo, au-delà du plafond de ` +
          `${MAX_BYTES / 1024 / 1024} Mo : il n'est pas lu.`
      )
    }

    const reader = response.body?.getReader()
    if (!reader) return ''

    const chunks: Uint8Array[] = []
    let total = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      total += value.byteLength
      if (total > MAX_BYTES) {
        await reader.cancel()
        throw new FeedUnavailableError(
          `Le flux dépasse le plafond de ${MAX_BYTES / 1024 / 1024} Mo : la lecture est interrompue.`
        )
      }
      chunks.push(value)
    }

    return this.decode(Buffer.concat(chunks), response.headers.get('content-type'))
  }

  /**
   * Décode selon le `charset` annoncé. Beaucoup de flux francophones anciens sont encore en
   * ISO-8859-1 : les décoder en UTF-8 remplirait les titres de caractères de remplacement.
   */
  private decode(bytes: Buffer, contentType: string | null): string {
    const declared = contentType?.match(/charset=["']?([\w-]+)/i)?.[1]

    if (declared) {
      try {
        return new TextDecoder(declared).decode(bytes)
      } catch {
        // Étiquette de charset inconnue : on retombe sur UTF-8 plutôt que d'échouer.
      }
    }

    return new TextDecoder('utf-8').decode(bytes)
  }
}
