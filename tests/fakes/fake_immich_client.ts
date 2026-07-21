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
