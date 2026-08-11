import CoffreCatalogItem from '#modules/coffre/models/coffre_catalog_item'
import type { CatalogItemNature, CatalogSourceKey } from '#modules/coffre/services/catalog_source'

/**
 * La requête filtrée de la grille du catalogue (CC-227) — **un seul endroit**, sur le patron de
 * `veille_item_query.ts` (`filteredItems`) : *quels éléments ce filtre désigne* est une question,
 * *dans quel ordre on les montre* en est une autre, et la seconde ne doit PAS vivre ici.
 *
 * ⚠️ **`orderByRaw` reste hors de cette fonction, et ce n'est pas cosmétique — mesuré côté veille
 * (CC-108) : un `count(*)` sur une requête ordonnée par une colonne ni agrégée ni groupée fait
 * échouer Postgres.** `CoffreCatalogController` applique l'ordre par-dessus le résultat de cette
 * fonction, juste avant `.paginate()`, jamais avant un `.count()` isolé.
 */
export type CatalogFilters = {
  source: CatalogSourceKey | null
  nature: CatalogItemNature | null
  capturedFrom: string | null
  capturedTo: string | null
  q: string | null
  includeMissing: boolean
}

export const CATALOG_SORT_COLUMNS = {
  capturedAt: 'captured_at',
  displayName: 'display_name',
} as const

export type CatalogSortKey = keyof typeof CATALOG_SORT_COLUMNS

/**
 * Les éléments visibles que ces filtres désignent, pour CE compte — sans ordre, voir la doctrine
 * ci-dessus.
 *
 * ⚠️ **`missing_since IS NULL` par défaut** : un élément disparu de sa source ne doit pas se
 * comporter comme un élément présent (décision du ticket). `includeMissing` l'inclut explicitement,
 * jamais par défaut.
 *
 * ⚠️ **La recherche est un `whereRaw` PARAMÉTRÉ, jamais une concaténation** — le point d'injection
 * le plus probable du dépôt. `%`/`_`/`\` sont échappés AVANT d'entrer dans le motif : sans ça, une
 * recherche sur le caractère littéral `%` matcherait tout le catalogue par accident (pas une
 * brèche d'autorisation, déjà scopé au compte — mais un vrai bug de recherche).
 */
export function catalogItemsQuery(ownerId: number, filters: CatalogFilters) {
  const query = CoffreCatalogItem.query().where('owner_id', ownerId)

  if (!filters.includeMissing) query.whereNull('missing_since')
  if (filters.source !== null) query.where('source', filters.source)
  if (filters.nature !== null) query.where('nature', filters.nature)
  // Une borne de période exclut naturellement les éléments sans date connue — on ne peut pas
  // affirmer qu'un `captured_at` NULL tombe dans une fenêtre qu'on ignore.
  if (filters.capturedFrom !== null) query.where('captured_at', '>=', filters.capturedFrom)
  if (filters.capturedTo !== null) query.where('captured_at', '<=', filters.capturedTo)

  if (filters.q !== null && filters.q.length > 0) {
    const escaped = filters.q.replace(/[\\%_]/g, (char) => `\\${char}`)
    query.whereRaw("display_name ILIKE ? ESCAPE '\\'", [`%${escaped}%`])
  }

  return query
}
