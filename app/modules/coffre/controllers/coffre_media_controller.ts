import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import ForbiddenException from '#core/shared/exceptions/forbidden_exception'
import ImmichClient from '#core/shared/services/immich_client'
import vault from '#modules/coffre/services/vault_service'

/**
 * Le proxy de vignette du coffre (CC-180) — reprend le patron de
 * `VeilleMediaController.thumbnail`, avec deux durcissements propres au coffre.
 *
 * ⚠️ **La route est indexée par l'`id` de NOTRE ligne `coffre_entry_media`, jamais par l'UUID
 * Immich** — même décision de sécurité qu'en veille (voir `app/modules/veille/CLAUDE.md`, « Le
 * proxy de vignette »). Une route qui prendrait l'UUID serait un proxy de lecture ouvert sur toute
 * la bibliothèque personnelle.
 *
 * ⚠️ **Elle hérite EN PLUS du mur du coffre** (`middleware.coffreOuvert()`, dans `start/routes.ts`,
 * groupe déjà muré) : une vignette servie sans élévation viderait le coffre de son sens, puisque
 * l'image EST le contenu.
 *
 * ⚠️ **`cache-control: no-store` + `pragma: no-cache`, PAS `private, max-age=3600` comme la
 * veille.** Divergence assumée : le contenu de veille n'est pas verrouillable, celui du coffre
 * l'est — une vignette mise en cache par le navigateur resterait lisible sur disque après un
 * verrouillage, exactement le genre de fuite au repos que CC-179 a fermée sur le flash de
 * validation.
 */
@inject()
export default class CoffreMediaController {
  constructor(private immich: ImmichClient) {}

  async thumbnail({ auth, params, response, session }: HttpContext) {
    const user = auth.user!
    const key = vault.keyFor(user, session)
    if (key === null) {
      throw new ForbiddenException('Le coffre est verrouillé.')
    }

    const assetId = await vault.mediaThumbnailAssetId(user, key, Number(params.id))
    if (assetId === null) {
      return response.notFound({ error: 'Média introuvable.' })
    }

    response.header('cache-control', 'no-store')
    response.header('pragma', 'no-cache')

    try {
      const thumbnail = await this.immich.thumbnail(assetId)
      response.header('content-type', thumbnail.contentType)

      return response.send(thumbnail.bytes)
    } catch (error) {
      // ⚠️ 404 au navigateur, mais jamais silencieux côté serveur — même doctrine que
      // `VeilleMediaController` : « Immich éteint », « clé révoquée » et « asset supprimé » sont
      // indiscernables pour l'utilisateur, et le réflexe serait d'accuser le proxy.
      logger.warn(
        {
          mediaId: params.id,
          error: error instanceof Error ? error.message : String(error),
        },
        "La vignette du coffre n'a pas pu être récupérée."
      )
      return response.notFound({ error: 'Vignette indisponible.' })
    }
  }
}
