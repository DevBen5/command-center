import ImmichSessionClient, {
  type ImmichLockedFolder,
} from '#modules/coffre/services/immich_session_client'
import { ImmichUnavailableError, type ImmichThumbnail } from '#core/shared/services/immich_client'

/** Ce que le dossier verrouillé rend : un contenu, ou une erreur à lever. */
export type LockedFolderScript = ImmichLockedFolder | Error

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

  constructor(private folder: LockedFolderScript = { photos: [], truncated: false }) {
    super()
  }

  setFolder(folder: LockedFolderScript): void {
    this.folder = folder
  }

  async lockedPhotos(): Promise<ImmichLockedFolder> {
    if (this.folder instanceof Error) throw this.folder
    return this.folder
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

  async closeSession(): Promise<void> {
    /* rien à fermer dans un faux */
  }
}
