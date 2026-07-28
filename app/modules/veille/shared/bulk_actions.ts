/**
 * Les actions groupées sur une sélection (CC-109) — **ce qu'elles permettent, ce qu'elles
 * annoncent**.
 *
 * **Pur, serveur ET page** : la liste est fermée des deux côtés, et le message du retour se dérive
 * ici plutôt que dans un `<script setup>` — Japa n'a aucun compilateur Vue, ce qui vit dans un
 * template est structurellement hors de portée de la suite.
 *
 * ⚠️ **Aucun import par alias `#modules/*`** : l'alias vise des `.js` qui n'existent qu'après un
 * build, Vite ne les résout pas et la page casse.
 */

/**
 * ⚠️ **Une liste fermée, et l'action voyage jusqu'au serveur.** Elle nomme une colonne et un
 * geste : la laisser libre ferait d'une chaîne cliente le pilote d'un `UPDATE`. Les quatre valeurs
 * sont les seules que le validateur accepte, et le `switch` du service est exhaustif.
 */
export const BULK_ACTIONS = [
  'tag.add',
  'tag.remove',
  'read',
  'unread',
  'queue.add',
  'queue.remove',
] as const

export type BulkAction = (typeof BULK_ACTIONS)[number]

/** Les deux actions qui ont besoin d'un tag. Le validateur s'en sert, la page aussi. */
export function requiresTag(action: BulkAction): boolean {
  return action === 'tag.add' || action === 'tag.remove'
}

export function isBulkAction(value: unknown): value is BulkAction {
  return typeof value === 'string' && (BULK_ACTIONS as readonly string[]).includes(value)
}

/** Ce que chaque action dit d'elle-même quand elle a réellement bougé quelque chose. */
const DONE: Record<BulkAction, (count: string) => string> = {
  'tag.add': (count) => `Tag ajouté sur ${count}.`,
  'tag.remove': (count) => `Tag retiré de ${count}.`,
  'read': (count) => `${count} marqué(s) comme lu(s).`,
  'unread': (count) => `${count} marqué(s) comme non lu(s).`,
  'queue.add': (count) => `${count} mis à lire plus tard.`,
  'queue.remove': (count) => `${count} retiré(s) de « À lire plus tard ».`,
}

/** Ce que chaque action dit quand elle n'a rien changé — parce que c'était **déjà** le cas. */
const ALREADY: Record<BulkAction, string> = {
  'tag.add': 'Rien à faire : ces éléments portaient déjà ce tag.',
  'tag.remove': 'Rien à faire : aucun de ces éléments ne portait ce tag.',
  'read': 'Rien à faire : ces éléments étaient déjà lus.',
  'unread': 'Rien à faire : ces éléments étaient déjà non lus.',
  'queue.add': 'Rien à faire : ces éléments étaient déjà à lire plus tard.',
  'queue.remove': 'Rien à faire : aucun de ces éléments n’était à lire plus tard.',
}

export type BulkNotification = { type: 'success' | 'info'; message: string }

/**
 * Le retour d'une action groupée — **deux tons, jamais le silence**.
 *
 * ⚠️ **Le ton `info` n'est pas du décor, et le cas arrive pour de vrai** : marquer lu une sélection
 * déjà lue, retirer un tag qu'aucun item ne porte, un second onglet passé avant. Sans message, le
 * bouton paraît cassé et le réflexe est de recliquer — ce qui ne changera rien non plus. Ni un
 * succès (rien n'a bougé) ni une erreur (rien n'a échoué) : un constat.
 *
 * ⚠️ **Il n'y a que deux tons ici, pas trois.** La suppression en a un troisième parce qu'elle
 * écrit dans Immich et peut échouer à mi-chemin ; **aucune de ces quatre actions ne sort de
 * Command Center**. Un `UPDATE` qui lève remonte en 500, il n'a pas de ton.
 *
 * Le compte annoncé est celui des lignes **réellement** modifiées, jamais la taille de la
 * sélection : les deux diffèrent dès qu'une partie était déjà dans l'état visé, et annoncer la
 * seconde ferait croire à un effet qui n'a pas eu lieu.
 */
export function bulkNotification(action: BulkAction, affected: number): BulkNotification {
  if (affected === 0) return { type: 'info', message: ALREADY[action] }

  const count = `${affected} élément${affected > 1 ? 's' : ''}`
  return { type: 'success', message: DONE[action](count) }
}
