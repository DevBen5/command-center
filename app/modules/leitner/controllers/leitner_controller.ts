import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerReview from '#modules/leitner/models/leitner_review'
import LeitnerService, {
  type ScopeInput,
  type ScopeRefusal,
} from '#modules/leitner/services/leitner_service'
import { reviewScopeValidator, reviewValidator } from '#modules/leitner/validators/leitner'

/**
 * Refus d'une portée. Ils atterrissent en flash sur l'écran de choix : le cas réel
 * n'est pas une URL bricolée mais un **thème supprimé depuis un autre onglet** — et
 * l'utilisateur doit alors se retrouver là où il peut agir, pas devant un 404.
 *
 * Le type est indexé sur les raisons de `resolveScope` (plus `malformed`, qui vient du
 * validateur) : ajouter une raison sans son message ne compile pas. Un `Record<string,
 * string>` laisserait passer l'oubli, et l'utilisateur lirait un flash `undefined`.
 */
const SCOPE_ERRORS: Record<ScopeRefusal | 'malformed', string> = {
  'malformed': 'Portée de révision invalide.',
  'combined': 'Une catégorie ou un thème, pas les deux : choisissez une seule portée.',
  'unknown-theme': "Ce thème n'existe plus.",
  'unknown-category': "Cette catégorie n'existe plus.",
}

export default class LeitnerController {
  /**
   * `/revision` a deux visages, et c'est la query string qui tranche :
   *
   * - **sans paramètre** → l'écran de **choix** (que réviser ce soir ?) ;
   * - **avec une portée** (`?scope=all|unclassified`, `?category=<id>`, `?theme=<id>`)
   *   → la session, restreinte à cette portée.
   *
   * ⚠️ **La portée ne vit que dans l'URL** : rien en base, rien en session. La page
   * n'a aucun état — `dueCards` est re-requêtée à chaque chargement — donc il n'y a
   * rien à reprendre et rien à invalider. Ce qui la fait survivre à une note tient en
   * un appel, et **un seul** : le `withQs()` de `review()`. Va lire son commentaire
   * avant de toucher à quoi que ce soit ici — `back()` seul ne conserve rien.
   */
  async index({ inertia, request, response, session }: HttpContext) {
    const service = new LeitnerService()

    let input: ScopeInput
    try {
      input = await request.validateUsing(reviewScopeValidator)
    } catch {
      // Une portée mal formée retourne à l'écran de choix. Laisser filer l'exception
      // redirigerait sur le `referer` — donc sur l'URL fautive elle-même.
      return this.rejectScope(session, response, SCOPE_ERRORS.malformed)
    }

    const boxIntervals = await service.boxIntervals()
    const stats = await this.globalStats(service)

    const asked =
      input.scope !== undefined || input.category !== undefined || input.theme !== undefined

    if (!asked) {
      const choices = await service.dueScopeChoices()

      return inertia.render('modules/leitner/index', {
        view: 'choice',
        scope: null,
        choices,
        scopeError: session.flashMessages.get('scopeError') ?? null,
        boxCounts: await service.boxCounts(),
        boxIntervals,
        stats: { ...stats, dueCount: choices.totalDueCount },
      })
    }

    const resolved = await service.resolveScope(input)
    if (!resolved.ok) return this.rejectScope(session, response, SCOPE_ERRORS[resolved.reason])

    const dueCards = await service.dueCards(resolved.scope)

    // La note précédente conditionne l'effet de `hard` (deux d'affilée = boîte 1) :
    // la page en a besoin pour annoncer honnêtement ce que fait le bouton.
    const lastGrades = await service.lastGrades(dueCards.map((card) => card.id))

    // ⚠️ « Terminé » et « rien à réviser ici » sont **la même file vide** : seul le
    // travail déjà fait aujourd'hui dans cette portée les sépare. La question ne se
    // pose donc qu'une fois la file épuisée — et la réponse est un booléen, pas un
    // compteur : un chiffre faux serait pire que pas de chiffre.
    const finished =
      dueCards.length === 0 ? await service.hasReviewedTodayInScope(resolved.scope) : false

    return inertia.render('modules/leitner/index', {
      view: 'session',
      scope: { label: resolved.label, finished },
      dueCards: dueCards.map((card) => ({
        ...card.serialize(),
        lastGrade: lastGrades.get(card.id) ?? null,
      })),
      // La grille des 5 boîtes suit la portée : elle décrit ce qu'on révise.
      boxCounts: await service.boxCounts(resolved.scope),
      boxIntervals,
      stats: { ...stats, dueCount: dueCards.length },
    })
  }

  /**
   * `streak`, `reviewedToday`, `retention` et `totalCards` **restent globaux**, portée
   * ou pas : ce sont des mesures d'habitude et un inventaire, pas des mesures de thème.
   * Une série de 40 jours qui retomberait à zéro parce qu'on a ouvert un autre thème
   * serait absurde. Seuls `dueCount` et la grille des boîtes suivent la portée.
   */
  private async globalStats(service: LeitnerService) {
    const today = DateTime.now().startOf('day')

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

    return {
      reviewedToday: await service.reviewedToday(),
      streak: await service.streakDays(),
      totalCards: Number(totalCards[0].$extras.total),
      retention,
    }
  }

  private rejectScope(
    session: HttpContext['session'],
    response: HttpContext['response'],
    message: string
  ) {
    session.flash('scopeError', message)
    return response.redirect().toPath('/revision')
  }

  /**
   * ⚠️ **`withQs()` n'est pas décoratif : c'est lui qui porte la portée.**
   *
   * `redirect().back()` renvoie sur le `referer` — mais **sur son seul `pathname`** :
   * il **jette la query string** (`Redirect.back()`, @adonisjs/http-server). Sans
   * `withQs()`, `/revision?theme=3` redeviendrait `/revision` **à chaque note**, en
   * silence : la session repartirait sur toutes les cartes dues, et rien — ni erreur,
   * ni log — ne le signalerait. `withQs()` sans argument dit « reprends la query string
   * du referer », et c'est toute la mécanique de la portée.
   *
   * Ne le retire pas, et ne remplace pas ce `back()` par un `toRoute()`. C'est le
   * piège n° 1 de ce module, et il a son test :
   * `tests/functional/modules/leitner_scope.spec.ts` → « noter une carte CONSERVE la
   * portée ».
   */
  async review({ params, request, response }: HttpContext) {
    const { grade } = await request.validateUsing(reviewValidator)
    const card = await LeitnerCard.findOrFail(params.id)
    await new LeitnerService().review(card, grade)
    return response.redirect().withQs().back()
  }
}
