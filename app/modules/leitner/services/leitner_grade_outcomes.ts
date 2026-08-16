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

/**
 * **Les deux seules réponses d'un entretien** (CC-265) — « je l'ai perdu », « je le sais
 * encore » —, dans le même ordre que les quatre autres : du plus sévère au plus généreux.
 *
 * ⚠️ **Ce n'est pas une préférence d'affichage, c'est la suppression de trois boutons qui
 * faisaient la même chose.** Sur une carte acquise (donc en boîte 5), `hard`, `good` et
 * `easy` rendaient un `GradeOutcome` **identique** : le plafond de boîte écrase `+1` et
 * `+2` (`min(5, 5+1) = min(5, 5+2) = 5`), et l'échéance ne vient plus de la boîte mais de
 * `maintenanceIntervalDays(rang, box5Days)`, qui **ne lit pas la note**. Un entretien est
 * une **vérification**, pas un apprentissage : il n'y a aucune boîte à gagner, donc rien
 * que la granularité en quatre puisse exprimer.
 *
 * ⚠️ **`hard` ne disparaît pas par symétrie, il disparaît parce qu'il MENT.** `nextBox`
 * rend `lastGrade === 'hard' ? 1 : box` : un « Difficile » qui suit un « Difficile »
 * renvoie en boîte 1 **et fait perdre l'acquis**. Le bouton était donc inoffensif *sauf*
 * quand la note précédente était déjà « Difficile » — un effet qui dépend d'un état que
 * l'écran ne montre pas, sur une file dont les visites sont espacées de 90 à 365 jours.
 * Un bouton pareil est pire qu'un bouton redondant.
 *
 * ⚠️ **`good` et non `easy` pour « je le sais encore » — décision du propriétaire
 * (2026-08-16).** Les deux rendent exactement la même sortie ici (le plafond et l'échelle
 * effacent la différence), mais c'est `leitner_reviews.grade` qui tranche : `good` est ce
 * qu'un clic « Correct » enregistrait déjà en entretien, quand `easy` affirmerait « rappel
 * immédiat » là où le bouton ne dit que « je le sais ». Rien ne distingue les deux en
 * aval (rétention, points faibles, critère de maîtrise), donc le gain serait nul et la
 * sur-affirmation réelle.
 *
 * ⚠️ **Conséquence actée, pas subie : l'entretien n'écrit plus jamais `hard`, donc il
 * n'ARME plus la règle du 2ᵉ `hard` d'affilée** pour la révision suivante de la carte.
 * Il ne pouvait déjà que l'armer — une carte acquise l'a forcément été par un `good` ou
 * un `easy`, jamais par un `hard` (`isMasteringGrade`, `leitner_mastery.ts`). Le signal
 * d'échec d'un entretien est `again`, qui sort la carte des acquis et la renvoie dans la
 * file normale, où les quatre notes **et** la règle sont intactes.
 *
 * ⚠️ **La règle du serveur n'a PAS bougé** : `POST /revision/:id/review` accepte toujours
 * les quatre notes, et `LeitnerService.review()` traite un `hard` d'entretien exactement
 * comme avant. Masquer un bouton n'est pas un droit — ce lot ferme un piège d'**écran**,
 * pas une règle, et retirer `hard` du validateur serait un changement de comportement que
 * l'écran ne peut plus produire.
 */
const MAINTENANCE_GRADES: readonly Grade[] = ['again', 'good'] as const

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
 * Les effets proposés, dans l'ordre des boutons : **quatre** en file normale, **deux** en
 * entretien (CC-265, voir `MAINTENANCE_GRADES`).
 *
 * ⚠️ **L'échéance suit la file où la carte VA, jamais celle d'où elle vient** — la même
 * règle, écrite au même endroit qu'elle est appliquée dans `review()` (CC-261). La note
 * qui acquiert la maîtrise repart donc au **premier palier**, pas à l'intervalle de la
 * boîte 5 ; et un `again` en entretien ramène la carte dans la file normale **aujourd'hui**.
 *
 * ⚠️ **La file se DÉDUIT de `mastery.masteredAt`, elle ne se passe pas en paramètre.** Les
 * deux files sont disjointes par construction (`mastered_at is null` contre `is not null`,
 * `leitner_progress.ts`) : « la carte est acquise » **est** « on est en entretien ». Un
 * paramètre `queue` de plus serait un second témoin de la même chose, donc quelque chose
 * qui peut contredire le premier — et l'écran proposerait alors deux réponses sur une
 * carte que la règle traite comme quatre, ou l'inverse, sans que rien ne le signale.
 */
export function gradeOutcomes(input: GradeOutcomeInput): GradeOutcome[] {
  const { box, lastGrade, mastery, maintenanceRank, boxIntervals, now } = input
  const box5Days = boxIntervals[5]
  const grades = mastery.masteredAt !== null ? MAINTENANCE_GRADES : GRADES

  return grades.map((grade) => {
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
