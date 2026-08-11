import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import type { Session } from '@adonisjs/session'
import ForbiddenException from '#core/shared/exceptions/forbidden_exception'
import { isImmichAssetId } from '#core/shared/services/immich_client'
import type User from '#core/auth/models/user'
import vault from '#modules/coffre/services/vault_service'
import ImmichSessionClient from '#modules/coffre/services/immich_session_client'

/**
 * Le dossier verrouillé d'Immich, parcouru depuis le coffre (CC-205) — le second mode
 * d'authentification qui manquait au proxy de vignette de CC-180 : une clé d'API ne voit jamais
 * `visibility: locked` (comportement voulu d'Immich, issue immich-app/immich#20622 fermée « as not
 * planned »), il faut une session avec élévation par PIN.
 *
 * ⚠️ **`GET /coffre/immich/dossier` rend l'UUID de chaque photo, et c'est délibéré** — contrairement
 * à `CoffreEntryView.media`, qui ne porte jamais l'UUID d'un média déjà ATTACHÉ. Cette route sert la
 * phase de SÉLECTION, avant tout attachement : l'utilisateur a déjà cette information en parcourant
 * Immich lui-même, exactement comme il l'a déjà quand il colle un UUID à la main. Voir
 * `app/modules/coffre/CLAUDE.md`, « Le dossier verrouillé — l'UUID en sélection n'est pas l'UUID en
 * liste ».
 *
 * ⚠️ **`index` rend toujours 200** — `available: false` porte l'échec (non configuré, panne
 * Immich), jamais un code d'erreur : ce n'est pas « photo introuvable », c'est « je n'ai pas pu
 * parler à Immich », deux choses différentes que la doctrine des proxies existants (404 uniforme
 * par média) ne couvre pas.
 *
 * ⚠️ **Elle hérite du mur du coffre EN PLUS de sa capacité**, comme les deux autres proxies : le
 * dossier verrouillé EST du contenu du coffre.
 */
@inject()
export default class CoffreImmichFolderController {
  constructor(private immichSession: ImmichSessionClient) {}

  async index({ auth, response, session }: HttpContext) {
    this.#requireElevation(auth.user!, session)

    response.header('cache-control', 'no-store')
    response.header('pragma', 'no-cache')

    try {
      const { photos, truncated } = await this.immichSession.lockedPhotos()
      return response.ok({ available: true, truncated, photos })
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Le dossier verrouillé Immich n'a pas pu être listé."
      )
      return response.ok({ available: false, truncated: false, photos: [] })
    }
  }

  async thumbnail({ auth, params, response, session }: HttpContext) {
    this.#requireElevation(auth.user!, session)

    response.header('cache-control', 'no-store')
    response.header('pragma', 'no-cache')

    if (!isImmichAssetId(params.assetId)) {
      return response.notFound({ error: 'Média introuvable.' })
    }

    try {
      const thumbnail = await this.immichSession.thumbnail(params.assetId)
      response.header('content-type', thumbnail.contentType)

      return response.send(thumbnail.bytes)
    } catch (error) {
      // ⚠️ 404 au navigateur, jamais silencieux côté serveur — même doctrine que
      // `CoffreMediaController`.
      logger.warn(
        {
          assetId: params.assetId,
          error: error instanceof Error ? error.message : String(error),
        },
        "La vignette du dossier verrouillé n'a pas pu être récupérée."
      )
      return response.notFound({ error: 'Vignette indisponible.' })
    }
  }

  /**
   * La lecture d'une vidéo du dossier verrouillé (CC-241) — le second trou nommé par le ticket :
   * le client de session ne savait que lister et faire des vignettes.
   *
   * ⚠️ **Aucun ffmpeg ici, et c'est délibéré** : Immich transcode déjà (`/api/assets/:id/video/
   * playback`). Faire lire un flux HTTP distant à notre ffmpeg aurait mis le jeton de session dans
   * l'`argv` d'un processus, lisible par `ps` — voir `ImmichSessionClient.videoPlayback`.
   *
   * ⚠️ **`Range` est relayé dans les DEUX sens, tel quel.** Immich seul connaît la taille du flux
   * qu'il sert ; recalculer un `content-range` de notre côté rendrait un segment faux.
   *
   * ⚠️ **La requête distante est coupée à la déconnexion du client** — même raison que le `SIGKILL`
   * sur ffmpeg : sans ça, fermer l'onglet laisse le serveur aspirer la vidéo jusqu'au bout.
   */
  async video({ auth, params, request, response, session }: HttpContext) {
    this.#requireElevation(auth.user!, session)

    response.header('cache-control', 'no-store')
    response.header('pragma', 'no-cache')

    if (!isImmichAssetId(params.assetId)) {
      return response.notFound({ error: 'Média introuvable.' })
    }

    try {
      const flux = await this.immichSession.videoPlayback(
        params.assetId,
        request.header('range') ?? null
      )

      response.response.on('close', () => flux.abort())

      response.status(flux.status)
      response.header('content-type', flux.contentType)
      response.header('accept-ranges', 'bytes')
      if (flux.contentLength !== null) response.header('content-length', flux.contentLength)
      if (flux.contentRange !== null) response.header('content-range', flux.contentRange)

      return response.stream(flux.body, () => {
        flux.abort()
        return ['', 500]
      })
    } catch (error) {
      // ⚠️ 404 uniforme, comme la vignette — jamais un oracle sur la cause côté client.
      logger.warn(
        { assetId: params.assetId, error: error instanceof Error ? error.message : String(error) },
        "La vidéo du dossier verrouillé n'a pas pu être récupérée."
      )
      return response.notFound({ error: 'Média introuvable.' })
    }
  }

  #requireElevation(user: User, session: Session): void {
    if (vault.keyFor(user, session) === null) {
      throw new ForbiddenException('Le coffre est verrouillé.')
    }
  }
}
