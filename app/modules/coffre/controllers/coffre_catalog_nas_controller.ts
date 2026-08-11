import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import ForbiddenException from '#core/shared/exceptions/forbidden_exception'
import vault from '#modules/coffre/services/vault_service'
import CoffreCatalogItem from '#modules/coffre/models/coffre_catalog_item'
import NasCatalogSource from '#modules/coffre/services/nas_catalog_source'
import catalogThumbnailCache from '#modules/coffre/services/catalog_thumbnail_cache'
import VideoTranscoder from '#modules/coffre/services/video_transcoder'
import { serveNasMedia } from '#modules/coffre/services/nas_media_response'

/**
 * Le proxy de vignette du catalogue NAS (CC-228) — comble le trou que CC-226 avait laissé
 * délibérément ouvert (`NasCatalogSource.thumbnailFor` levait). Sert CC-227 (la grille du
 * catalogue), dont chaque page téléchargerait sinon des fichiers complets.
 *
 * ⚠️ **Route SÉPARÉE de `/coffre/nas/:id/stream`, jamais un paramètre de taille greffé dessus** —
 * décision du ticket. Le proxy de streaming porte la garde de chemin ET la sécurité d'accès au
 * disque pour un fichier ATTACHÉ à une entrée (`coffre_entry_nas_file`, id chiffré) ; celui-ci sert
 * un élément du CATALOGUE (`coffre_catalog_items`, id en clair, `reference` déjà en clair en base
 * — voir son CLAUDE.md). Deux jeux de données différents, deux routes.
 *
 * ⚠️ **`:id` désigne notre ligne `coffre_catalog_items`, scopée `owner_id` ET `source = 'nas'`.**
 * Un item `immich_locked` rend 404 sur cette route — sa vignette existe déjà par un autre mécanisme
 * (le dossier verrouillé, CC-205), hors périmètre de ce lot.
 *
 * ⚠️ **Elle hérite du mur du coffre** (`middleware.coffreOuvert()`, groupe de routes) — une
 * vignette EST du contenu du coffre, même doctrine que les deux autres proxies. Le garde ci-dessous
 * (`#requireElevation`) est le second mécanisme indépendant, sur le patron de
 * `CoffreImmichFolderController`.
 */
@inject()
export default class CoffreCatalogNasController {
  constructor(
    private nasCatalogSource: NasCatalogSource,
    private transcoder: VideoTranscoder
  ) {}

  async thumbnail({ auth, params, response, session }: HttpContext) {
    const user = auth.user!
    const key = vault.keyFor(user, session)
    if (key === null) {
      throw new ForbiddenException('Le coffre est verrouillé.')
    }

    response.header('cache-control', 'no-store')
    response.header('pragma', 'no-cache')

    const itemId = Number(params.id)
    const item = await CoffreCatalogItem.query()
      .where('id', itemId)
      .where('owner_id', user.id)
      .where('source', 'nas')
      .first()

    if (item === null) {
      return response.notFound({ error: 'Vignette indisponible.' })
    }

    try {
      const cached = await catalogThumbnailCache.get(item.id, user.id, key)
      if (cached !== null) {
        response.header('content-type', cached.contentType)
        return response.send(cached.bytes)
      }

      const thumbnail = await this.nasCatalogSource.thumbnailFor(item.reference)
      await catalogThumbnailCache.put(item.id, user.id, key, thumbnail)

      response.header('content-type', thumbnail.contentType)
      return response.send(thumbnail.bytes)
    } catch (error) {
      // ⚠️ 404 uniforme au client, jamais un oracle sur la cause (racine non montée, fichier
      // corrompu, extension hors allow-list, panne du binaire) — même doctrine que les proxies
      // existants du module.
      logger.warn(
        { itemId: item.id, error: error instanceof Error ? error.message : String(error) },
        "La vignette d'un élément du catalogue NAS n'a pas pu être générée."
      )
      return response.notFound({ error: 'Vignette indisponible.' })
    }
  }

  /**
   * La lecture d'un élément du catalogue NAS (CC-241) — le pendant streaming de la vignette
   * ci-dessus, pour la grille de recherche. Sans lui, trouver une vidéo par la recherche puis
   * cliquer dessus ne faisait rien : le catalogue est le seul chemin vers un fichier qu'on ne sait
   * pas où trouver en naviguant.
   *
   * ⚠️ **Même scope que la vignette — `owner_id` ET `source = 'nas'`.** Un item `immich_locked`
   * rend 404 ici : sa lecture passe par `/coffre/immich/dossier/:assetId/video`, un tout autre
   * mécanisme d'authentification.
   *
   * ⚠️ **Aucun cache, contrairement à la vignette.** `coffre_catalog_thumbnails` stocke des
   * vignettes bornées à 512 Ko ; y ranger des vidéos ferait grossir la base de gigaoctets chiffrés
   * pour un gain nul — le fichier source est déjà sur le disque, à côté.
   */
  async stream(ctx: HttpContext) {
    const { auth, params, response, session } = ctx
    const user = auth.user!
    if (vault.keyFor(user, session) === null) {
      throw new ForbiddenException('Le coffre est verrouillé.')
    }

    const itemId = Number(params.id)
    const item = await CoffreCatalogItem.query()
      .where('id', itemId)
      .where('owner_id', user.id)
      .where('source', 'nas')
      .first()

    if (item === null) {
      return response.notFound({ error: 'Média introuvable.' })
    }

    const realPath = await this.nasCatalogSource.resolveReference(item.reference).catch(() => null)
    if (realPath === null) {
      logger.warn({ itemId: item.id }, "L'élément du catalogue NAS ne résout sous aucune racine.")
      return response.notFound({ error: 'Média introuvable.' })
    }

    const echec = await serveNasMedia(ctx, {
      realPath,
      transcoder: this.transcoder,
      contexte: { itemId: item.id },
    })

    if (echec !== null) {
      logger.warn({ itemId: item.id, echec }, "L'élément du catalogue NAS n'a pas pu être servi.")
      return response.notFound({ error: 'Média introuvable.' })
    }
  }
}
