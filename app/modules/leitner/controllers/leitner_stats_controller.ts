import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerMasteryService from '#modules/leitner/services/leitner_mastery_service'
import LeitnerStatsService from '#modules/leitner/services/leitner_stats_service'
import { applyVisibility } from '#modules/leitner/services/leitner_visibility'
import { masteredShare, masteredThisMonth } from '#modules/leitner/shared/mastery_inventory'

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
    const isAdmin = auth.user!.isAdmin

    return inertia.render('modules/leitner/stats', {
      habits: await service.habitStats(userId),
      stats: await service.effortStats(userId),
      retention: await service.retentionByWindow(userId),
      weakness: await service.weaknessByTheme(userId),
      problemCards: await service.problemCards(userId, isAdmin),
      mastery: await this.masteryTile(userId, isAdmin),
    })
  }

  /**
   * L'acquis **comme mesure**, jamais comme liste : la liste complète vit sur `/revision`,
   * qui est l'écran où elle a un sens (on y choisit quoi réviser). Ici on veut un chiffre à
   * côté des autres — combien d'acquis, combien ce mois-ci, combien perdus cette année, et
   * quelle part du catalogue ça représente.
   *
   * ⚠️ **Les compteurs viennent de `LeitnerMasteryService`, jamais d'une seconde requête
   * écrite ici** : `/revision` et cet écran doivent annoncer le même nombre. Deux
   * formulations de « qu'est-ce qui est acquis ? » finiraient par diverger, et les deux
   * chiffres seraient également plausibles.
   *
   * ⚠️ **Aucune lecture de taxonomie**, contrairement à `weaknessByTheme` qui, elle,
   * charge encore ses catégories sans `applyVisibility` (ticket dédié). Le patron n'est
   * pas recopié ici.
   */
  private async masteryTile(userId: number, isAdmin: boolean) {
    const mastery = new LeitnerMasteryService()
    const now = DateTime.now()
    const cards = await mastery.inventory(userId, isAdmin)

    const totalQuery = LeitnerCard.query().count('* as total')
    applyVisibility(totalQuery, 'leitner_cards', userId, isAdmin)
    const total = await totalQuery

    return {
      total: cards.length,
      thisMonth: masteredThisMonth(cards, now.toISODate()!),
      lostThisYear: await mastery.lostSince(userId, now.startOf('year')),
      // `null` quand le catalogue est vide : « 0 % » se lirait comme une mesure là où il
      // n'y a rien à mesurer.
      share: masteredShare(cards.length, Number(total[0].$extras.total)),
    }
  }
}
