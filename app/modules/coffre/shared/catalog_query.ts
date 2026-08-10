/**
 * La grille du catalogue (`pages/catalog.vue`) — la construction de la query string envoyée à
 * `GET /coffre/catalog/items`, extraite pour être atteignable par Vitest sans monter le composant
 * (même geste que `entry_sections.ts`, `breadcrumb.ts` : un `<script setup>` est hors de portée de
 * Japa, et ce fichier n'a pas de compilateur Vue à charger).
 *
 * ⚠️ **N'importe jamais par un alias `#modules/*` depuis ce dossier** — l'alias mappe vers
 * `./app/modules/*.js`, qui n'existe qu'après un build ; Vite ne le résout pas depuis un `.vue`.
 * Relatif ou npm pur uniquement.
 *
 * Ce fichier est **pur** : ni base, ni horloge, ni DOM, ni Vue.
 */

export type CatalogSourceKey = 'immich_locked' | 'nas'
export type CatalogItemNature = 'photo' | 'video' | 'other'
export type CatalogSortKey = 'capturedAt' | 'displayName'
export type CatalogSortOrder = 'asc' | 'desc'

export interface CatalogFilters {
  page: number
  source: CatalogSourceKey | null
  nature: CatalogItemNature | null
  capturedFrom: string | null
  capturedTo: string | null
  q: string
  includeMissing: boolean
  sort: CatalogSortKey
  order: CatalogSortOrder
}

export const DEFAULT_CATALOG_FILTERS: CatalogFilters = {
  page: 1,
  source: null,
  nature: null,
  capturedFrom: null,
  capturedTo: null,
  q: '',
  includeMissing: false,
  sort: 'capturedAt',
  order: 'desc',
}

/** La query string envoyée à `/coffre/catalog/items` — un champ absent n'est jamais posté vide. */
export function buildCatalogQueryString(filters: CatalogFilters): string {
  const params = new URLSearchParams()

  params.set('page', String(filters.page))
  if (filters.source !== null) params.set('source', filters.source)
  if (filters.nature !== null) params.set('nature', filters.nature)
  if (filters.capturedFrom !== null) params.set('capturedFrom', filters.capturedFrom)
  if (filters.capturedTo !== null) params.set('capturedTo', filters.capturedTo)

  const q = filters.q.trim()
  if (q.length > 0) params.set('q', q)

  if (filters.includeMissing) params.set('includeMissing', 'true')

  params.set('sort', filters.sort)
  params.set('order', filters.order)

  return params.toString()
}

/**
 * Applique un changement de filtre. ⚠️ **Revient à la page 1, sauf si le changement PORTE
 * lui-même sur la page** (un clic « page suivante ») — sans cette exception, cliquer page suivante
 * la ramènerait aussitôt à la page 1.
 */
export function applyFilterChange(
  filters: CatalogFilters,
  patch: Partial<CatalogFilters>
): CatalogFilters {
  const next = { ...filters, ...patch }
  if (!('page' in patch)) next.page = 1

  return next
}
