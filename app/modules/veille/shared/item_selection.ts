/**
 * La sélection multiple et sa confirmation (CC-63) — **du code pur**, sorti du `<script setup>`.
 *
 * Japa importe des `.ts` et n'a aucun compilateur Vue : ce qui vit dans un `<script setup>` est
 * **structurellement** hors de portée de la suite. Ces fonctions décident (ce qui part, combien
 * d'assets, ce que le dialogue annonce), elles vivent donc ici et la page n'en garde que des
 * enveloppes d'une ligne.
 *
 * ⚠️ **Aucun import par alias `#modules/*` dans ce fichier.** L'alias mappe vers
 * `./app/modules/*.js`, qui n'existe qu'après un build : Vite ne le résout pas et la page casse.
 * D'où les types structurels ci-dessous plutôt qu'un import du modèle. Le garde-fou est
 * `npm run build` — `tsc` ne lit pas les `.vue` et ne peut pas le dire.
 */

import { isMediaItem, type ItemType } from './media_item.js'

/** Le minimum que ces fonctions ont besoin de connaître d'un item. */
export type SelectableItem = {
  id: number
  type: ItemType
}

/** Ce qu'une sélection contient réellement — la base du dialogue de confirmation. */
export type SelectionSummary = {
  /** Items sélectionnés qui existent réellement dans la liste affichée. */
  total: number
  /** Parmi eux, ceux dont un asset Immich part à la corbeille. */
  media: number
}

/**
 * Coche / décoche un item, et rend la **nouvelle** liste.
 *
 * Une fonction pure plutôt qu'une mutation : la sélection est un état de page, et un `push` sur
 * un tableau réactif rend le geste inverse (décocher) subtilement différent du geste direct.
 */
export function toggleSelected(selected: number[], id: number): number[] {
  return selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]
}

/**
 * Tout cocher / tout décocher, **à l'échelle de la page affichée seulement**.
 *
 * ⚠️ **Il n'existe pas de « tout sélectionner » inter-pages, et c'est délibéré.** Le rayon
 * d'action d'un clic reste borné aux 50 items sous les yeux : un bouton capable d'emporter toute
 * la table dépasserait de loin ce que la confirmation peut honnêtement annoncer.
 */
export function toggleAll(selected: number[], items: SelectableItem[]): number[] {
  const ids = items.map((item) => item.id)
  const allSelected = ids.length > 0 && ids.every((id) => selected.includes(id))

  return allSelected ? selected.filter((id) => !ids.includes(id)) : ids
}

/**
 * Ce que la sélection contient, **recoupé avec les items réellement affichés**.
 *
 * ⚠️ Le recoupement n'est pas une précaution de style : une sélection survivant à un changement
 * de page compterait des items absents de l'écran, et le dialogue annoncerait un nombre que
 * l'utilisateur ne peut pas vérifier. Ce qui n'est plus affiché ne compte pas.
 */
export function summarizeSelection(items: SelectableItem[], selected: number[]): SelectionSummary {
  const chosen = items.filter((item) => selected.includes(item.id))

  return {
    total: chosen.length,
    media: chosen.filter((item) => isMediaItem(item.type)).length,
  }
}

/**
 * Le texte du dialogue de confirmation — **le seul garde-fou entre un clic et trente photos**.
 *
 * ⚠️ **Il doit dire combien d'assets partent à la corbeille d'Immich**, pas seulement combien
 * d'éléments disparaissent de l'écran. Supprimer un article ne touche que Command Center ;
 * supprimer une image écrit dans un autre système, et l'utilisateur doit voir la différence
 * **avant** de cliquer, pas après.
 *
 * Rend `null` quand il n'y a rien à supprimer : pas de dialogue pour un geste sans effet.
 */
export function confirmationMessage(summary: SelectionSummary): string | null {
  if (summary.total === 0) return null

  const elements = `${summary.total} élément${summary.total > 1 ? 's' : ''}`

  if (summary.media === 0) {
    return `Supprimer ${elements} de la veille ?`
  }

  const assets =
    summary.media > 1
      ? `${summary.media} assets partiront à la corbeille d’Immich`
      : `1 asset partira à la corbeille d’Immich`

  return (
    `Supprimer ${elements} de la veille ?\n\n` +
    `⚠️ ${assets} — récupérables tant que la corbeille les conserve, ` +
    `et retirés de ta bibliothèque en attendant.`
  )
}
