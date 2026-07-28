/**
 * Quels filtres sont posés, et comment les nommer — le rappel au-dessus du flux (CC-65).
 *
 * **Pur**, sorti du `<script setup>` (règle CC-60) : « quels filtres et quels libellés » est une
 * dérivation, donc prouvable en Japa. La page n'en garde qu'une enveloppe d'une ligne.
 *
 * ⚠️ **Ce module lit `filters`, JAMAIS `items`.** La distinction n'est pas théorique : c'est le
 * bug corrigé par CC-54. La barre de tags avait été dérivée de la liste affichée, si bien qu'elle
 * s'effondrait au seul tag sélectionné dès le premier clic — choisir un second tag imposait de
 * repasser par « Tout ». Un rappel dérivé des items rejouerait exactement ça : il n'annoncerait
 * que les filtres dont il reste quelque chose à l'écran, donc rien quand un filtre ne trouve rien,
 * c'est-à-dire au moment précis où on a besoin de savoir ce qui filtre.
 *
 * ⚠️ **Aucun import par alias `#modules/*`** : l'alias vise des `.js` qui n'existent qu'après un
 * build, Vite ne les résout pas et la page casse.
 */

import { NO_SOURCE, type SourceFilter } from './source_filter.js'

/**
 * Recopié structurellement depuis la page : voir l'avertissement sur les alias.
 *
 * ⚠️ **`undefined` est admis en plus de `null`, et ce n'est pas de la complaisance de typage.**
 * `request.input('type')` rend `undefined` quand le paramètre est absent, et `JSON.stringify`
 * **supprime les clés `undefined`** : la prop arrive donc sans le champ du tout. Un test
 * `!== null` y répondrait vrai, et une chip « Type : » s'afficherait alors qu'aucun filtre n'est
 * posé — visible à l'écran, invisible à tout test construit avec des `null` explicites.
 * `VeilleController.index` normalise désormais en `null`, et cette souplesse-ci est la seconde
 * barrière.
 */
export type FiltersView = {
  type?: string | null
  tag?: string | null
  search?: string | null
  sourceId?: SourceFilter
  unread?: boolean
  readingQueue?: boolean
}

/** Une valeur de filtre textuelle réellement posée — ni absente, ni nulle, ni vide. */
function isSet(value: string | null | undefined): value is string {
  return typeof value === 'string' && value !== ''
}

/** Le minimum qu'il faut connaître d'une source pour la nommer dans un chip. */
export type FilterSourceView = { id: number; title: string }

/** Les champs retirables. Sert de `:key` et nomme ce que le patch remet à zéro. */
export type FilterField = 'type' | 'sourceId' | 'tag' | 'search' | 'unread' | 'readingQueue'

export type ActiveFilter = {
  field: FilterField
  /** Le nom du groupe — **toujours** une clé i18n, `shared/` ne traduit pas. */
  labelKey: string
  /** La valeur quand elle est traduisible (un type), `null` sinon. */
  valueKey: string | null
  /** La valeur quand elle vient de la base ou de la saisie (tag, recherche, titre de source). */
  valueText: string | null
  /** Ce qu'il faut passer à `applyFilters` pour retirer ce filtre-là, et lui seul. */
  patch: Partial<Record<FilterField, null | false>>
}

/**
 * Les filtres posés, dans un ordre **fixe**.
 *
 * ⚠️ L'ordre n'est pas cosmétique : dérivé de l'ordre d'insertion d'un objet, il changerait selon
 * le filtre posé en dernier, et les chips sauteraient d'une position à l'autre entre deux
 * navigations. Une cible qui bouge sous le curseur fait cliquer sur le mauvais ✕.
 */
export function activeFilters(
  filters: FiltersView,
  sources: readonly FilterSourceView[]
): ActiveFilter[] {
  const posed: ActiveFilter[] = []

  if (isSet(filters.type)) {
    posed.push({
      field: 'type',
      labelKey: 'veille.index.filters.chip.type',
      // Les types sont un ensemble fermé, traduit par `index.types.*` : la clé se dérive du nom.
      valueKey: `veille.index.types.${filters.type}`,
      valueText: null,
      patch: { type: null },
    })
  }

  if (filters.sourceId !== null && filters.sourceId !== undefined) {
    posed.push({
      field: 'sourceId',
      labelKey: 'veille.index.filters.chip.source',
      ...sourceValue(filters.sourceId, sources),
      patch: { sourceId: null },
    })
  }

  if (isSet(filters.tag)) {
    posed.push({
      field: 'tag',
      labelKey: 'veille.index.filters.chip.tag',
      valueKey: null,
      valueText: filters.tag,
      patch: { tag: null },
    })
  }

  if (isSet(filters.search)) {
    posed.push({
      field: 'search',
      labelKey: 'veille.index.filters.chip.search',
      valueKey: null,
      valueText: filters.search,
      patch: { search: null },
    })
  }

  // Les deux bascules n'ont pas de valeur : leur nom EST le libellé.
  if (filters.unread) {
    posed.push({
      field: 'unread',
      labelKey: 'veille.index.filters.unreadOnly',
      valueKey: null,
      valueText: null,
      patch: { unread: false },
    })
  }

  if (filters.readingQueue) {
    posed.push({
      field: 'readingQueue',
      labelKey: 'veille.index.filters.readingQueue',
      valueKey: null,
      valueText: null,
      patch: { readingQueue: false },
    })
  }

  return posed
}

/**
 * Comment nommer la source filtrée.
 *
 * ⚠️ **Le repli ne masque jamais** — même raisonnement que `item_provenance`. Une source
 * introuvable affiche son identifiant plutôt que rien : un chip sans valeur serait à la fois
 * inexplicable et impossible à relier au filtre qu'il retire. Inatteignable aujourd'hui, la FK
 * étant `ON DELETE SET NULL` et `index` chargeant toutes les sources — mais c'est justement le
 * genre de garantie qu'un `where('active', true)` ajouté ici défait sans le dire.
 */
function sourceValue(
  sourceId: Exclude<SourceFilter, null>,
  sources: readonly FilterSourceView[]
): { valueKey: string | null; valueText: string | null } {
  if (sourceId === NO_SOURCE) {
    return { valueKey: 'veille.index.filters.noSource', valueText: null }
  }

  const source = sources.find((candidate) => candidate.id === sourceId)
  return { valueKey: null, valueText: source?.title ?? `#${sourceId}` }
}

/** Un « tout effacer » n'a de sens qu'au-delà d'un filtre — sinon c'est le ✕ du chip unique. */
export function clearAllPatch(
  posed: readonly ActiveFilter[]
): Partial<Record<FilterField, null | false>> {
  return Object.assign({}, ...posed.map((filter) => filter.patch))
}
