import logger from '@adonisjs/core/services/logger'
import immichConfig, { type ImmichConfig } from '#config/immich'

/** Immich ne répond pas, refuse de répondre, ou répond quelque chose qu'on refuse de lire. */
export class ImmichUnavailableError extends Error {}

/** La vignette d'un asset, déjà bornée en taille. */
export type ImmichThumbnail = {
  bytes: Buffer
  contentType: string
}

/**
 * L'UUID d'Immich, vérifié pour sa **forme**.
 *
 * ⚠️ Ce contrôle est une défense en profondeur, pas la garantie principale : l'identifiant finit
 * dans un chemin d'URL (`/api/assets/<id>/thumbnail`), et un identifiant fantaisiste y ferait de
 * la traversée de chemin. La garantie réelle est ailleurs — chaque appelant relit l'UUID **depuis
 * sa propre base** (`veille_items.dedup_key` côté veille, `coffre_entry_media.asset_id_cipher`
 * déchiffré côté coffre), jamais depuis une requête client. Celui-ci garantit qu'un identifiant
 * malformé n'entre pas en base au départ.
 */
const IMMICH_ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isImmichAssetId(value: unknown): value is string {
  return typeof value === 'string' && IMMICH_ASSET_ID.test(value)
}

/** Une réponse d'API qui dépasse ça n'est pas une réponse normale : c'est un incident. */
const MAX_JSON_BYTES = 16 * 1024 * 1024

/** Une vignette Immich pèse ~20 Ko. 10 Mo laisse toute la marge du monde à un `preview`. */
const MAX_THUMBNAIL_BYTES = 10 * 1024 * 1024

const USER_AGENT = 'command-center/1.0 (+agrégateur de veille personnel)'

/**
 * Le transport commun vers Immich (CC-55, remonté au core en CC-180).
 *
 * ⚠️ **Cette classe ne connaît RIEN du domaine veille** (albums, dédup, tags) ni du domaine coffre
 * (chiffrement). Elle ne porte que ce que DEUX modules détachables partagent : parler à une seule
 * instance Immich, sans jamais faire confiance à son statut HTTP seul.
 *
 * - `app/modules/veille/services/immich_client.ts` **étend** cette classe pour ajouter
 *   `albumAssets`/`trashDays`/`trashAssets`, propres à la collecte d'un album — ce sont ces
 *   méthodes-là qui ont une opinion sur le domaine veille (type `ImmichAsset`), pas le transport.
 * - `app/modules/coffre/controllers/coffre_media_controller.ts` injecte **cette classe telle
 *   quelle** : le coffre n'a besoin que de `thumbnail()`.
 *
 * ⚠️ **Aucune URL ne vient jamais d'une requête HTTP.** L'hôte est figé par `config/immich.ts`
 * (donc par l'environnement) ; l'identifiant d'asset d'un proxy de vignette est relu **depuis la
 * base de l'appelant** — jamais depuis le client. Il n'y a pas de cible à filtrer, il n'y a qu'une
 * cible.
 *
 * Ce qui reste à border, et qui est fait ici :
 *
 * 1. **Les redirections sont refusées** (`redirect: 'manual'`). Une API n'a pas de redirection
 *    légitime, et suivre un `Location` ferait sortir de l'hôte configuré.
 * 2. **Le `content-type` est vérifié**, et c'est le point qui fait ce client. Immich sert son
 *    interface en repli sur tout chemin inconnu : un `/api/...` qui ne correspond plus rend
 *    **200 avec du HTML**, pas une 404. Constaté sur l'instance réelle (via un double slash).
 * 3. **Deux plafonds**, taille et temps.
 *
 * Injecté par le conteneur pour que les tests le remplacent (`FakeImmichClient`) : aucun test ne
 * touche le réseau ni une vraie instance.
 */
export default class ImmichClient {
  constructor(protected config: ImmichConfig = immichConfig) {}

  /**
   * La version de l'instance.
   *
   * Elle ne sert pas à décider quoi que ce soit : elle sert à **échouer tôt et clairement**. Le
   * connecteur veille a été écrit contre la **v2.6.1**, et un changement de majeure est journalisé.
   */
  async serverVersion(): Promise<string> {
    const about = await this.getJson('/api/server/about')
    const version = typeof about.version === 'string' ? about.version : 'inconnue'

    if (!version.startsWith('v2.')) {
      logger.warn(
        { version },
        "L'instance Immich n'est pas en majeure 2 ; le connecteur a été écrit contre la " +
          'v2.6.1. Vérifie les routes avant de faire confiance à la réponse.'
      )
    }

    return version
  }

  /**
   * La vignette d'un asset, pour un proxy.
   *
   * ⚠️ **`assetId` doit venir de la base de l'appelant, jamais d'une requête.** Il est interpolé
   * dans un chemin d'URL : un identifiant venu du client permettrait d'atteindre n'importe quel
   * asset de la bibliothèque personnelle, servi par un serveur qui porte la clé API. Côté veille,
   * le contrôleur le lit dans `veille_items.dedup_key` ; côté coffre, il est déchiffré depuis
   * `coffre_entry_media.asset_id_cipher` avec la clé de session élevée. `isImmichAssetId` en
   * vérifie la forme des deux côtés.
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

  protected async getJson(path: string): Promise<Record<string, unknown>> {
    return this.readJson(await this.request(path, 'GET', null), path)
  }

  protected async postJson(path: string, body: unknown): Promise<Record<string, unknown>> {
    return this.readJson(await this.request(path, 'POST', body), path)
  }

  /**
   * Lit une réponse d'API — et vérifie **avant tout** que c'en est une.
   *
   * L'ordre compte : le statut d'abord (401 sur une clé révoquée, 400 sur un album inconnu),
   * puis le `content-type`. Un 200 en `text/html` est le cas vicieux — le serveur a répondu, et
   * il a l'air content.
   */
  protected async readJson(response: Response, path: string): Promise<Record<string, unknown>> {
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

  protected async request(
    path: string,
    method: 'GET' | 'POST' | 'DELETE',
    body: unknown
  ): Promise<Response> {
    if (!this.config.enabled) {
      throw new ImmichUnavailableError(
        'Immich n’est pas configuré : IMMICH_BASE_URL, IMMICH_API_KEY et IMMICH_ALBUM_ID ' +
          'doivent être définies dans l’environnement.'
      )
    }

    const headers: Record<string, string> = {
      'accept': method === 'GET' ? '*/*' : 'application/json',
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
  protected async drain(response: Response): Promise<void> {
    try {
      await response.body?.cancel()
    } catch {
      /* déjà fermé ou interrompu : rien à libérer */
    }
  }

  /** Lit le corps sans jamais dépasser le plafond — on compte les octets réellement reçus. */
  protected async readBounded(response: Response, maxBytes: number): Promise<Buffer> {
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
