import type { HttpContext } from '@adonisjs/core/http'
import LeitnerStatsService from '#modules/leitner/services/leitner_stats_service'

/**
 * Le 5ᵉ écran du module : ce que l'effort de révision a réellement coûté — combien
 * de sessions, de quelle durée, combien de cartes dedans.
 *
 * Contrôleur nu : **toute** la mesure vit dans le service, et l'inférence de session
 * elle-même dans `leitner_sessions.ts`, qui ne touche pas la base. C'est ce qui la
 * rend prouvable unitairement — la leçon de `globalStats`, resté privé dans
 * `LeitnerController` et donc testable seulement à travers une requête HTTP.
 */
export default class LeitnerStatsController {
  async index({ inertia }: HttpContext) {
    const service = new LeitnerStatsService()

    return inertia.render('modules/leitner/stats', {
      stats: await service.effortStats(),
    })
  }
}
