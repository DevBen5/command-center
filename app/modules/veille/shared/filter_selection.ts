/**
 * « Agir sur tout ce que le filtre affiche » — ce que le geste exige avant d'être permis (CC-108).
 *
 * **Pur, serveur ET page** : le serveur refuse, la page n'offre pas. Les deux, jamais l'un sans
 * l'autre — une route est un contrat public, et `POST /veille/items/filtered/delete` répond que
 * le bouton soit affiché ou non.
 *
 * ⚠️ **Aucun import par alias `#modules/*`** : l'alias vise des `.js` qui n'existent qu'après un
 * build, Vite ne les résout pas et la page casse.
 */

import type { SourceFilter } from './source_filter.js'

/** Recopié structurellement : voir l'avertissement sur les alias. */
export type SelectableFilters = {
  type: string | null
  tag: string | null
  search: string | null
  sourceId: SourceFilter
  readingQueue: boolean
  unread: boolean
}

/**
 * Un filtre vide n'est pas un filtre — **et c'est ce qui remplace le plafond de 200**.
 *
 * CC-63 bornait le geste le plus destructeur du module aux 50 items sous les yeux, et le
 * validateur refusait plus de 200 identifiants « qu'un client forgé ne peut pas contourner ».
 * CC-108 lève cette borne : la page n'envoie plus une liste, elle envoie un critère, et le
 * serveur agit sur ce que ce critère désigne.
 *
 * ⚠️ **Sans ce refus, le bouton devient « vider la veille ».** Aucun filtre posé désigne la table
 * entière — 102 items aujourd'hui, davantage demain — derrière un `confirm()` d'une ligne. Ce
 * n'est pas une garde contre l'erreur de manipulation, c'est la seule chose qui empêche un geste
 * de bonne foi d'être irréversible : la suppression est logique, mais rien ne la défait depuis
 * l'interface, et les assets Immich partent réellement à la corbeille.
 *
 * ⚠️ **Une chaîne vide compte comme absente**, exactement comme dans `applyFilters` : effacer le
 * champ de recherche sans valider laisse `''`, ce qui ne filtre rien du tout.
 */
/**
 * Le filtre tel qu'il voyage — **une seule forme, deux transports**.
 *
 * Le décompte part en query string (`GET`, donc pas de jeton CSRF à porter), la suppression en
 * corps de requête (`POST`). Construire deux charges utiles ferait exactement ce que ce ticket
 * cherche à empêcher : que ce qui est compté et ce qui est supprimé puissent différer. Tout est
 * en chaînes, ce qui est de toute façon la seule forme qu'une query string sache porter — le
 * validateur recoerce, `parseSourceFilter` tranche les trois états.
 *
 * ⚠️ **Seuls les filtres actifs y figurent**, comme dans `applyFilters` : un champ à `null`,
 * `false` ou `''` est absent, jamais présent-et-vide. C'est ce qui fait qu'`isFilterEmpty` et
 * cette fonction ne peuvent pas se contredire.
 */
export function filterPayload(filters: SelectableFilters): Record<string, string> {
  const payload: Record<string, string> = {}

  if (filters.type !== null && filters.type !== '') payload.type = filters.type
  if (filters.tag !== null && filters.tag !== '') payload.tag = filters.tag
  if (filters.search !== null && filters.search !== '') payload.search = filters.search
  // `String('none')` rend la sentinelle, `String(5)` l'identifiant : la même ligne porte les deux.
  if (filters.sourceId !== null) payload.sourceId = String(filters.sourceId)
  if (filters.readingQueue) payload.readingQueue = 'true'
  if (filters.unread) payload.unread = 'true'

  return payload
}

export function isFilterEmpty(filters: SelectableFilters): boolean {
  return (
    (filters.type === null || filters.type === '') &&
    (filters.tag === null || filters.tag === '') &&
    (filters.search === null || filters.search === '') &&
    filters.sourceId === null &&
    !filters.readingQueue &&
    !filters.unread
  )
}
