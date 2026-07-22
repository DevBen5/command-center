/**
 * La relecture des brouillons d'ingestion (`pages/ingest_show.vue`) — ses prédicats et la
 * dérivation de la correction en cours.
 *
 * ⚠️ **Ce fichier vit ici pour être atteignable par la suite de tests.** Japa importe des `.ts`
 * et n'a aucun compilateur Vue : tout ce qui reste dans un `<script setup>` est structurellement
 * hors de sa portée. `isDirty` décide si le bouton *Enregistrer* existe, `halfClassified` si un
 * brouillon est signalé — ce sont des décisions, elles doivent pouvoir rougir.
 *
 * ⚠️ **N'importe jamais par un alias `#modules/*` depuis ce dossier.** L'alias mappe vers
 * `./app/modules/*.js`, des fichiers qui n'existent qu'après un build : Vite ne les résout pas,
 * et la page casserait. Seuls le relatif et les paquets npm purs sont permis. Le garde-fou est
 * `npm run build` — `tsc` ne lit pas les `.vue`.
 *
 * Ce fichier est **pur** : ni base, ni horloge, ni DOM, ni Vue.
 */

/**
 * Le brouillon **tel qu'il est à l'écran** — la copie locale éditable, dont les champs de
 * taxonomie sont toujours des chaînes (le sélecteur rend `''`, jamais `null`).
 */
export interface EditedDraft {
  front: string
  back: string
  category: string
  theme: string
}

/**
 * Le brouillon **tel qu'il est en base** — ce que le modèle a proposé, ou la dernière
 * correction enregistrée. Sa taxonomie est nullable, contrairement à la copie éditable.
 *
 * ⚠️ Volontairement structurel plutôt que le `Draft` de la page : c'est ce qui garde ce fichier
 * sans dépendance, et permet à un test de se contenter d'objets nus.
 */
export interface StoredDraft {
  id: number
  front: string
  back: string
  category: string | null
  theme: string | null
}

/** La forme envoyée au serveur : la taxonomie vide redevient `null`, jamais `''`. */
export interface DraftCorrection {
  id: number
  front: string
  back: string
  category: string | null
  theme: string | null
}

/** Le thème seul n'a pas de sens : il appartient toujours à une catégorie. */
export function halfClassified(draft: EditedDraft): boolean {
  return Boolean(draft.category.trim()) !== Boolean(draft.theme.trim())
}

/**
 * Les thèmes déjà existants sous une catégorie donnée, par son nom (casse ignorée).
 *
 * C'est ce qui fait « dépendre » le thème de la catégorie : tant qu'aucune catégorie connue
 * n'est choisie, il n'y a rien à suggérer ; une catégorie inventée n'a, par définition, aucun
 * thème existant — il sera créé à la volée à la validation.
 */
export function themesFor(
  categories: { name: string; themes: { name: string }[] }[],
  categoryName: string
): string[] {
  const name = categoryName.trim().toLowerCase()
  if (name === '') return []

  const match = categories.find((category) => category.name.toLowerCase() === name)
  return match ? match.themes.map((theme) => theme.name) : []
}

/**
 * Le brouillon tel qu'il est **à l'écran** — la correction, pas ce qu'en dit la base.
 *
 * ⚠️ **Une taxonomie vide se rend `null`, pas `''`.** C'est ce que le serveur attend, et c'est
 * aussi ce qui fait tenir la comparaison de `isDirty` : la base stocke `null` pour une carte non
 * classée, et `'' !== null` serait **toujours** vrai — le bouton *Enregistrer* ne disparaîtrait
 * jamais sur un brouillon non classé.
 */
export function correctionOf(id: number, draft: EditedDraft): DraftCorrection {
  return {
    id,
    front: draft.front,
    back: draft.back,
    category: draft.category.trim() || null,
    theme: draft.theme.trim() || null,
  }
}

/**
 * Y a-t-il quelque chose à enregistrer ? Sinon le bouton n'a rien à faire.
 *
 * ⚠️ **La comparaison porte sur la correction normalisée, pas sur la copie brute** — voir
 * `correctionOf`. Comparer `draft.category` à `original.category` directement ferait diverger
 * `''` et `null` sur tout brouillon non classé, sans qu'aucune erreur ne se voie : le bouton
 * resterait allumé en permanence.
 */
export function isDirty(original: StoredDraft, draft: EditedDraft): boolean {
  const current = correctionOf(original.id, draft)

  return (
    current.front !== original.front ||
    current.back !== original.back ||
    current.category !== original.category ||
    current.theme !== original.theme
  )
}
