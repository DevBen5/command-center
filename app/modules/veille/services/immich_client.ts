import logger from '@adonisjs/core/services/logger'
import immichConfig, { type ImmichConfig } from '#config/immich'
import { parseAsset, type ImmichAsset } from '#modules/veille/services/immich_asset'

/** Immich ne répond pas, refuse de répondre, ou répond quelque chose qu'on refuse de lire. */
export class ImmichUnavailableError extends Error {}

/** La vignette d'un asset, déjà bornée en taille. */
export type ImmichThumbnail = {
  bytes: Buffer
  contentType: string
}

/**
 * Assets par page. Immich pagine `search/metadata` et rend `nextPage` : 250 tient dans une
 * réponse raisonnable tout en évitant une dizaine d'aller-retours sur un album fourni.
 */
const PAGE_SIZE = 250

/**
 * ⚠️ **Le plafond de pages est un garde-fou de boucle, pas une limite de volumétrie.** Si une
 * version d'Immich rendait un `nextPage` qui n'avance pas, la collecte tournerait indéfiniment
 * en tenant la boucle du planificateur. 40 pages = 10 000 assets, très au-delà d'un album de
 * veille — l'atteindre est un défaut, et c'est signalé comme tel.
 */
const MAX_PAGES = 40

/** Une réponse d'API qui dépasse ça n'est pas une liste d'album : c'est un incident. */
const MAX_JSON_BYTES = 16 * 1024 * 1024

/** Une vignette Immich pèse ~20 Ko. 10 Mo laisse toute la marge du monde à un `preview`. */
const MAX_THUMBNAIL_BYTES = 10 * 1024 * 1024

const USER_AGENT = 'command-center/1.0 (+agrégateur de veille personnel)'

/**
 * Le seul point du module qui parle à Immich.
 *
 * ⚠️ **Aucune URL ne vient jamais d'une requête HTTP.** L'hôte est figé par `config/immich.ts`
 * (donc par l'environnement), l'album aussi, et l'identifiant d'asset du proxy de vignette est
 * relu **depuis notre base**. C'est ce qui remplace la liste blanche de `feed_fetcher` : il n'y a
 * pas de cible à filtrer, il n'y a qu'une cible.
 *
 * Ce qui reste à border, et qui est fait ici :
 *
 * 1. **Les redirections sont refusées** (`redirect: 'manual'`). Comme le client LLM et
 *    contrairement au collecteur RSS : une API n'a pas de redirection légitime, et suivre un
 *    `Location` ferait sortir de l'hôte configuré — le seul moyen qu'aurait un tiers de
 *    détourner ces requêtes.
 * 2. **Le `content-type` est vérifié**, et c'est le point qui fait ce client. Immich sert son
 *    interface en repli sur tout chemin inconnu : un `/api/...` qui ne correspond plus rend
 *    **200 avec du HTML**, pas une 404. Constaté sur l'instance réelle (via un double slash).
 *    Sans ce contrôle, une rupture d'API se lirait « album vide » — et le marquage des assets
 *    disparus viderait la veille en une passe.
 * 3. **Deux plafonds**, taille et temps, comme le fetcher de flux.
 *
 * Injecté par le conteneur pour que les tests le remplacent (`FakeImmichClient`) : aucun test
 * ne touche le réseau ni une vraie instance.
 */
export default class ImmichClient {
  constructor(private config: ImmichConfig = immichConfig) {}

  /**
   * La version de l'instance, interrogée avant chaque passe.
   *
   * Elle ne sert pas à décider quoi que ce soit : elle sert à **échouer tôt et clairement**. Le
   * ticket le demande explicitement — une rupture d'API doit se lire comme une erreur, pas comme
   * un album vide. Un changement de majeure est journalisé : le module a été écrit contre la
   * **v2.6.1**, et c'est la seule chose qu'on sache vraiment.
   */
  async serverVersion(): Promise<string> {
    const about = await this.getJson('/api/server/about')
    const version = typeof about.version === 'string' ? about.version : 'inconnue'

    if (!version.startsWith('v2.')) {
      logger.warn(
        { version },
        "L'instance Immich n'est pas en majeure 2 ; le connecteur de veille a été écrit " +
          'contre la v2.6.1. Vérifie les routes avant de faire confiance à la collecte.'
      )
    }

    return version
  }

  /**
   * Tous les assets de l'album de veille.
   *
   * ⚠️ **Tout ou rien.** La moindre page en échec fait lever : l'appelant ne reçoit **jamais**
   * une liste partielle. C'est ce qui rend sûr le marquage des assets disparus, qui se calcule
   * par différence — une liste tronquée ferait marquer « plus dans l'album » des dizaines
   * d'assets parfaitement présents, sans qu'aucune erreur ne s'affiche.
   */
  async albumAssets(): Promise<ImmichAsset[]> {
    const assets: ImmichAsset[] = []
    let page: number | null = 1

    for (let visited = 0; page !== null; visited++) {
      if (visited >= MAX_PAGES) {
        throw new ImmichUnavailableError(
          `L'album Immich dépasse ${MAX_PAGES} pages de ${PAGE_SIZE} assets : la collecte ` +
            's’arrête là plutôt que de boucler.'
        )
      }

      const body = await this.postJson('/api/search/metadata', {
        albumIds: [this.config.albumId],
        page,
        size: PAGE_SIZE,
      })

      const payload = body.assets
      if (typeof payload !== 'object' || payload === null) {
        throw new ImmichUnavailableError(
          "La réponse d'Immich ne porte pas de bloc « assets » : l'API a probablement changé."
        )
      }

      const { items, nextPage } = payload as { items?: unknown; nextPage?: unknown }
      if (!Array.isArray(items)) {
        throw new ImmichUnavailableError(
          "La réponse d'Immich ne porte pas de liste « assets.items » : l'API a probablement changé."
        )
      }

      for (const raw of items) {
        // Un asset illisible (type audio, identifiant malformé) est sauté, jamais deviné.
        const asset = parseAsset(raw)
        if (asset) assets.push(asset)
      }

      // ⚠️ Immich rend `nextPage` en **chaîne** (`"2"`), pas en nombre. Un `typeof === 'number'`
      // arrêterait la pagination à la première page, en silence, et l'album paraîtrait tronqué.
      page = nextPage === null || nextPage === undefined ? null : Number(nextPage)
      if (page !== null && !Number.isInteger(page)) {
        throw new ImmichUnavailableError(
          `Immich annonce une page suivante illisible (« ${String(nextPage)} »).`
        )
      }
    }

    return assets
  }

  /**
   * La vignette d'un asset, pour le proxy.
   *
   * ⚠️ **`assetId` doit venir de notre base, jamais d'une requête.** Il est interpolé dans un
   * chemin d'URL : un identifiant venu du client permettrait d'atteindre n'importe quel asset de
   * la bibliothèque personnelle, servi par un serveur qui porte la clé API. Le contrôleur le lit
   * dans `veille_items.dedup_key` ; `isImmichAssetId` en vérifie la forme des deux côtés.
   */
  async thumbnail(assetId: string): Promise<ImmichThumbnail> {
    const response = await this.request(
      `/api/assets/${assetId}/thumbnail?size=thumbnail`,
      'GET',
      null
    )

    if (!response.ok) {
      await this.drain(response)
      throw new ImmichUnavailableError(
        `Immich a répondu ${response.status} pour la vignette de l'asset ${assetId}.`
      )
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) {
      await this.drain(response)
      throw new ImmichUnavailableError(
        `Immich a rendu « ${contentType || 'aucun type'} » au lieu d'une image : ` +
          'la route de vignette a probablement changé (Immich sert son interface en repli).'
      )
    }

    return {
      bytes: await this.readBounded(response, MAX_THUMBNAIL_BYTES),
      // Le type réel d'Immich (`image/webp`), jamais une valeur devinée : c'est lui qu'on
      // restitue au navigateur.
      contentType: contentType.split(';')[0].trim(),
    }
  }

  private async getJson(path: string): Promise<Record<string, unknown>> {
    return this.readJson(await this.request(path, 'GET', null), path)
  }

  private async postJson(path: string, body: unknown): Promise<Record<string, unknown>> {
    return this.readJson(await this.request(path, 'POST', body), path)
  }

  /**
   * Lit une réponse d'API — et vérifie **avant tout** que c'en est une.
   *
   * L'ordre compte : le statut d'abord (401 sur une clé révoquée, 400 sur un album inconnu),
   * puis le `content-type`. Un 200 en `text/html` est le cas vicieux — le serveur a répondu, et
   * il a l'air content.
   */
  private async readJson(response: Response, path: string): Promise<Record<string, unknown>> {
    if (response.status === 401 || response.status === 403) {
      await this.drain(response)
      throw new ImmichUnavailableError(
        `Immich a refusé la clé d'API (${response.status}) sur ${path} : vérifie IMMICH_API_KEY.`
      )
    }

    if (!response.ok) {
      await this.drain(response)
      throw new ImmichUnavailableError(
        `Immich a répondu ${response.status} sur ${path}. ⚠️ Un album ou un asset inconnu rend ` +
          '400, pas 404 : vérifie IMMICH_ALBUM_ID.'
      )
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) {
      await this.drain(response)
      throw new ImmichUnavailableError(
        `Immich a répondu « ${contentType || 'aucun type'} » au lieu de JSON sur ${path}. ` +
          "C'est ce que renvoie son interface web sur un chemin inconnu : la route a changé, " +
          "ou IMMICH_BASE_URL ne pointe pas sur l'API."
      )
    }

    const bytes = await this.readBounded(response, MAX_JSON_BYTES)
    const raw = bytes.toString('utf8')

    try {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null) {
        throw new TypeError('la réponse JSON n’est pas un objet')
      }
      return parsed as Record<string, unknown>
    } catch (error) {
      throw new ImmichUnavailableError(
        `La réponse d'Immich sur ${path} est annoncée en JSON mais ne se lit pas : ` +
          `${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  private async request(path: string, method: 'GET' | 'POST', body: unknown): Promise<Response> {
    if (!this.config.enabled) {
      throw new ImmichUnavailableError(
        'Immich n’est pas configuré : IMMICH_BASE_URL, IMMICH_API_KEY et IMMICH_ALBUM_ID ' +
          'doivent être définies dans l’environnement.'
      )
    }

    const headers: Record<string, string> = {
      'accept': method === 'POST' ? 'application/json' : '*/*',
      'user-agent': USER_AGENT,
      // ⚠️ La clé ne sort d'ici que vers l'hôte configuré, et ne repart jamais vers le client.
      'x-api-key': this.config.apiKey,
    }
    if (body !== null) headers['content-type'] = 'application/json'

    let response: Response
    try {
      response = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        headers,
        body: body === null ? undefined : JSON.stringify(body),
        // ⚠️ Le défaut d'undici est `follow` (20 sauts, sans vérification) : ce choix s'écrit,
        // il ne s'hérite pas. Une API n'a aucune redirection légitime, et la suivre ferait
        // sortir de l'hôte configuré — avec la clé d'API dans les en-têtes.
        redirect: 'manual',
        signal: AbortSignal.timeout(this.config.timeoutMs),
      })
    } catch {
      throw new ImmichUnavailableError(
        `Immich est injoignable ou n'a pas répondu en moins de ${this.config.timeoutMs / 1000} s.`
      )
    }

    if (response.status >= 300 && response.status < 400) {
      await this.drain(response)
      throw new ImmichUnavailableError(
        `Immich redirige (${response.status}) sur ${path} : la redirection n'est pas suivie. ` +
          'Vérifie IMMICH_BASE_URL — un mandataire qui force https redirige souvent une base http.'
      )
    }

    return response
  }

  /**
   * Libère la connexion quand on ne lira pas le corps. Tant qu'un corps n'est pas drainé, undici
   * garde la connexion dans son pool — et les réponses qu'on ne lit pas sont les plus fréquentes
   * sur les chemins d'échec.
   */
  private async drain(response: Response): Promise<void> {
    try {
      await response.body?.cancel()
    } catch {
      /* déjà fermé ou interrompu : rien à libérer */
    }
  }

  /** Lit le corps sans jamais dépasser le plafond — on compte les octets réellement reçus. */
  private async readBounded(response: Response, maxBytes: number): Promise<Buffer> {
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) {
      await this.drain(response)
      throw new ImmichUnavailableError(
        `Immich annonce ${Math.round(declared / 1024 / 1024)} Mo, au-delà du plafond de ` +
          `${Math.round(maxBytes / 1024 / 1024)} Mo : la réponse n'est pas lue.`
      )
    }

    const reader = response.body?.getReader()
    if (!reader) return Buffer.alloc(0)

    const chunks: Uint8Array[] = []
    let total = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new ImmichUnavailableError(
          `La réponse d'Immich dépasse ${Math.round(maxBytes / 1024 / 1024)} Mo : ` +
            'la lecture est interrompue.'
        )
      }
      chunks.push(value)
    }

    return Buffer.concat(chunks)
  }
}
