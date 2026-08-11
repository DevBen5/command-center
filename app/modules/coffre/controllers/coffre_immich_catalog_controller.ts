import type { HttpContext } from '@adonisjs/core/http'

/**
 * La carte « Immich verrouillé » de l'accueil du coffre (CC-239) — page-coquille SEULE : la grille
 * réutilise `/coffre/catalog/items?source=immich_locked` (CC-227) telle quelle, côté client, avec la
 * source verrouillée dans la requête plutôt qu'exposée dans un sélecteur. Aucune donnée en prop
 * Inertia, même doctrine que `CoffreCatalogController#index`.
 */
export default class CoffreImmichCatalogController {
  async index({ inertia }: HttpContext) {
    return inertia.render('modules/coffre/immich')
  }
}
