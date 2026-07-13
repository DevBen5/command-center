import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerReview from '#modules/leitner/models/leitner_review'
import LeitnerService from '#modules/leitner/services/leitner_service'
import { reviewValidator } from '#modules/leitner/validators/leitner'

export default class LeitnerController {
  async index({ inertia }: HttpContext) {
    const service = new LeitnerService()
    const today = DateTime.now().startOf('day')

    // Ordre de la file : la plus en retard d'abord ; à égalité, la moins
    // récemment touchée. Une carte notée `again` reste due aujourd'hui (donc
    // dernière au premier critère) et vient d'être écrite (donc dernière au
    // second) : elle repart en fin de file au lieu de se re-présenter aussitôt.
    // Trier par `box` la remettrait en tête, puisqu'un échec la ramène en boîte 1.
    const dueCards = await LeitnerCard.query()
      .preload('theme', (theme) => theme.preload('category'))
      .where('next_review', '<=', today.toSQLDate()!)
      .orderBy('next_review', 'asc')
      .orderBy('updated_at', 'asc')
      .orderBy('id', 'asc')

    // La note précédente conditionne l'effet de `hard` (deux d'affilée = boîte 1) :
    // la page en a besoin pour annoncer honnêtement ce que fait le bouton.
    const lastGrades = await service.lastGrades(dueCards.map((card) => card.id))

    const boxIntervals = await service.boxIntervals()
    const boxCounts = await service.boxCounts()
    const reviewedToday = await service.reviewedToday()
    const streak = await service.streakDays()

    const totalCards = await LeitnerCard.query().count('* as total')
    const recentReviews = await LeitnerReview.query().where(
      'reviewed_at',
      '>=',
      today.minus({ days: 30 }).toSQL()!
    )
    // `hard` reste une réussite : la réponse a été rappelée, péniblement.
    // Seul `again` est un échec de rappel.
    const retention =
      recentReviews.length > 0
        ? Math.round(
            (recentReviews.filter((r) => r.grade !== 'again').length / recentReviews.length) * 100
          )
        : null

    return inertia.render('modules/leitner/index', {
      dueCards: dueCards.map((card) => ({
        ...card.serialize(),
        lastGrade: lastGrades.get(card.id) ?? null,
      })),
      boxCounts,
      boxIntervals,
      stats: {
        reviewedToday,
        streak,
        dueCount: dueCards.length,
        totalCards: Number(totalCards[0].$extras.total),
        retention,
      },
    })
  }

  async review({ params, request, response }: HttpContext) {
    const { grade } = await request.validateUsing(reviewValidator)
    const card = await LeitnerCard.findOrFail(params.id)
    await new LeitnerService().review(card, grade)
    return response.redirect().back()
  }
}
