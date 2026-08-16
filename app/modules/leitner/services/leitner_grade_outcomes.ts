import { maintenanceIntervalDays } from '#modules/leitner/services/leitner_maintenance'
import { nextMasteryState, type MasteryState } from '#modules/leitner/services/leitner_mastery'
import type { DateTime } from 'luxon'
import type { Grade } from '#modules/leitner/services/leitner_service'
// ⚠️ **La forme de sortie est déclarée du côté PAGE, et importée ici** — elle voyage en prop
// jusqu'à `index.vue`, et un fichier de `shared/` ne peut pas importer par un alias
// `#modules/*` (Vite ne le résout pas). Deux déclarations divergeraient au premier champ
// ajouté, sans que `tsc` ne voie rien : il ne lit pas les `.vue`.
import type { GradeOutcome } from '#modules/leitner/shared/review_page'

export type { GradeOutcome }

/**
 * **Ce que chaque note va faire** — la boîte atteinte, l'acquis, et dans combien de jours
 * la carte reviendra (CC-262).
 *
 * ⚠️ **Ce fichier est PUR** — ni base, ni horloge : `now`, le réglage et le rang sont des
 * paramètres, comme dans `leitner_mastery.ts` et `leitner_maintenance.ts`.
 *
 * **Pourquoi il existe.** L'écran de révision annonce sous chaque bouton l'effet de la
 * note, et il le calculait lui-même : `Math.min(5, card.box + 2)` recopié dans le
 * `<script setup>` d'`index.vue`, plus l'intervalle de la boîte atteinte. Cette copie est
 * devenue **fausse** avec CC-261 sans qu'aucun test ne bouge — jsdom ne lit pas les
 * libellés, et rien ne comparait les deux formulations :
 *
 * - la note qui **acquiert** la maîtrise annonçait « Boîte 5 · dans 30 j » alors que la
 *   carte repart au premier palier d'entretien, 90 j ;
 * - en **entretien** (CC-262 ouvre cette file), elle annoncerait 30 j là où la carte
 *   revient dans 90, 180 ou 365.
 *
 * ⚠️ **Ce n'est donc pas une troisième copie du plafond, c'est la suppression de la
 * deuxième.** `nextBox` a été *déplacée* ici depuis `LeitnerService` (à l'identique, elle y
 * était déjà pure et privée) : la règle qui décide et l'affichage qui l'annonce lisent
 * désormais la **même** fonction. Une divergence redeviendrait un écran qui promet 90 j
 * pendant que la base écrit 30 — indétectable autrement qu'à l'œil, des semaines plus tard.
 *
 * ⚠️ **Aucune décision nouvelle ici.** Ce fichier n'ajoute aucune règle : il applique
 * `nextBox`, `nextMasteryState` et `maintenanceIntervalDays` dans le **même ordre** que
 * `LeitnerService.review()`. S'il faut changer un comportement, c'est là-bas — jamais ici.
 */

/**
 * Boîte atteinte pour cette note, à partir de la boîte courante et de la **note
 * précédente de la même personne**. Pure : elle ne lit ni base ni horloge, ce qui la
 * rend assertable directement — et empêche qu'un appelant lui glisse le `lastGrade`
 * d'un autre compte sans que ça se voie.
 */
export function nextBox(box: number, grade: Grade, lastGrade: Grade | null): number {
  switch (grade) {
    case 'again':
      // La boîte est inchangée : `again` remet la carte dans la session, il ne
      // rétrograde pas. Seul `next_review` bouge (à aujourd'hui), dans `review()`.
      return box
    case 'hard':
      return lastGrade === 'hard' ? 1 : box
    case 'good':
      return Math.min(5, box + 1)
    case 'easy':
      return Math.min(5, box + 2)
  }
}

/** L'ordre des boutons de l'écran de révision, du plus sévère au plus généreux. */
const GRADES: readonly Grade[] = ['again', 'hard', 'good', 'easy'] as const

export interface GradeOutcomeInput {
  /** La boîte **avant** la note (celle de cette personne, jamais une colonne de la carte). */
  box: number
  /** La note précédente **de la même personne** : elle arme la règle du 2ᵉ `hard`. */
  lastGrade: Grade | null
  /** Les marques de maîtrise **avant** la note. */
  mastery: MasteryState
  /**
   * Combien de paliers d'entretien ont déjà été consommés depuis `mastered_at`.
   *
   * ⚠️ **Il ne sert que si la carte est DÉJÀ maîtrisée.** Une carte que cette note
   * *acquiert* repart au rang 0 par construction : `mastered_at` vaut alors `now`, donc
   * aucune révision ne lui est postérieure. C'est exactement ce que compte
   * `LeitnerService.maintenanceRank`, et c'est pourquoi il n'y a rien à interroger pour
   * la file normale.
   */
  maintenanceRank: number
  /** Les intervalles des cinq boîtes, **lus en base**, jamais les constantes de départ. */
  boxIntervals: Record<number, number>
  now: DateTime
}

/**
 * Les quatre effets, dans l'ordre des boutons.
 *
 * ⚠️ **L'échéance suit la file où la carte VA, jamais celle d'où elle vient** — la même
 * règle, écrite au même endroit qu'elle est appliquée dans `review()` (CC-261). La note
 * qui acquiert la maîtrise repart donc au **premier palier**, pas à l'intervalle de la
 * boîte 5 ; et un `again` en entretien ramène la carte dans la file normale **aujourd'hui**.
 */
export function gradeOutcomes(input: GradeOutcomeInput): GradeOutcome[] {
  const { box, lastGrade, mastery, maintenanceRank, boxIntervals, now } = input
  const box5Days = boxIntervals[5]

  return GRADES.map((grade) => {
    const boxAfter = nextBox(box, grade, lastGrade)
    const after = nextMasteryState({
      boxBefore: box,
      boxAfter,
      grade,
      current: mastery,
      box5Days,
      now,
    })
    const mastered = after.masteredAt !== null

    // ⚠️ Le rang du **cycle en cours** ne vaut que pour une carte déjà acquise : une carte
    // que cette note acquiert n'a consommé aucun palier, et `mastered_at` étant réécrit à
    // chaque acquisition, les entretiens du cycle précédent tombent hors de la fenêtre.
    const rank = mastery.masteredAt !== null ? maintenanceRank : 0

    const days =
      grade === 'again'
        ? 0
        : mastered
          ? maintenanceIntervalDays(rank, box5Days)
          : boxIntervals[boxAfter]

    return { grade, box: boxAfter, mastered, days }
  })
}
