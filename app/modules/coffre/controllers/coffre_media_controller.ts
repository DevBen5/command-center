import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import ForbiddenException from '#core/shared/exceptions/forbidden_exception'
import ImmichClient, { type ImmichThumbnail } from '#core/shared/services/immich_client'
import vault from '#modules/coffre/services/vault_service'
import ImmichSessionClient from '#modules/coffre/services/immich_session_client'

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
 *
 * ⚠️ **Repli en session Immich depuis CC-205.** La clé d'API (`this.immich`) répond `401 Elevated
 * permission is required` sur un asset `visibility: locked` — comportement voulu d'Immich, jamais
 * corrigé. Un UUID collé à la main (CC-180) peut désigner un asset verrouillé : sans ce repli, il
 * échouait silencieusement en 404, comme n'importe quel autre échec. Le chemin rapide (clé d'API)
 * reste tenté en premier — la majorité des assets ne sont pas verrouillés.
 *
 * ⚠️ **Pas de garde `coffreImmichConfig.enabled` ici, délibérément.** `ImmichSessionClient` porte
 * déjà son propre refus rapide (« pas configuré », sans le moindre appel réseau) — dupliquer le
 * contrôle ici ferait deux sources de vérité sur la même question, et rendrait ce contrôleur
 * dépendant d'un singleton non substituable en test (`app.container.swap` remplace la classe
 * injectée, pas la config qu'elle lit). Le coût d'un appel de repli inutile quand le dossier
 * verrouillé n'est pas configuré est nul : `#withSession` lève avant tout `fetch`.
 */
@inject()
export default class CoffreMediaController {
  constructor(
    private immich: ImmichClient,
    private immichSession: ImmichSessionClient
  ) {}

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

    const apiKeyAttempt = await this.#tryThumbnail(() => this.immich.thumbnail(assetId), {
      mediaId: params.id,
      mode: 'clé d’API',
    })
    if (apiKeyAttempt !== null) {
      response.header('content-type', apiKeyAttempt.contentType)
      return response.send(apiKeyAttempt.bytes)
    }

    const sessionAttempt = await this.#tryThumbnail(() => this.immichSession.thumbnail(assetId), {
      mediaId: params.id,
      mode: 'session (dossier verrouillé)',
    })
    if (sessionAttempt !== null) {
      response.header('content-type', sessionAttempt.contentType)
      return response.send(sessionAttempt.bytes)
    }

    return response.notFound({ error: 'Vignette indisponible.' })
  }

  /**
   * `null` sur échec — jamais une exception qui remonterait jusqu'au client. Le double appel (clé
   * d'API puis session) partage ce même wrapper pour ne journaliser qu'une ligne par tentative,
   * chacune nommant son mode : « Immich éteint », « clé révoquée » et « asset introuvable » sont
   * indiscernables pour l'utilisateur (404 dans tous les cas), mais pas dans les journaux.
   */
  async #tryThumbnail(
    attempt: () => Promise<ImmichThumbnail>,
    context: { mediaId: unknown; mode: string }
  ): Promise<ImmichThumbnail | null> {
    try {
      return await attempt()
    } catch (error) {
      logger.warn(
        {
          mediaId: context.mediaId,
          mode: context.mode,
          error: error instanceof Error ? error.message : String(error),
        },
        "La vignette du coffre n'a pas pu être récupérée."
      )
      return null
    }
  }
}
