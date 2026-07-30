import { DateTime } from 'luxon'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerReview from '#modules/leitner/models/leitner_review'
import {
  type FluencyMeasure,
  isUsableMeasure,
  MIN_CARD_SAMPLES,
  pickReference,
  refineGrade,
} from '#modules/leitner/services/leitner_fluency'
import type { Grade, Verdict } from '#modules/leitner/services/leitner_service'

/**
 * La partie **base** de la fluence : aller chercher la référence, et savoir si la
 * carte a déjà été présentée aujourd'hui. Toute la règle, elle, est dans
 * `leitner_fluency.ts` — du code pur, testable sans transaction : c'est le même
 * découpage que `leitner_sessions.ts` / `LeitnerStatsService`.
 *
 * ⚠️ **Ce service ne remplace pas le juge, il le complète.** `LeitnerJudgeService` dit
 * la **justesse** (juste · partiel · faux) et en déduit un bouton ; celui-ci ajoute
 * l'**effort** par-dessus, et seulement sur `juste`. Ne les fonds pas : le juge
 * n'appelle aucune base, et c'est ce qui le garde testable contre un faux client.
 */
export default class LeitnerFluencyService {
  /**
   * La carte a-t-elle déjà été notée aujourd'hui ?
   *
   * ⚠️ **C'est le serveur qui tranche, jamais la page.** Depuis CC-41, `again` laisse
   * la carte due le jour même et la remet dans la file : la seconde réponse est rapide
   * par **mémoire de travail**, pas par apprentissage. Proposer `easy` dessus
   * reviendrait à promouvoir une carte qu'on vient de rater — c'est la première des
   * trois conditions sans lesquelles la mesure ment.
   *
   * ⚠️ `reviewed_at` est un `timestamp` : `toSQL()`, jamais `toSQLDate()` (qui sert aux
   * colonnes `date` comme `next_review`). Les intervertir passe le typecheck.
   *
   * ⚠️ **La question est « MOI, l'ai-je déjà notée aujourd'hui ? »** (CC-119). Sans le
   * filtre, la révision d'un collègue écarterait ma mesure de fluence : aucune erreur,
   * aucun badge — juste des propositions qui cessent de s'affiner, et une colonne
   * `thinking_ms` qui se vide sans qu'on sache pourquoi.
   */
  async wasPresentedToday(userId: number, cardId: number): Promise<boolean> {
    const startOfDay = DateTime.now().startOf('day')

    const previous = await LeitnerReview.query()
      .select('id')
      .where('user_id', userId)
      .where('leitner_card_id', cardId)
      .where('reviewed_at', '>=', startOfDay.toSQL()!)
      .first()

    return previous !== null
  }

  /**
   * La médiane à laquelle comparer : la carte si elle se connaît assez, sa boîte
   * sinon, `null` s'il n'y a pas encore de quoi juger.
   *
   * Aucun filtre **sur `thinking_ms`**, et ce n'est pas un oubli : la colonne n'est
   * **écrite** que sur une mesure exploitable (voir `LeitnerService.review`), donc elle
   * ne contient par construction que des mesures comparables. C'est le couplage
   * écriture/lecture qui rend cette requête aussi simple.
   *
   * ⚠️ **Le filtre par personne, lui, est indispensable** (CC-119) : la fluence compare
   * quelqu'un à lui-même. Mélanger les mesures de deux comptes ferait dériver la médiane
   * vers la vitesse de frappe du plus rapide, et proposerait `easy` à l'autre sur des
   * cartes qu'il connaît mal. Aucun symptôme visible, juste des suggestions fausses.
   *
   * ⚠️ **La boîte de référence est celle de CETTE personne**, donc une sous-requête sur
   * `leitner_card_progress` — `leitner_cards.box` n'existe plus. Une carte que personne
   * n'a notée n'apparaît dans aucune boîte : elle n'a de toute façon aucune mesure.
   */
  async reference(userId: number, card: LeitnerCard, box: number): Promise<number | null> {
    const cardRows = await LeitnerReview.query()
      .select('thinking_ms')
      .where('user_id', userId)
      .where('leitner_card_id', card.id)
      .whereNotNull('thinking_ms')

    const cardSamples = cardRows.map((review) => review.thinkingMs!)

    // La médiane de boîte ne se charge que si celle de la carte ne suffit pas : sur une
    // carte déjà bien connue, c'est une requête de moins à chaque dévoilement. Le choix
    // entre les deux reste entier dans `pickReference` — ceci n'est qu'un chargement
    // paresseux, pas une seconde copie de la règle.
    if (cardSamples.length >= MIN_CARD_SAMPLES) return pickReference(cardSamples, [])

    const boxRows = await LeitnerReview.query()
      .select('thinking_ms')
      .where('user_id', userId)
      .whereNotNull('thinking_ms')
      .whereIn('leitner_card_id', (sub) =>
        sub
          .from('leitner_card_progress')
          .select('leitner_card_id')
          .where('user_id', userId)
          .where('box', box)
      )

    return pickReference(
      cardSamples,
      boxRows.map((review) => review.thinkingMs!)
    )
  }

  /**
   * La proposition affinée pour cette carte — ou exactement celle de CC-43 quand la
   * fluence n'a rien à dire.
   *
   * Le raccourci d'entrée n'est pas qu'une optimisation : il garantit qu'**aucune
   * requête n'est émise** quand la mesure ne pouvait de toute façon rien affiner
   * (verdict autre que `juste`, réponse non chronométrée, interruption).
   */
  async suggest(
    userId: number,
    card: LeitnerCard,
    box: number,
    verdict: Verdict | null,
    baseGrade: Grade | null,
    measure: Omit<FluencyMeasure, 'represented'>
  ): Promise<Grade | null> {
    if (verdict !== 'juste') return baseGrade

    const represented = await this.wasPresentedToday(userId, card.id)
    const full: FluencyMeasure = { ...measure, represented }
    if (!isUsableMeasure(full)) return baseGrade

    return refineGrade(verdict, baseGrade, full, await this.reference(userId, card, box))
  }
}
