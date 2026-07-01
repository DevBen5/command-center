import { DateTime } from 'luxon'
import LeitnerCard from '#models/leitner_card'
import LeitnerReview from '#models/leitner_review'

// Intervalle (en jours) avant la prochaine révision, selon la boîte atteinte.
const BOX_INTERVAL_DAYS: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 30 }

export type Grade = 'again' | 'hard' | 'good' | 'easy'

export default class LeitnerService {
  async review(card: LeitnerCard, grade: Grade): Promise<LeitnerCard> {
    const passed = grade !== 'again'
    card.box = passed ? Math.min(5, card.box + 1) : 1
    card.nextReview = DateTime.now().plus({ days: BOX_INTERVAL_DAYS[card.box] })
    await card.save()

    await LeitnerReview.create({
      leitnerCardId: card.id,
      grade,
      reviewedAt: DateTime.now(),
    })

    return card
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
