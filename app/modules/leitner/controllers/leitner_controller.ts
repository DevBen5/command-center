import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerReview from '#modules/leitner/models/leitner_review'
import LeitnerService from '#modules/leitner/services/leitner_service'
import { cardValidator, reviewValidator } from '#modules/leitner/validators/leitner'

export default class LeitnerController {
  async index({ inertia }: HttpContext) {
    const service = new LeitnerService()
    const today = DateTime.now().startOf('day')

    const dueCards = await LeitnerCard.query()
      .where('next_review', '<=', today.toSQLDate()!)
      .orderBy('box')
    const boxCounts = await service.boxCounts()
    const reviewedToday = await service.reviewedToday()
    const streak = await service.streakDays()

    const totalCards = await LeitnerCard.query().count('* as total')
    const recentReviews = await LeitnerReview.query().where(
      'reviewed_at',
      '>=',
      today.minus({ days: 30 }).toSQL()!
    )
    const retention =
      recentReviews.length > 0
        ? Math.round(
            (recentReviews.filter((r) => r.grade !== 'again').length / recentReviews.length) * 100
          )
        : null

    return inertia.render('modules/leitner/index', {
      dueCards,
      boxCounts,
      stats: {
        reviewedToday,
        streak,
        dueCount: dueCards.length,
        totalCards: Number(totalCards[0].$extras.total),
        retention,
      },
    })
  }

  async store({ request, response }: HttpContext) {
    const payload = await request.validateUsing(cardValidator)
    await LeitnerCard.create({
      front: payload.front,
      back: payload.back,
      tags: payload.tags ?? [],
      box: 1,
      nextReview: DateTime.now(),
    })
    return response.redirect().back()
  }

  async review({ params, request, response }: HttpContext) {
    const { grade } = await request.validateUsing(reviewValidator)
    const card = await LeitnerCard.findOrFail(params.id)
    await new LeitnerService().review(card, grade)
    return response.redirect().back()
  }
}
