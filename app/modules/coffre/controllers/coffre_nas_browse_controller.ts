import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import ForbiddenException from '#core/shared/exceptions/forbidden_exception'
import vault from '#modules/coffre/services/vault_service'
import NasRootsService from '#modules/coffre/services/nas_roots_service'
import { browseNasFolder, browseNasRoots } from '#modules/coffre/services/nas_folder_browser'
import { generateNasThumbnail } from '#modules/coffre/services/nas_thumbnail_generator'
import nasBrowseThrottle from '#modules/coffre/services/nas_browse_throttle_service'

/**
 * La navigation par dossier NAS (CC-239) — l'accueil du coffre bascule d'entrées-avec-pièces-jointes
 * vers deux cartes de source ; celle-ci lit le disque EN DIRECT (`readdir`), jamais
 * `coffre_catalog_items`, pour qu'un fichier ajouté depuis le coffre (lots suivants) apparaisse sans
 * resynchronisation. Le catalogue reste réservé à la recherche globale — voir `CoffreCatalogController`.
 *
 * ⚠️ **Route SÉPARÉE de `/coffre/catalog/nas/:id/thumbnail` (CC-228) et de `/coffre/nas/:id/stream`
 * (CC-181)** — décision du ticket : celles-ci indexent par un `id` de ligne en base (catalogue ou
 * pièce jointe), qui n'existe pas forcément pour un fichier qu'on vient de découvrir en naviguant.
 * `/coffre/nas/thumbnail` prend `root`+`path` en clair (query string), résolus par la MÊME garde de
 * confinement que le reste du module (`NasRootsService.resolveInRoot`) — jamais une seconde
 * implémentation.
 *
 * ⚠️ **Pas de cache de vignette ici**, contrairement à CC-228 : le cache existant est indexé par
 * `catalog_item_id`, une clé qui n'a pas de sens pour un fichier hors catalogue. Limite connue,
 * assumée — voir le `CLAUDE.md` du module.
 *
 * ⚠️ **Elle hérite du mur du coffre** (`middleware.coffreOuvert()`, groupe de routes) — même
 * doctrine que les autres proxies : le contenu d'un dossier EST du contenu du coffre. Le garde
 * ci-dessous est le second mécanisme indépendant, sur le patron de `CoffreImmichFolderController`.
 */
@inject()
export default class CoffreNasBrowseController {
  constructor(private roots: NasRootsService) {}

  async page({ inertia }: HttpContext) {
    return inertia.render('modules/coffre/nas')
  }

  async browse({ auth, request, response, session }: HttpContext) {
    const user = auth.user!
    if (vault.keyFor(user, session) === null) {
      throw new ForbiddenException('Le coffre est verrouillé.')
    }

    const wait = await nasBrowseThrottle.secondsBeforeRetry(user.id)
    if (wait > 0) {
      response.header('cache-control', 'no-store')
      return response.tooManyRequests({ error: 'Trop de requêtes. Réessayez dans un instant.' })
    }
    await nasBrowseThrottle.recordRequest(user.id)

    response.header('cache-control', 'no-store')
    response.header('pragma', 'no-cache')

    const rootName = request.input('root')
    if (typeof rootName !== 'string' || rootName.length === 0) {
      return response.ok(browseNasRoots(this.roots))
    }

    const relativePath = request.input('path')
    const listing = await browseNasFolder(
      this.roots,
      rootName,
      typeof relativePath === 'string' ? relativePath : ''
    )

    if (listing === null) {
      return response.notFound({ error: 'Dossier introuvable.' })
    }

    return response.ok(listing)
  }

  async thumbnail({ auth, request, response, session }: HttpContext) {
    const user = auth.user!
    if (vault.keyFor(user, session) === null) {
      throw new ForbiddenException('Le coffre est verrouillé.')
    }

    response.header('cache-control', 'no-store')
    response.header('pragma', 'no-cache')

    const rootName = request.input('root')
    const relativePath = request.input('path')
    if (typeof rootName !== 'string' || typeof relativePath !== 'string') {
      return response.notFound({ error: 'Vignette indisponible.' })
    }

    const realPath = await this.roots.resolveInRoot(rootName, relativePath)
    if (realPath === null) {
      return response.notFound({ error: 'Vignette indisponible.' })
    }

    try {
      const thumbnail = await generateNasThumbnail(realPath)
      response.header('content-type', thumbnail.contentType)
      return response.send(thumbnail.bytes)
    } catch (error) {
      // ⚠️ 404 uniforme au client, jamais un oracle sur la cause — même doctrine que les autres
      // proxies du module.
      logger.warn(
        { rootName, error: error instanceof Error ? error.message : String(error) },
        "La vignette d'un fichier NAS parcouru n'a pas pu être générée."
      )
      return response.notFound({ error: 'Vignette indisponible.' })
    }
  }
}
