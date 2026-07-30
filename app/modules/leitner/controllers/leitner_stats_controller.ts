import type { HttpContext } from '@adonisjs/core/http'
import LeitnerStatsService from '#modules/leitner/services/leitner_stats_service'

/**
 * Le 5ᵉ écran du module, et il raconte trois choses : l'**habitude** (les séries, la
 * heatmap de l'année, la régularité, le rythme), l'**effort** (combien de sessions, de
 * quelle durée, combien de cartes dedans) et les **points faibles** (rétention par
 * fenêtre, taux d'`again` par thème, cartes à problème).
 *
 * Contrôleur nu : **toute** la mesure vit dans le service, et le calcul lui-même dans
 * `leitner_sessions.ts`, `leitner_habits.ts` et `leitner_weakness.ts`, qui ne touchent
 * pas la base. C'est ce qui le rend prouvable unitairement — la leçon de `globalStats`,
 * resté privé dans `LeitnerController` et donc testable seulement à travers une requête
 * HTTP.
 */
export default class LeitnerStatsController {
  async index({ auth, inertia }: HttpContext) {
    const service = new LeitnerStatsService()
    // ⚠️ Cet écran ne montre **que** le travail de celui qui le regarde (CC-119) : une
    // série, une heatmap ou un point faible n'ont de sens que rapportés à une personne.
    const userId = auth.user!.id

    return inertia.render('modules/leitner/stats', {
      habits: await service.habitStats(userId),
      stats: await service.effortStats(userId),
      retention: await service.retentionByWindow(userId),
      weakness: await service.weaknessByTheme(userId),
      problemCards: await service.problemCards(userId),
    })
  }
}
