import { Readable } from 'node:stream'
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

/** La nature d'un asset Immich, telle que le catalogue la range (CC-225). */
export type ImmichAssetNature = 'photo' | 'video' | 'other'

/**
 * Un asset du dossier verrouillé avec ses métadonnées de catalogue (CC-225) — bien plus riche
 * qu'`ImmichLockedPhoto`, qui ne sert que l'écran de sélection existant (CC-205).
 *
 * ⚠️ **Aucun champ hors `assetId` n'est vérifié contre une vraie instance Immich** — même limite
 * que le reste du client (voir le `CLAUDE.md` du module). Le parsing est défensif : un champ
 * absent ou malformé rend `null`, jamais une valeur devinée, jamais une exception qui ferait
 * échouer tout le lot pour un seul asset.
 */
export interface ImmichLockedCatalogAsset {
  assetId: string
  nature: ImmichAssetNature
  displayName: string | null
  capturedAt: DateTime | null
  sizeBytes: number | null
}

export interface ImmichLockedCatalogListing {
  assets: ImmichLockedCatalogAsset[]
  /** `true` si le dossier porte plus d'assets que `MAX_CATALOG_PAGES` n'en a ramené. */
  truncated: boolean
}

/**
 * Un flux vidéo relayé depuis Immich (CC-241) — **jamais tamponné en mémoire**, contrairement à une
 * vignette : un fichier de plusieurs gigaoctets ne passe pas par `#readBounded`.
 */
export interface ImmichVideoStream {
  /** 200, ou 206 quand Immich a honoré le `Range` transmis. */
  status: number
  contentType: string
  contentLength: string | null
  contentRange: string | null
  body: Readable
  /**
   * Coupe la requête vers Immich. ⚠️ **À appeler à la déconnexion du client** — c'est l'équivalent
   * exact, côté distant, du `SIGKILL` sur ffmpeg : sans ça, fermer l'onglet laisserait le serveur
   * continuer d'aspirer la vidéo depuis Immich jusqu'au dernier octet, pour personne.
   */
  abort(): void
}

/** `'IMAGE'`/`'VIDEO'` connus, tout le reste (absent, autre valeur) range en `'other'`. */
function immichNatureFor(type: unknown): ImmichAssetNature {
  if (type === 'IMAGE') return 'photo'
  if (type === 'VIDEO') return 'video'
  return 'other'
}

function immichDisplayNameFor(raw: Record<string, unknown>): string | null {
  const name = raw.originalFileName
  return typeof name === 'string' && name.length > 0 ? name : null
}

/** `fileCreatedAt`, à défaut `localDateTime`, à défaut `fileModifiedAt` — la première ISO valide. */
function immichCapturedAtFor(raw: Record<string, unknown>): DateTime | null {
  for (const field of ['fileCreatedAt', 'localDateTime', 'fileModifiedAt']) {
    const candidate = raw[field]
    if (typeof candidate !== 'string') continue

    const parsed = DateTime.fromISO(candidate)
    if (parsed.isValid) return parsed
  }

  return null
}

function immichSizeBytesFor(raw: Record<string, unknown>): number | null {
  const exif = raw.exifInfo
  if (typeof exif !== 'object' || exif === null) return null

  const size = (exif as Record<string, unknown>).fileSizeInByte
  const numeric =
    typeof size === 'number' ? size : typeof size === 'string' ? Number(size) : Number.NaN

  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null
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

/**
 * ⚠️ **Plafond D'INDEXATION, distinct de `MAX_PAGES` ci-dessus — décision du ticket CC-225.**
 * `MAX_PAGES` a été pensé pour une grille qu'un humain feuillette (10 pages, `truncated: true`
 * au-delà) ; l'indexation du catalogue doit au contraire pouvoir couvrir un dossier ENTIER, sans
 * quoi une énumération systématiquement tronquée empêcherait pour toujours le catalogue de
 * marquer quoi que ce soit absent sur un gros dossier (`catalog_source.ts` : une énumération
 * tronquée ne marque jamais rien absent). Cette valeur n'est donc PAS une borne réaliste pour un
 * dossier verrouillé personnel — c'est un garde-fou anti-boucle-infinie, au cas où `nextPage`
 * boucle sur lui-même par bug côté Immich, plusieurs ordres de grandeur au-dessus de ce qu'un
 * dossier personnel peut raisonnablement porter.
 */
const MAX_CATALOG_PAGES = 1000

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

  /**
   * Les assets du dossier verrouillé avec leurs métadonnées de catalogue (CC-225) — même
   * session/auth/reprise que `lockedPhotos()` (`#withSession`), mais une pagination SÉPARÉE
   * (`#fetchLockedAssetsForCatalog`, plafond `MAX_CATALOG_PAGES`) : ne touche pas au chemin
   * existant de l'écran de sélection.
   */
  async lockedAssetsForCatalog(): Promise<ImmichLockedCatalogListing> {
    return this.#withSession((token) => this.#fetchLockedAssetsForCatalog(token))
  }

  /** La vignette d'UN asset — l'appelant garantit qu'il est verrouillé ou que la clé d'API a échoué. */
  async thumbnail(assetId: string): Promise<ImmichThumbnail> {
    return this.#withSession((token) => this.#fetchThumbnail(token, assetId))
  }

  /**
   * Le flux vidéo d'UN asset du dossier verrouillé (CC-241).
   *
   * ⚠️ **`/video/playback`, PAS `/original` — et ce choix est le cœur de la décision côté Immich.**
   * C'est le point d'accès que le lecteur d'Immich utilise lui-même : il sert la version transcodée
   * (H.264) qu'Immich a déjà produite, ou l'original quand il est déjà lisible. Autrement dit, **le
   * transcodage HEVC est fait par Immich, pas par nous** — ce qui évite d'avoir à faire lire un
   * flux HTTP distant à ffmpeg, donc à poser le jeton de session dans l'`argv` d'un processus (où
   * `ps` le lit). Le transcodage maison de ce lot reste réservé aux fichiers LOCAUX du NAS, les
   * seuls où ffmpeg peut ouvrir un descripteur de fichier et se déplacer dedans.
   *
   * ⚠️ **AUCUNE vérification live n'a été possible pour ce chemin** : l'instance Immich du
   * propriétaire répond 502 sur `/api/auth/login` au moment d'écrire ceci, donc la source
   * `immich_locked` est vide en base. Il est couvert par un double de test, pas par une mesure —
   * voir le `CLAUDE.md` du module, « Ce que ce lot ne prouve pas ».
   */
  async videoPlayback(assetId: string, range: string | null): Promise<ImmichVideoStream> {
    return this.#withSession((token) => this.#fetchVideoPlayback(token, assetId, range))
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

  /**
   * Pagination SÉPARÉE de `#fetchLockedPhotos` — même endpoint, même forme de réponse, mais un
   * plafond différent (`MAX_CATALOG_PAGES`) et une extraction de métadonnées bien plus riche.
   * Dupliquée plutôt que factorisée avec `#fetchLockedPhotos` : les deux boucles ne partagent que
   * la requête HTTP, pas le mapping ni le plafond, et ce fichier est sensible (sécurité, session
   * partagée) — minimiser le remaniement du chemin existant réduit le risque de régression sur un
   * comportement déjà en production, pour un gain de factorisation marginal sur une douzaine de
   * lignes.
   */
  async #fetchLockedAssetsForCatalog(accessToken: string): Promise<ImmichLockedCatalogListing> {
    const assets: ImmichLockedCatalogAsset[] = []
    let page: number | null = 1
    let truncated = false

    for (let visited = 0; page !== null; visited++) {
      if (visited >= MAX_CATALOG_PAGES) {
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
          `Immich a refusé la session (${response.status}) en indexant le dossier verrouillé.`
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
        if (typeof raw !== 'object' || raw === null) continue
        const record = raw as Record<string, unknown>

        // Même doctrine que #fetchLockedPhotos : un identifiant illisible est sauté, jamais
        // deviné. Les autres champs, eux, retombent sur `null`/`'other'` plutôt que de faire
        // échouer tout le lot pour un seul asset aux métadonnées incomplètes.
        if (!isImmichAssetId(record.id)) continue

        assets.push({
          assetId: record.id,
          nature: immichNatureFor(record.type),
          displayName: immichDisplayNameFor(record),
          capturedAt: immichCapturedAtFor(record),
          sizeBytes: immichSizeBytesFor(record),
        })
      }

      // ⚠️ Comme #fetchLockedPhotos : `nextPage` est rendu en CHAÎNE (`"2"`).
      page = nextPage === null || nextPage === undefined ? null : Number(nextPage)
      if (page !== null && !Number.isInteger(page)) {
        throw new ImmichUnavailableError(
          `Immich annonce une page suivante illisible (« ${String(nextPage)} ») sur /api/search/metadata.`
        )
      }
    }

    return { assets, truncated }
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

  async #fetchVideoPlayback(
    accessToken: string,
    assetId: string,
    range: string | null
  ): Promise<ImmichVideoStream> {
    // ⚠️ Un contrôleur d'abandon PROPRE à cette requête, jamais le délai d'expiration partagé :
    // voir le commentaire de `#request`. C'est aussi lui que l'appelant coupe à la déconnexion.
    const controller = new AbortController()

    const response = await this.#request(
      `/api/assets/${assetId}/video/playback`,
      'GET',
      null,
      accessToken,
      {
        headers: {
          accept: 'video/*,*/*;q=0.8',
          // Le `Range` du navigateur est transmis TEL QUEL et la réponse d'Immich relayée telle
          // quelle : c'est lui qui sait la taille du fichier transcodé, pas nous.
          ...(range === null ? {} : { range }),
        },
        signal: controller.signal,
      }
    )

    if (response.status === 401 || response.status === 403) {
      await this.#drain(response)
      throw new ImmichAuthExpiredError(
        `Immich a refusé la session (${response.status}) pour la vidéo de l'asset ${assetId}.`
      )
    }

    if (!response.ok && response.status !== 206) {
      await this.#drain(response)
      throw new ImmichUnavailableError(
        `Immich a répondu ${response.status} pour la vidéo (session) de l'asset ${assetId}.`
      )
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.startsWith('video/')) {
      await this.#drain(response)
      throw new ImmichUnavailableError(
        `Immich a rendu « ${contentType || 'aucun type'} » au lieu d'une vidéo (session) : ` +
          'la route de lecture a probablement changé (Immich sert son interface en repli).'
      )
    }

    if (response.body === null) {
      throw new ImmichUnavailableError(
        `Immich a rendu une réponse sans corps pour la vidéo de l'asset ${assetId}.`
      )
    }

    return {
      status: response.status,
      contentType: contentType.split(';')[0].trim(),
      contentLength: response.headers.get('content-length'),
      contentRange: response.headers.get('content-range'),
      body: Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      abort: () => controller.abort(),
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

  /**
   * ⚠️ **`extra.signal` remplace le délai d'expiration par défaut, et c'est réservé au flux vidéo
   * (CC-241).** `AbortSignal.timeout` couvre la requête ENTIÈRE, corps compris : sur une vidéo, il
   * couperait la lecture au bout de `IMMICH_TIMEOUT_MS`, en plein milieu, sans erreur exploitable.
   * Tous les autres appels gardent le délai — ils rendent du JSON ou une vignette bornée, où une
   * réponse qui traîne est une panne, pas un usage normal.
   */
  async #request(
    path: string,
    method: 'GET' | 'POST',
    body: unknown,
    accessToken: string | null,
    extra: { headers?: Record<string, string>; signal?: AbortSignal } = {}
  ): Promise<Response> {
    if (!this.config.enabled) {
      throw new ImmichUnavailableError('Le dossier verrouillé Immich n’est pas configuré.')
    }

    const headers: Record<string, string> = {
      'accept': 'application/json',
      'user-agent': USER_AGENT,
      ...(extra.headers ?? {}),
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
        signal: extra.signal ?? AbortSignal.timeout(this.config.timeoutMs),
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
