import type { DateTime } from 'luxon'
import type { Grade } from '#modules/leitner/services/leitner_service'

/**
 * Le **critère de maîtrise** : à partir de quand une carte cesse d'être « en cours » pour
 * devenir un acquis (CC-260).
 *
 * ⚠️ **Ce fichier est PUR** — ni base, ni horloge : `now` est un paramètre, comme dans
 * `leitner_habits.ts` et `leitner_sessions.ts`. C'est ce qui rend le critère prouvable
 * unitairement, sans conteneur Postgres et sans attendre trente jours.
 *
 * ⚠️ **Personne ne lit encore ce que ce fichier décide.** CC-260 pose les marques et rien
 * d'autre : aucune file, aucun compteur, aucun écran ne change. CC-261 (sortie de file et
 * régime d'entretien) puis CC-262 (l'inventaire visible) les consommeront.
 */

/** La boîte terminale. Une carte n'est candidate à la maîtrise que là. */
const BOX5 = 5

/**
 * Le **plancher** du délai, en jours — constant, indépendant du réglage, et c'est le point
 * qui fonde tout le critère.
 *
 * ⚠️ `leitner_settings` est un réglage d'**installation** : une seule ligne
 * (`check(id = 1)`), partagée par tous les comptes, réglable de 1 à 365 jours. Si le
 * critère suivait ce seul réglage, « maîtrisée » voudrait dire deux choses différentes
 * avant et après que quelqu'un l'ait touché — **sur des cartes déjà marquées**. Un
 * inventaire d'acquis est une affirmation sur la mémoire d'une personne, pas sur la
 * configuration de l'application.
 *
 * Par défaut (`box5Days = 30`) ce plancher est **inerte** : il ne mord que si on raccourcit
 * l'intervalle de la boîte 5.
 */
export const MASTERY_MIN_DAYS = 30

/** Le délai réellement exigé : l'intervalle réglé, mais jamais sous le plancher. */
export function masteryDelayDays(box5Days: number): number {
  return Math.max(box5Days, MASTERY_MIN_DAYS)
}

/**
 * Les deux marques que porte une progression : l'horloge de boîte 5 et la date
 * d'acquisition. Elles bougent **ensemble** — voir `nextMasteryState`.
 */
export interface MasteryState {
  box5EnteredAt: DateTime | null
  masteredAt: DateTime | null
}

export interface MasteryInput {
  /** La boîte **avant** la note. C'est elle que le critère interroge, jamais celle d'après. */
  boxBefore: number
  /** La boîte atteinte, telle que `LeitnerService.nextBox` l'a calculée. */
  boxAfter: number
  grade: Grade
  /** Les marques telles qu'elles sont **avant** la note. */
  current: MasteryState
  /** L'intervalle réglé pour la boîte 5, lu en base (`boxIntervals()`), jamais la constante. */
  box5Days: number
  now: DateTime
}

/**
 * ⚠️ **`hard` est une réussite mais ne valide pas.** Décision explicite du propriétaire, et
 * elle crée un écart **visible et assumé** avec `retentionRate` (`leitner_weakness.ts`),
 * qui compte `hard` comme une réussite : ce sont deux barres différentes — la rétention
 * mesure « l'ai-je retrouvé », la maîtrise « le sais-je solidement ». Ne les aligne pas
 * « par cohérence ».
 */
function isMasteringGrade(grade: Grade): boolean {
  return grade === 'good' || grade === 'easy'
}

/** Le délai est-il écoulé depuis que la carte est en boîte 5 ? Bornes **incluses**. */
function hasWaitedLongEnough(enteredAt: DateTime, box5Days: number, now: DateTime): boolean {
  return now >= enteredAt.plus({ days: masteryDelayDays(box5Days) })
}

/**
 * Les marques de maîtrise **après** une note. Les trois conditions du critère, appliquées
 * au moment de noter :
 *
 * 1. la carte était **déjà** en boîte 5 (pas celle qui vient d'y arriver) ;
 * 2. la note est **`good` ou `easy`** ;
 * 3. il s'est écoulé au moins `max(box5Days, 30)` jours depuis `box5EnteredAt`.
 *
 * ⚠️ **L'horloge et l'acquis bougent ensemble** : ce qui réarme la première efface le
 * second. Une seule règle, plutôt que deux qui finiraient par diverger.
 *
 * ⚠️ **Seul `again` réarme, jamais `hard` — décision prise faute de consigne, et à
 * confirmer.** Raison : `hard` a été qualifié de réussite par le propriétaire, et réarmer
 * serait une punition. Conséquence mesurable : avec `box5Days < 30`, un `hard` retarde la
 * maîtrise d'**un intervalle** au lieu de la repousser au-delà du plancher. Si l'arbitrage
 * doit basculer, c'est **une ligne** ci-dessous.
 */
export function nextMasteryState(input: MasteryInput): MasteryState {
  const { boxBefore, boxAfter, grade, current, box5Days, now } = input

  // La carte sort de la boîte 5 (le 2ᵉ `hard` d'affilée, seul chemin de rétrogradation du
  // module) : plus d'horloge, plus d'acquis.
  // ⚠️ Le nettoyage n'est pas cosmétique : laissée en place, la colonne affirmerait « en
  // boîte 5 depuis X » d'une carte en boîte 1, et tout consommateur qui lirait
  // `box5_entered_at IS NOT NULL` comme « est en boîte 5 » serait faux.
  if (boxAfter !== BOX5) return { box5EnteredAt: null, masteredAt: null }

  // Entrée en boîte 5, ou échec sur une carte qui y était déjà : l'horloge repart de zéro,
  // et l'acquis avec elle. C'est la seule chose qui démaîtrise une carte.
  if (boxBefore !== BOX5 || grade === 'again') {
    return { box5EnteredAt: now, masteredAt: null }
  }

  // Déjà en boîte 5, la note est une réussite (`hard`, `good` ou `easy`) : l'horloge court.
  // ⚠️ Le repli sur `now` couvre la carte **importée** directement en boîte 5, qui arrive
  // sans horloge : la laisser `null` la rendrait définitivement non maîtrisable, en
  // silence. On ne sait pas quand elle est entrée, donc on compte à partir de maintenant —
  // ce qui fait aussi que cette note-ci ne peut pas la valider (le délai n'est pas écoulé).
  const enteredAt = current.box5EnteredAt ?? now

  // ⚠️ Une date d'acquisition ne dérive pas : une fois posée, les réussites suivantes la
  // conservent. Elle avancerait à chaque `good` et ne daterait plus rien.
  if (current.masteredAt !== null) {
    return { box5EnteredAt: enteredAt, masteredAt: current.masteredAt }
  }

  const mastered = isMasteringGrade(grade) && hasWaitedLongEnough(enteredAt, box5Days, now)
  return { box5EnteredAt: enteredAt, masteredAt: mastered ? now : null }
}
