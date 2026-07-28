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
 * ⚠️ **Cette case ne coche que la page**, et il n'y a rien à « corriger » ici : le geste
 * inter-pages existe depuis CC-108, mais il ne passe **pas** par des cases. La page n'envoie
 * alors aucune liste d'identifiants — elle envoie le filtre, et le serveur agit sur ce que ce
 * filtre désigne, après l'avoir recompté. Étendre cette fonction aux autres pages rendrait à la
 * page une autorité qu'on lui a précisément retirée, et ferait rentrer le geste sous le plafond
 * de 200 identifiants du validateur.
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
 * D'où vient l'ensemble qu'on s'apprête à supprimer.
 *
 * ⚠️ **Les deux ne se ressemblent pas, et c'est délibéré** (CC-108). « 12 sélectionnés » désigne
 * ce qu'on a coché sous les yeux ; « les 317 que ce filtre désigne » désigne trois pages qu'on
 * n'a pas lues. Les confondre est le moyen le plus simple de supprimer 317 items en croyant en
 * supprimer 12 — le dialogue est le dernier endroit où la différence peut encore se voir.
 */
export type SelectionScope = 'selected' | 'filtered'

/**
 * Le texte du dialogue de confirmation — **le seul garde-fou entre un clic et trente photos**.
 *
 * ⚠️ **Il doit dire combien d'assets partent à la corbeille d'Immich**, pas seulement combien
 * d'éléments disparaissent de l'écran. Supprimer un article ne touche que Command Center ;
 * supprimer une image écrit dans un autre système, et l'utilisateur doit voir la différence
 * **avant** de cliquer, pas après.
 *
 * ⚠️ **`scope` n'a pas de valeur par défaut**, et c'est voulu : un défaut ferait du cas le moins
 * dangereux le comportement implicite, donc un appelant distrait annoncerait « 317 sélectionnés »
 * pour un geste qui en emporte 317 sans que personne les ait vus. Le choix est explicite à chaque
 * appel.
 *
 * ⚠️ **Sur un filtre, le nombre vient du SERVEUR au moment du geste**, pas de ce qu'affichait la
 * page : une collecte tourne toutes les minutes, et le total a pu bouger depuis le rendu.
 *
 * Rend `null` quand il n'y a rien à supprimer : pas de dialogue pour un geste sans effet.
 */
export function confirmationMessage(
  summary: SelectionSummary,
  scope: SelectionScope
): string | null {
  if (summary.total === 0) return null

  const elements = `${summary.total} élément${summary.total > 1 ? 's' : ''}`
  const subject =
    scope === 'filtered'
      ? `les ${elements} que ce filtre désigne`
      : `${elements} sélectionné${summary.total > 1 ? 's' : ''}`

  if (summary.media === 0) {
    return `Supprimer ${subject} de la veille ?`
  }

  const assets =
    summary.media > 1
      ? `${summary.media} assets partiront à la corbeille d’Immich`
      : `1 asset partira à la corbeille d’Immich`

  return (
    `Supprimer ${subject} de la veille ?\n\n` +
    `⚠️ ${assets} — récupérables tant que la corbeille les conserve, ` +
    `et retirés de ta bibliothèque en attendant.`
  )
}
