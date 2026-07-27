import YoutubeClient, {
  YoutubeUnavailableError,
  type YoutubeThumbnail,
} from '#modules/veille/services/youtube_client'
import type { YoutubeVideo } from '#modules/veille/services/youtube_asset'

/** Ce que la playlist rend : une liste de vidéos, ou une erreur à lever. */
export type PlaylistScript =
  YoutubeVideo[] | Error | (() => YoutubeVideo[] | Promise<YoutubeVideo[]>)

/**
 * Le faux client YouTube : **aucun test ne touche le réseau ni l'API réelle**, comme le faux
 * fetcher de flux, le faux client Immich et le faux client LLM.
 *
 * Il hérite du vrai pour être substituable au type sans interface séparée, et remplace la couche
 * **API** (`playlistVideos`) — pas le transport. Le transport a son propre test,
 * `tests/unit/veille_youtube_client.spec.ts`, qui remplace `fetch` : c'est là que se prouvent la
 * pagination, l'appariement des durées et la non-fuite de la clé. Ce qui se prouve **ici**, c'est
 * ce que le collecteur fait des résultats.
 */
export default class FakeYoutubeClient extends YoutubeClient {
  /** Le nombre d'appels à la playlist : de quoi vérifier qu'une seconde passe interroge bien. */
  passes = 0

  /** Les identifiants dont la vignette a été demandée, dans l'ordre (CC-88). */
  readonly thumbnailed: string[] = []

  constructor(private playlist: PlaylistScript) {
    super()
  }

  /** Remplace le script entre deux passes — une vidéo retirée de la playlist, par exemple. */
  setPlaylist(playlist: PlaylistScript): void {
    this.playlist = playlist
  }

  async playlistVideos(): Promise<YoutubeVideo[]> {
    this.passes++

    if (this.playlist instanceof Error) throw this.playlist
    if (typeof this.playlist === 'function') return this.playlist()

    return this.playlist
  }

  async thumbnail(videoId: string): Promise<YoutubeThumbnail> {
    this.thumbnailed.push(videoId)

    // Une vidéo absente du script est une vignette introuvable — pas une image vide qui
    // ressemblerait à un succès, comme chez le faux client Immich.
    const known =
      Array.isArray(this.playlist) && this.playlist.some((video) => video.videoId === videoId)
    if (!known) {
      throw new YoutubeUnavailableError(`Aucune vignette scriptée pour ${videoId}.`)
    }

    return { bytes: Buffer.from('faux-jpeg'), contentType: 'image/jpeg' }
  }
}
