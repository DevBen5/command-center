import { DateTime } from 'luxon'
import {
  ImmichUnavailableError,
  isImmichAssetId,
  type ImmichThumbnail,
} from '#core/shared/services/immich_client'
import coffreImmichConfig, { type CoffreImmichConfig } from '#config/coffre_immich'
import defaultSessionState, {
  ImmichSessionState,
} from '#modules/coffre/services/immich_session_state'

/** Une photo du dossier verrouillé, telle que le listing la rend. */
export interface ImmichLockedPhoto {
  assetId: string
}

export interface ImmichLockedFolder {
  photos: ImmichLockedPhoto[]
  /** `true` si le dossier porte plus de photos que ce que le plafond de pages a ramené. */
  truncated: boolean
}

/** Photos par page de `POST /api/search/metadata`. */
const PAGE_SIZE = 100

/**
 * ⚠️ **Plafond de PARCOURS, pas d'anomalie** — contrairement à `MAX_PAGES` côté veille (qui lève,
 * un album de collecte ne devant jamais dépasser quelques milliers d'assets). Un dossier verrouillé
 * personnel peut légitimement porter plus de photos que ça au fil des années : dépasser le plafond
 * n'est pas un défaut, `truncated` le dit à l'écran plutôt que de lever.
 */
const MAX_PAGES = 10

const MAX_JSON_BYTES = 16 * 1024 * 1024
const MAX_THUMBNAIL_BYTES = 10 * 1024 * 1024
const USER_AGENT = 'command-center/1.0 (+coffre, session Immich)'

/**
 * ⚠️ **La durée de réutilisation avant renouvellement PROACTIF n'est pas la durée de vie réelle
 * de la session côté Immich — elle est inconnue, non vérifiable depuis ce poste.** Elle borne
 * seulement la fréquence des logins en usage normal. Ce qui protège réellement contre une
 * expiration mid-parcours (jeton OU élévation PIN, indiscernables) est le retry unique sur 401/403
 * d'un appel de DONNÉES, dans `#withSession`.
 */
const SESSION_REUSE_MINUTES = 10

/**
 * Levée sur un 401/403 d'un appel de **données** (listing, vignette) — jamais sur un login ou un
 * déverrouillage, qui sont des échecs de configuration, non retentés. Déclenche l'unique reprise de
 * `#withSession`.
 */
class ImmichAuthExpiredError extends Error {}

/**
 * Le client de session Immich du coffre (CC-205) — login + élévation par PIN, pour lire le dossier
 * verrouillé qu'une clé d'API ne peut pas voir (`401 Elevated permission is required`, comportement
 * voulu d'Immich, issue immich-app/immich#20622 fermée « as not planned »).
 *
 * ⚠️ **Ne réutilise PAS `#core/shared/services/immich_client.ts`.** Le transport diffère sur le
 * point qui compte — l'en-tête d'authentification (`Authorization: Bearer` ici, `x-api-key`
 * là-bas) — et les endpoints (`/api/auth/login`, `/api/auth/session/unlock`) n'ont pas d'équivalent
 * dans le client partagé. Ce fichier duplique le hardening (redirections refusées, assertion de
 * content-type, plafonds de taille et de temps) plutôt que de le tordre pour un second mode d'auth
 * — un seul consommateur (le coffre), donc il reste local au module (`app/modules/coffre/CLAUDE.md`,
 * point 5 du ticket).
 *
 * ⚠️ **L'état (jeton, échéance) vit dans `immich_session_state.ts`, PAS sur `this`.** Cette classe
 * est résolue par le conteneur IoC (comme `ImmichClient`), donc reconstruite à chaque injection —
 * une instance neuve par requête. La statefulness qui permet la RÉUTILISATION entre requêtes vient
 * du singleton importé par défaut, jamais de l'instance.
 */
export default class ImmichSessionClient {
  constructor(
    protected config: CoffreImmichConfig = coffreImmichConfig,
    protected state: ImmichSessionState = defaultSessionState
  ) {}

  /** Les photos du dossier verrouillé — `null` si le module n'est pas configuré. */
  async lockedPhotos(): Promise<ImmichLockedFolder> {
    return this.#withSession((token) => this.#fetchLockedPhotos(token))
  }

  /** La vignette d'UN asset — l'appelant garantit qu'il est verrouillé ou que la clé d'API a échoué. */
  async thumbnail(assetId: string): Promise<ImmichThumbnail> {
    return this.#withSession((token) => this.#fetchThumbnail(token, assetId))
  }

  /**
   * Referme la session ouverte, si elle existe — appelé au renouvellement (« ferme ce que tu
   * ouvres ») et à l'arrêt du serveur (`CoffreProvider.shutdown`).
   */
  async closeSession(): Promise<void> {
    const token = this.state.clear()
    if (token !== null) await this.#logout(token)
  }

  /**
   * Assure une session valide, exécute `action`, et retente **une seule fois** — jamais en boucle —
   * si `action` signale une expiration en cours de route. Un second échec après la reprise remonte
   * tel quel : rejouer indéfiniment sur un PIN mal configuré martèlerait Immich sans jamais réussir.
   */
  async #withSession<T>(action: (token: string) => Promise<T>): Promise<T> {
    if (!this.config.enabled) {
      throw new ImmichUnavailableError(
        'Le dossier verrouillé Immich n’est pas configuré (COFFRE_IMMICH_EMAIL/PASSWORD/PIN).'
      )
    }

    const token = await this.#authorize()

    try {
      return await action(token)
    } catch (error) {
      if (!(error instanceof ImmichAuthExpiredError)) throw error

      // ⚠️ `reauthorize`, jamais `authorize` : le jeton qui vient d'échouer est encore marqué
      // « courant » selon notre propre échéance (`SESSION_REUSE_MINUTES` n'est pas forcément
      // écoulée) — `authorize` le rendrait tel quel sans rien renouveler. Voir
      // `ImmichSessionState.reauthorize` pour pourquoi il ne faut pas non plus `clear()` ici.
      const fresh = await this.state.reauthorize((stale) => this.#establish(stale))
      return action(fresh)
    }
  }

  async #authorize(now: DateTime = DateTime.now()): Promise<string> {
    return this.state.authorize(now, (stale) => this.#establish(stale))
  }

  async #establish(stale: string | null): Promise<{ accessToken: string; expiresAt: DateTime }> {
    if (stale !== null) await this.#logout(stale)

    const accessToken = await this.#login()
    await this.#unlock(accessToken)

    return { accessToken, expiresAt: DateTime.now().plus({ minutes: SESSION_REUSE_MINUTES }) }
  }

  async #login(): Promise<string> {
    const response = await this.#request(
      '/api/auth/login',
      'POST',
      { email: this.config.email, password: this.config.password },
      null
    )

    if (response.status === 401 || response.status === 403) {
      await this.#drain(response)
      throw new ImmichUnavailableError(
        `Immich a refusé les identifiants du dossier verrouillé (${response.status}) : ` +
          'vérifie COFFRE_IMMICH_EMAIL/COFFRE_IMMICH_PASSWORD.'
      )
    }

    const body = await this.#readJson(response, '/api/auth/login')
    const accessToken = body.accessToken

    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      throw new ImmichUnavailableError(
        'Immich n’a rendu aucun jeton de session sur /api/auth/login : l’API a peut-être changé.'
      )
    }

    return accessToken
  }

  async #unlock(accessToken: string): Promise<void> {
    const response = await this.#request(
      '/api/auth/session/unlock',
      'POST',
      { pinCode: this.config.pinCode },
      accessToken
    )

    if (!response.ok) {
      await this.#drain(response)
      throw new ImmichUnavailableError(
        `Immich a refusé le PIN du dossier verrouillé (${response.status}) : vérifie COFFRE_IMMICH_PIN.`
      )
    }

    await this.#drain(response)
  }

  /** Best-effort : une session qu'on n'arrive pas à fermer proprement n'empêche pas d'en ouvrir une
   * autre — elle expirera d'elle-même côté Immich. */
  async #logout(accessToken: string): Promise<void> {
    try {
      const response = await this.#request('/api/auth/logout', 'POST', null, accessToken)
      await this.#drain(response)
    } catch {
      /* rien à faire de plus : la nouvelle session part quand même */
    }
  }

  async #fetchLockedPhotos(accessToken: string): Promise<ImmichLockedFolder> {
    const photos: ImmichLockedPhoto[] = []
    let page: number | null = 1
    let truncated = false

    for (let visited = 0; page !== null; visited++) {
      if (visited >= MAX_PAGES) {
        truncated = true
        break
      }

      const response = await this.#request(
        '/api/search/metadata',
        'POST',
        { visibility: 'locked', page, size: PAGE_SIZE },
        accessToken
      )

      if (response.status === 401 || response.status === 403) {
        await this.#drain(response)
        throw new ImmichAuthExpiredError(
          `Immich a refusé la session (${response.status}) en listant le dossier verrouillé.`
        )
      }

      const body = await this.#readJson(response, '/api/search/metadata')
      const payload = body.assets
      if (typeof payload !== 'object' || payload === null) {
        throw new ImmichUnavailableError(
          "La réponse d'Immich ne porte pas de bloc « assets » sur /api/search/metadata : " +
            "l'API a probablement changé."
        )
      }

      const { items, nextPage } = payload as { items?: unknown; nextPage?: unknown }
      if (!Array.isArray(items)) {
        throw new ImmichUnavailableError(
          "La réponse d'Immich ne porte pas de liste « assets.items » sur /api/search/metadata."
        )
      }

      for (const raw of items) {
        const id = typeof raw === 'object' && raw !== null ? (raw as { id?: unknown }).id : null
        // Un asset illisible (identifiant malformé) est sauté, jamais deviné — même doctrine que
        // `parseAsset` côté veille.
        if (isImmichAssetId(id)) photos.push({ assetId: id })
      }

      // ⚠️ Comme `albumAssets()` côté veille : `nextPage` est rendu en CHAÎNE (`"2"`), un
      // `typeof === 'number'` arrêterait la pagination à la première page.
      page = nextPage === null || nextPage === undefined ? null : Number(nextPage)
      if (page !== null && !Number.isInteger(page)) {
        throw new ImmichUnavailableError(
          `Immich annonce une page suivante illisible (« ${String(nextPage)} ») sur /api/search/metadata.`
        )
      }
    }

    return { photos, truncated }
  }

  async #fetchThumbnail(accessToken: string, assetId: string): Promise<ImmichThumbnail> {
    const response = await this.#request(
      `/api/assets/${assetId}/thumbnail?size=thumbnail`,
      'GET',
      null,
      accessToken
    )

    if (response.status === 401 || response.status === 403) {
      await this.#drain(response)
      throw new ImmichAuthExpiredError(
        `Immich a refusé la session (${response.status}) pour la vignette de l'asset ${assetId}.`
      )
    }

    if (!response.ok) {
      await this.#drain(response)
      throw new ImmichUnavailableError(
        `Immich a répondu ${response.status} pour la vignette (session) de l'asset ${assetId}.`
      )
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) {
      await this.#drain(response)
      throw new ImmichUnavailableError(
        `Immich a rendu « ${contentType || 'aucun type'} » au lieu d'une image (session) : ` +
          'la route de vignette a probablement changé (Immich sert son interface en repli).'
      )
    }

    return {
      bytes: await this.#readBounded(response, MAX_THUMBNAIL_BYTES),
      contentType: contentType.split(';')[0].trim(),
    }
  }

  async #readJson(response: Response, path: string): Promise<Record<string, unknown>> {
    if (!response.ok) {
      await this.#drain(response)
      throw new ImmichUnavailableError(`Immich a répondu ${response.status} sur ${path}.`)
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) {
      await this.#drain(response)
      throw new ImmichUnavailableError(
        `Immich a répondu « ${contentType || 'aucun type'} » au lieu de JSON sur ${path} : ` +
          "c'est ce que renvoie son interface web sur un chemin inconnu (repli SPA)."
      )
    }

    const bytes = await this.#readBounded(response, MAX_JSON_BYTES)

    try {
      const parsed: unknown = JSON.parse(bytes.toString('utf8'))
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

  async #request(
    path: string,
    method: 'GET' | 'POST',
    body: unknown,
    accessToken: string | null
  ): Promise<Response> {
    if (!this.config.enabled) {
      throw new ImmichUnavailableError('Le dossier verrouillé Immich n’est pas configuré.')
    }

    const headers: Record<string, string> = {
      'accept': 'application/json',
      'user-agent': USER_AGENT,
    }
    if (body !== null) headers['content-type'] = 'application/json'
    // ⚠️ Le jeton ne sort d'ici que vers l'hôte configuré, et ne repart jamais vers le client.
    if (accessToken !== null) headers['authorization'] = `Bearer ${accessToken}`

    let response: Response
    try {
      response = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        headers,
        body: body === null ? undefined : JSON.stringify(body),
        // ⚠️ Comme le core : aucune redirection légitime pour une API, et la suivre ferait sortir
        // de l'hôte configuré avec le jeton dans les en-têtes.
        redirect: 'manual',
        signal: AbortSignal.timeout(this.config.timeoutMs),
      })
    } catch {
      throw new ImmichUnavailableError(
        `Immich (session) est injoignable ou n'a pas répondu en moins de ` +
          `${this.config.timeoutMs / 1000} s.`
      )
    }

    if (response.status >= 300 && response.status < 400) {
      await this.#drain(response)
      throw new ImmichUnavailableError(
        `Immich redirige (${response.status}) sur ${path} : la redirection n'est pas suivie.`
      )
    }

    return response
  }

  async #drain(response: Response): Promise<void> {
    try {
      await response.body?.cancel()
    } catch {
      /* déjà fermé ou interrompu : rien à libérer */
    }
  }

  async #readBounded(response: Response, maxBytes: number): Promise<Buffer> {
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) {
      await this.#drain(response)
      throw new ImmichUnavailableError(
        `Immich (session) annonce ${Math.round(declared / 1024 / 1024)} Mo, au-delà du plafond ` +
          `de ${Math.round(maxBytes / 1024 / 1024)} Mo.`
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
          `La réponse d'Immich (session) dépasse ${Math.round(maxBytes / 1024 / 1024)} Mo.`
        )
      }
      chunks.push(value)
    }

    return Buffer.concat(chunks)
  }
}
