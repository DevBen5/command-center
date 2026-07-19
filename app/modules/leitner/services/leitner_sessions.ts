import type { DateTime } from 'luxon'

/**
 * Le seuil qui sépare deux sessions. **C'est une convention, pas une vérité** : rien
 * dans `leitner_reviews` ne distingue une pause café d'une carte difficile qu'on a
 * ruminée. On l'assume — et c'est précisément pour ça que tout ce qui en découle est
 * publié en **médiane** : une valeur aberrante ne déplace pas une médiane.
 */
export const SESSION_GAP_MINUTES = 30

/**
 * L'entrée minimale du regroupement : un horodatage, et rien d'autre.
 *
 * ⚠️ Volontairement structurel plutôt que `LeitnerReview` — c'est ce qui garde ce
 * fichier **sans base** : un `LeitnerReview[]` s'y passe tel quel (typage structurel),
 * et un test se contente d'objets nus, sans transaction ni migration.
 */
export interface TimedReview {
  reviewedAt: DateTime
}

/**
 * Une grappe de révisions rapprochées.
 *
 * `durationSeconds` vaut **0 pour une session à une seule carte**, et s'affiche tel
 * quel : on n'a aucun moyen de savoir quand elle a commencé (voir `cardSeconds`).
 * La masquer serait mentir sur l'effort.
 */
export interface LeitnerSession {
  startedAt: DateTime
  endedAt: DateTime
  cardCount: number
  durationSeconds: number
  /**
   * Le temps passé sur chaque carte, en secondes — **`cardCount - 1` valeurs**.
   *
   * L'écran de révision est sans état (noter recharge `/revision` et affiche la
   * suivante aussitôt) : l'horodatage de la note N est donc aussi le **début** de la
   * carte N+1. La première carte d'une session n'a pas ce début — personne ne sait
   * quand l'utilisateur a ouvert la page — et n'a donc pas de temps mesurable.
   */
  cardSeconds: number[]
}

/**
 * Découpe un historique de révisions en sessions : une grappe s'arrête dès que
 * l'écart avec la révision suivante dépasse `gapMinutes`.
 *
 * ⚠️ **L'entrée est triée ici, sur une copie.** C'est le mode d'échec silencieux du
 * lot : une requête sans `orderBy` rend un ordre arbitraire, et un découpage sur une
 * suite désordonnée produit des sessions absurdes — sans lever, sans log, avec des
 * chiffres parfaitement plausibles à l'écran. L'appelant trie aussi de son côté ; ce
 * tri-ci est la garantie qu'aucun futur appelant ne peut retirer.
 */
export function groupIntoSessions(
  reviews: TimedReview[],
  gapMinutes: number = SESSION_GAP_MINUTES
): LeitnerSession[] {
  if (reviews.length === 0) return []

  const sorted = [...reviews].sort((a, b) => a.reviewedAt.toMillis() - b.reviewedAt.toMillis())
  const gapSeconds = gapMinutes * 60

  const sessions: LeitnerSession[] = []
  let cluster: TimedReview[] = [sorted[0]]

  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1]
    const current = sorted[index]
    const elapsed = current.reviewedAt.diff(previous.reviewedAt, 'seconds').seconds

    // Strictement supérieur : un écart d'exactement `gapMinutes` reste la même session.
    if (elapsed > gapSeconds) {
      sessions.push(toSession(cluster))
      cluster = []
    }
    cluster.push(current)
  }
  sessions.push(toSession(cluster))

  return sessions
}

function toSession(cluster: TimedReview[]): LeitnerSession {
  const startedAt = cluster[0].reviewedAt
  const endedAt = cluster[cluster.length - 1].reviewedAt

  const cardSeconds: number[] = []
  for (let index = 1; index < cluster.length; index++) {
    cardSeconds.push(
      cluster[index].reviewedAt.diff(cluster[index - 1].reviewedAt, 'seconds').seconds
    )
  }

  return {
    startedAt,
    endedAt,
    cardCount: cluster.length,
    durationSeconds: endedAt.diff(startedAt, 'seconds').seconds,
    cardSeconds,
  }
}

/**
 * La médiane — **pas la moyenne**, et le choix est structurel : une session à deux
 * cartes écrase une moyenne de durée, une carte sur laquelle on est parti chercher un
 * café écrase une moyenne de temps par carte. La médiane, elle, les ignore.
 *
 * Deux pièges tenus ici :
 *
 * - le **comparateur numérique est obligatoire** — `[9, 10, 100].sort()` trie en
 *   lexicographique et rend `[10, 100, 9]`, donc une médiane fausse et plausible ;
 * - **rien à mesurer rend `null`, jamais `0`** — une base neuve annoncerait sinon
 *   « 0 min par carte », qui se lit comme une mesure alors que c'est une absence.
 */
export function median(values: number[]): number | null {
  if (values.length === 0) return null

  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}
