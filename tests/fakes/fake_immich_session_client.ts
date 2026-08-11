import { Readable } from 'node:stream'
import ImmichSessionClient, {
  type ImmichLockedCatalogListing,
  type ImmichLockedFolder,
  type ImmichVideoStream,
} from '#modules/coffre/services/immich_session_client'
import { ImmichUnavailableError, type ImmichThumbnail } from '#core/shared/services/immich_client'

/** Ce que le dossier verrouillé rend : un contenu, ou une erreur à lever. */
export type LockedFolderScript = ImmichLockedFolder | Error

/** Ce que le listing de catalogue rend (CC-225) : un contenu, ou une erreur à lever. */
export type LockedCatalogScript = ImmichLockedCatalogListing | Error

/**
 * Le faux client de session Immich (CC-205) : **aucun test ne touche le réseau**, sur le patron de
 * `FakeImmichClient`.
 *
 * Il hérite du vrai pour être substituable au type via `app.container.swap`, et remplace la couche
 * **API** (`lockedPhotos`, `thumbnail`) tout entière — pas le transport, ni la coordination des
 * sessions. Ces deux-là ont leur propre test (`tests/unit/coffre_immich_session_client.spec.ts`),
 * qui remplace `fetch` : c'est là que se prouvent le login, l'élévation par PIN, la reprise sur
 * expiration et la fermeture de session. Ce qui se prouve avec ce faux, c'est ce que les
 * CONTRÔLEURS du coffre font d'un succès et d'un échec de cette couche.
 */
export default class FakeImmichSessionClient extends ImmichSessionClient {
  /** Les identifiants dont la vignette a été demandée, dans l'ordre. */
  readonly thumbnailed: string[] = []

  constructor(
    private folder: LockedFolderScript = { photos: [], truncated: false },
    private catalog: LockedCatalogScript = { assets: [], truncated: false }
  ) {
    super()
  }

  setFolder(folder: LockedFolderScript): void {
    this.folder = folder
  }

  /** Script du listing de catalogue (CC-225) — indépendant de `setFolder`, même en production. */
  setCatalog(catalog: LockedCatalogScript): void {
    this.catalog = catalog
  }

  async lockedPhotos(): Promise<ImmichLockedFolder> {
    if (this.folder instanceof Error) throw this.folder
    return this.folder
  }

  async lockedAssetsForCatalog(): Promise<ImmichLockedCatalogListing> {
    if (this.catalog instanceof Error) throw this.catalog
    return this.catalog
  }

  async thumbnail(assetId: string): Promise<ImmichThumbnail> {
    this.thumbnailed.push(assetId)

    const known =
      !(this.folder instanceof Error) &&
      this.folder.photos.some((photo) => photo.assetId === assetId)
    if (!known) {
      throw new ImmichUnavailableError(`Aucune vignette scriptée (session) pour ${assetId}.`)
    }

    return { bytes: Buffer.from('faux-webp-session'), contentType: 'image/webp' }
  }

  /**
   * Le flux vidéo (CC-241) — scripté, jamais réseau.
   *
   * ⚠️ **C'est le SEUL chemin du lot qu'aucune mesure live n'a pu confirmer** : l'instance Immich du
   * propriétaire répond 502 sur `/api/auth/login` au moment d'écrire ceci, donc la source
   * `immich_locked` est vide en base. Ce faux prouve ce que le CONTRÔLEUR fait d'une réponse, pas
   * que `/api/assets/:id/video/playback` se comporte ainsi chez Immich. Ne présente jamais ce test
   * comme une vérification du chemin Immich réel.
   */
  async videoPlayback(assetId: string, range: string | null): Promise<ImmichVideoStream> {
    this.videoed.push({ assetId, range })

    if (this.video instanceof Error) throw this.video

    return {
      status: range === null ? 200 : 206,
      contentType: 'video/mp4',
      contentLength: String(this.video.length),
      contentRange: range === null ? null : `bytes 0-${this.video.length - 1}/${this.video.length}`,
      body: Readable.from([Buffer.from(this.video)]),
      abort: () => {
        this.aborted += 1
      },
    }
  }

  /** Les lectures vidéo demandées, avec le `Range` reçu — pour vérifier qu'il est bien transmis. */
  readonly videoed: { assetId: string; range: string | null }[] = []
  /** Le nombre d'abandons demandés — la coupure côté Immich à la déconnexion du client. */
  aborted = 0
  private video: string | Error = 'faux-flux-video'

  setVideo(video: string | Error): void {
    this.video = video
  }

  async closeSession(): Promise<void> {
    /* rien à fermer dans un faux */
  }
}
