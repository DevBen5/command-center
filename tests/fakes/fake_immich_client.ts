import ImmichClient, {
  ImmichUnavailableError,
  type ImmichThumbnail,
} from '#modules/veille/services/immich_client'
import type { ImmichAsset } from '#modules/veille/services/immich_asset'

/** Ce que l'album rend : une liste d'assets, ou une erreur à lever. */
export type AlbumScript = ImmichAsset[] | Error | (() => ImmichAsset[] | Promise<ImmichAsset[]>)

/**
 * Le faux client Immich : **aucun test ne touche le réseau ni une vraie instance**, comme le faux
 * fetcher de flux et le faux client LLM.
 *
 * Il hérite du vrai pour être substituable au type sans interface séparée, et remplace la couche
 * **API** (`serverVersion`, `albumAssets`, `thumbnail`) — pas le transport. Le transport a son
 * propre test, `tests/unit/veille_immich_client.spec.ts`, qui remplace `fetch` : c'est là que se
 * prouvent la pagination, l'assertion de `content-type` et le refus des redirections. Ce qui se
 * prouve **ici**, c'est ce que le collecteur fait des résultats.
 */
export default class FakeImmichClient extends ImmichClient {
  /** Le nombre d'appels à l'album : de quoi vérifier qu'une seconde passe interroge bien. */
  passes = 0

  /** Les identifiants dont la vignette a été demandée, dans l'ordre. */
  readonly thumbnailed: string[] = []

  /**
   * Les lots d'identifiants réellement envoyés à la corbeille (CC-63).
   *
   * ⚠️ **C'est ce qui permet d'asserter qu'AUCUN appel n'a eu lieu**, et pas seulement que rien
   * n'a été marqué en base. La différence porte le test de la corbeille désactivée : « rien en
   * base » serait aussi vrai si l'appel partait et échouait — or ce qu'on veut prouver, c'est
   * qu'on ne demande **jamais** une suppression qu'Immich rendrait définitive.
   */
  readonly trashed: string[][] = []

  /** Le nombre de jours de corbeille annoncé, ou l'erreur que la lecture doit lever. */
  trashDaysValue: number | Error = 30

  /** Ce que la mise à la corbeille doit faire — `null` pour réussir. */
  trashError: Error | null = null

  constructor(
    private album: AlbumScript,
    /** La version annoncée, ou l'erreur que la sonde doit lever (instance éteinte, clé refusée). */
    private version: string | Error = 'v2.6.1'
  ) {
    super()
  }

  /** Remplace le script entre deux passes — un asset retiré de l'album, par exemple. */
  setAlbum(album: AlbumScript): void {
    this.album = album
  }

  async trashDays(): Promise<number> {
    if (this.trashDaysValue instanceof Error) throw this.trashDaysValue
    return this.trashDaysValue
  }

  async trashAssets(assetIds: string[]): Promise<void> {
    // Enregistré **avant** l'échec éventuel : un appel qui part et échoue reste un appel parti,
    // et c'est exactement ce que le test de la corbeille désactivée doit pouvoir distinguer.
    this.trashed.push(assetIds)

    if (this.trashError !== null) throw this.trashError
  }

  async serverVersion(): Promise<string> {
    if (this.version instanceof Error) throw this.version
    return this.version
  }

  async albumAssets(): Promise<ImmichAsset[]> {
    this.passes++

    if (this.album instanceof Error) throw this.album
    if (typeof this.album === 'function') return this.album()

    return this.album
  }

  async thumbnail(assetId: string): Promise<ImmichThumbnail> {
    this.thumbnailed.push(assetId)

    // Un asset absent du script est une vignette introuvable — pas une image vide qui
    // ressemblerait à un succès.
    const known = Array.isArray(this.album) && this.album.some((asset) => asset.id === assetId)
    if (!known) {
      throw new ImmichUnavailableError(`Aucune vignette scriptée pour ${assetId}.`)
    }

    return { bytes: Buffer.from('faux-webp'), contentType: 'image/webp' }
  }
}
