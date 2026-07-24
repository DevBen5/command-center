import type { HttpContext } from '@adonisjs/core/http'
import LeitnerStatsService from '#modules/leitner/services/leitner_stats_service'

/**
 * Le 5ᵉ écran du module, et il raconte deux choses : l'**habitude** (les séries, la
 * heatmap de l'année, la régularité, le rythme) et l'**effort** (combien de sessions,
 * de quelle durée, combien de cartes dedans).
 *
 * Contrôleur nu : **toute** la mesure vit dans le service, et le calcul lui-même dans
 * `leitner_sessions.ts` et `leitner_habits.ts`, qui ne touchent pas la base. C'est ce
 * qui le rend prouvable unitairement — la leçon de `globalStats`, resté privé dans
 * `LeitnerController` et donc testable seulement à travers une requête HTTP.
 */
export default class LeitnerStatsController {
  async index({ inertia }: HttpContext) {
    const service = new LeitnerStatsService()

    return inertia.render('modules/leitner/stats', {
      habits: await service.habitStats(),
      stats: await service.effortStats(),
    })
  }
}
