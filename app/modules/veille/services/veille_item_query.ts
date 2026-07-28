import VeilleItem from '#modules/veille/models/veille_item'
import { NO_SOURCE, type SourceFilter } from '#modules/veille/shared/source_filter'

/**
 * La requête filtrée du flux — **un seul endroit, trois appelants** (CC-108).
 *
 * `VeilleController.index` la construisait en ligne. Tant qu'elle ne servait qu'à afficher, ça
 * allait. CC-108 lui donne deux autres appelants — le décompte annoncé par la confirmation, et la
 * suppression elle-même — et **le mode d'échec d'une duplication devient grave** : la liste
 * annoncerait 317, la confirmation 317, et la suppression en emporterait 340. Aucune erreur, rien
 * dans les logs, et 23 items disparus que personne n'a vus passer.
 *
 * ⚠️ **Serveur uniquement** : ce fichier importe le modèle Lucid, il n'a rien à faire dans
 * `shared/`. Ce qui vit dans `shared/` ici, c'est *ce que le filtre veut dire* (`source_filter`),
 * pas *comment on l'interroge*.
 */

/** Les six filtres du flux. Le validateur et la page en connaissent exactement la même liste. */
export type ItemFilters = {
  type: string | null
  tag: string | null
  search: string | null
  sourceId: SourceFilter
  readingQueue: boolean
  unread: boolean
}

/**
 * L'ordre du flux — **appliqué par l'appelant qui affiche, pas par la requête elle-même**.
 *
 * `id` en second critère rend l'ordre **total** : sans lui, deux items publiés à la même seconde
 * peuvent s'échanger entre deux requêtes, et la pagination sauterait ou répéterait une ligne
 * pendant qu'une collecte tourne.
 *
 * ⚠️ **Il ne peut pas vivre dans `filteredItems`, et la raison est en base** : un `count(*)` sur
 * une requête ordonnée par `coalesce(published_at, created_at)` fait échouer Postgres — la colonne
 * n'est ni agrégée ni groupée. Le décompte annoncé par la confirmation (CC-108) partait en **500**.
 * Et c'est cohérent avec le découpage : *quels items ce filtre désigne* est une question, *dans
 * quel ordre on les montre* en est une autre, dont ni le décompte ni la suppression n'ont besoin.
 */
export const FEED_ORDER = 'coalesce(published_at, created_at) DESC, id DESC'

/**
 * Les items visibles que ces filtres désignent — **sans ordre**, voir `FEED_ORDER`.
 *
 * ⚠️ **`visible()`, jamais `query()`** : les supprimés portent une pierre tombale, et le filtre
 * est posé **avant** tous les `if`. C'est aussi ce qui rend la suppression par filtre idempotente
 * — un second clic ne redésigne pas ce qui est déjà parti, donc ne rappelle pas Immich.
 */
export function filteredItems(filters: ItemFilters) {
  const query = VeilleItem.visible()

  if (filters.type) query.where('type', filters.type)
  // `tags` est un `text[]` Postgres : le binding `?` reste paramétré, jamais concaténé.
  if (filters.tag) query.whereRaw('? = ANY(tags)', [filters.tag])
  if (filters.search) {
    query.whereRaw("search_vector @@ plainto_tsquery('french', ?)", [filters.search])
  }

  /**
   * ⚠️ **Trois branches, et le `if (sourceId)` d'origine ne pouvait pas les porter** (CC-105) :
   * la sentinelle est une chaîne, donc truthy, et serait partie en
   * `where('veille_source_id', 'none')` sur une colonne `integer`.
   */
  if (filters.sourceId === NO_SOURCE) query.whereNull('veille_source_id')
  else if (filters.sourceId !== null) query.where('veille_source_id', filters.sourceId)

  if (filters.readingQueue) query.where('reading_queue', true)
  if (filters.unread) query.whereNull('read_at')

  return query
}
