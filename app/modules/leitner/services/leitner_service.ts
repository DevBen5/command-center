import { DateTime } from 'luxon'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerReview from '#modules/leitner/models/leitner_review'

// Intervalle (en jours) avant la prochaine révision, selon la boîte **atteinte**
// (donc après mouvement). Source de vérité unique : le contrôleur envoie cette
// table à la page, qui ne la redéclare pas.
export const BOX_INTERVAL_DAYS: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 30 }

export type Grade = 'again' | 'hard' | 'good' | 'easy'

export default class LeitnerService {
  /**
   * Applique une note à une carte. Chaque note a un effet distinct :
   *
   * - `again` : retour boîte 1, **due le jour même**. La carte reste dans
   *   `dueCards` et revient en fin de file dans la session en cours — le geste
   *   du Leitner physique : on ne range pas une carte qu'on vient de rater.
   * - `hard`  : la carte **stagne** dans sa boîte. Deux `hard` consécutifs sur
   *   la même carte la renvoient en boîte 1 : stagner deux fois n'est pas savoir.
   * - `good`  : +1 boîte.
   * - `easy`  : +2 boîtes.
   *
   * Hors `again`, `next_review` = aujourd'hui + l'intervalle de la boîte atteinte.
   * La boîte est plafonnée à 5.
   */
  async review(card: LeitnerCard, grade: Grade): Promise<LeitnerCard> {
    card.box = await this.nextBox(card, grade)
    card.nextReview =
      grade === 'again'
        ? DateTime.now()
        : DateTime.now().plus({ days: BOX_INTERVAL_DAYS[card.box] })
    await card.save()

    await LeitnerReview.create({
      leitnerCardId: card.id,
      grade,
      reviewedAt: DateTime.now(),
    })

    return card
  }

  /** Boîte atteinte par la carte pour cette note, avant enregistrement. */
  private async nextBox(card: LeitnerCard, grade: Grade): Promise<number> {
    switch (grade) {
      case 'again':
        return 1
      case 'hard':
        return (await this.lastGrade(card)) === 'hard' ? 1 : card.box
      case 'good':
        return Math.min(5, card.box + 1)
      case 'easy':
        return Math.min(5, card.box + 2)
    }
  }

  /** Dernière note enregistrée pour cette carte, `null` si jamais révisée. */
  async lastGrade(card: LeitnerCard): Promise<Grade | null> {
    const last = await LeitnerReview.query()
      .where('leitner_card_id', card.id)
      .orderBy('reviewed_at', 'desc')
      .orderBy('id', 'desc')
      .first()
    return last?.grade ?? null
  }

  /** Dernière note de chacune des cartes données, en une requête. */
  async lastGrades(cardIds: number[]): Promise<Map<number, Grade>> {
    const grades = new Map<number, Grade>()
    if (cardIds.length === 0) return grades

    const reviews = await LeitnerReview.query()
      .whereIn('leitner_card_id', cardIds)
      .orderBy('reviewed_at', 'asc')
      .orderBy('id', 'asc')

    // Trié par ancienneté croissante : la dernière écriture gagne.
    for (const review of reviews) grades.set(review.leitnerCardId, review.grade)
    return grades
  }

  async boxCounts(): Promise<Record<number, number>> {
    const cards = await LeitnerCard.query().select('box')
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    for (const card of cards) counts[card.box] = (counts[card.box] ?? 0) + 1
    return counts
  }

  async reviewedToday(): Promise<number> {
    const startOfDay = DateTime.now().startOf('day')
    const reviews = await LeitnerReview.query().where('reviewed_at', '>=', startOfDay.toSQL()!)
    return reviews.length
  }

  async streakDays(): Promise<number> {
    const reviews = await LeitnerReview.query().orderBy('reviewed_at', 'desc')
    const reviewedDays = new Set(reviews.map((review) => review.reviewedAt.toISODate()))

    let streak = 0
    let cursor = DateTime.now().startOf('day')
    while (reviewedDays.has(cursor.toISODate())) {
      streak++
      cursor = cursor.minus({ days: 1 })
    }
    return streak
  }
}
