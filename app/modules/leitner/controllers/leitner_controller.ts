import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerReview from '#modules/leitner/models/leitner_review'
import LeitnerFluencyService from '#modules/leitner/services/leitner_fluency_service'
import LeitnerJudgeService from '#modules/leitner/services/leitner_judge_service'
import LeitnerService, {
  type ScopeInput,
  type ScopeRefusal,
} from '#modules/leitner/services/leitner_service'
import {
  judgeValidator,
  reviewScopeValidator,
  reviewValidator,
} from '#modules/leitner/validators/leitner'

/**
 * Refus d'un paquet. Ils atterrissent en flash sur l'écran de choix : le cas réel
 * n'est pas une URL bricolée mais un **thème supprimé depuis un autre onglet** — et
 * l'utilisateur doit alors se retrouver là où il peut agir, pas devant un 404.
 *
 * Le type est indexé sur les raisons de `resolveScope` (plus `malformed`, qui vient du
 * validateur) : ajouter une raison sans son message ne compile pas. Un `Record<string,
 * string>` laisserait passer l'oubli, et l'utilisateur lirait un flash `undefined`.
 */
const SCOPE_ERRORS: Record<ScopeRefusal | 'malformed', string> = {
  'malformed': 'Paquet de révision invalide.',
  'combined': 'Une catégorie ou un thème, pas les deux : choisissez un seul paquet.',
  'unknown-theme': "Ce thème n'existe plus.",
  'unknown-category': "Cette catégorie n'existe plus.",
}

/**
 * ⚠️ `LeitnerJudgeService` est **injecté** (il porte lui-même un `LlmClient` injecté) :
 * c'est ce qui permet aux tests fonctionnels de tourner contre un faux client, sans
 * réseau. Ne l'instancie pas en dur.
 */
@inject()
export default class LeitnerController {
  constructor(private judgeService: LeitnerJudgeService) {}

  /**
   * `/revision` a deux visages, et c'est la query string qui tranche :
   *
   * - **sans paramètre** → l'écran de **choix** (que réviser ce soir ?) ;
   * - **avec un paquet** (`?scope=all|unclassified`, `?category=<id>`, `?theme=<id>`)
   *   → la session, restreinte à ce paquet.
   *
   * ⚠️ **Le paquet ne vit que dans l'URL** : rien en base, rien en session. La page
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
      // Un paquet mal formé retourne à l'écran de choix. Laisser filer l'exception
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
    // travail déjà fait aujourd'hui dans ce paquet les sépare. La question ne se
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
      // La grille des 5 boîtes suit le paquet : elle décrit ce qu'on révise.
      boxCounts: await service.boxCounts(resolved.scope),
      boxIntervals,
      stats: { ...stats, dueCount: dueCards.length },
    })
  }

  /**
   * `streak`, `reviewedToday`, `retention` et `totalCards` **restent globaux**, paquet
   * ou pas : ce sont des mesures d'habitude et un inventaire, pas des mesures de thème.
   * Une série de 40 jours qui retomberait à zéro parce qu'on a ouvert un autre thème
   * serait absurde. Seuls `dueCount` et la grille des boîtes suivent le paquet.
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
   * ⚠️ **`withQs()` n'est pas décoratif : c'est lui qui porte le paquet.**
   *
   * `redirect().back()` renvoie sur le `referer` — mais **sur son seul `pathname`** :
   * il **jette la query string** (`Redirect.back()`, @adonisjs/http-server). Sans
   * `withQs()`, `/revision?theme=3` redeviendrait `/revision` **à chaque note**, en
   * silence : la session repartirait sur toutes les cartes dues, et rien — ni erreur,
   * ni log — ne le signalerait. `withQs()` sans argument dit « reprends la query string
   * du referer », et c'est toute la mécanique du paquet.
   *
   * Ne le retire pas, et ne remplace pas ce `back()` par un `toRoute()`. C'est le
   * piège n° 1 de ce module, et il a son test :
   * `tests/functional/modules/leitner_scope.spec.ts` → « noter une carte CONSERVE le
   * paquet ».
   */
  async review({ params, request, response }: HttpContext) {
    const { grade, ...judgment } = await request.validateUsing(reviewValidator)
    const card = await LeitnerCard.findOrFail(params.id)
    // La note vient de l'utilisateur, le reste est de la trace. `grade` est passé tel
    // quel : ce n'est pas parce qu'un verdict ou un chrono l'accompagne qu'il le corrige.
    await new LeitnerService().review(card, grade, judgment)
    return response.redirect().withQs().back()
  }

  /**
   * La réponse écrite → un verdict, **avant** le dévoilement du verso.
   *
   * ⚠️ **Cette route n'écrit RIEN.** L'historisation se fait à la note, pas ici : tant
   * que l'utilisateur n'a pas cliqué un bouton, il n'y a pas de révision. C'est aussi ce
   * qui rend un double-clic sans conséquence en base.
   *
   * Elle rend du **JSON nu**, pas de l'Inertia — comme les routes de `/revision/llm` et
   * d'extraction PDF, et pour la même raison : la page l'appelle en `fetch` pendant que
   * le verso s'affiche. Donc en-tête **`x-xsrf-token`** obligatoire côté client (Shield),
   * sans quoi tout POST part en 403.
   *
   * ⚠️ **Aucune erreur n'en sort.** Un juge éteint, trop lent ou incompréhensible rend
   * `verdict: null` + `unavailable: true` en **200** : la révision est le cœur du module,
   * elle ne tombe pas parce que LM Studio est éteint. Un 500 ici casserait le
   * dévoilement — exactement ce que l'attendu « repli obligatoire » interdit.
   *
   * ⚠️ **Deux services, et ils ne se confondent pas** : le juge dit la **justesse** et en
   * déduit un bouton ; la fluence ajoute l'**effort** par-dessus, et seulement sur un
   * verdict `juste`. Le juge n'appelle aucune base — c'est ce qui le garde testable
   * contre un faux client — et la fluence n'appelle aucun LLM. Ne les fusionne pas.
   */
  async judge({ params, request, response }: HttpContext) {
    const { answer, thinkingMs, interrupted } = await request.validateUsing(judgeValidator)
    // La carte se relit en base : un `front`/`back` venus du client laisseraient juger
    // une carte qui n'existe pas, et feraient de cette route un proxy vers le LLM local.
    const card = await LeitnerCard.findOrFail(params.id)

    const judgment = await this.judgeService.judge(card, answer)

    return response.json({
      ...judgment,
      // Le chrono ne fait que déplacer un surlignage : sans mesure exploitable ni
      // référence, `suggest` rend exactement ce que le juge proposait — en silence.
      suggestedGrade: await new LeitnerFluencyService().suggest(
        card,
        judgment.verdict,
        judgment.suggestedGrade,
        { thinkingMs: thinkingMs ?? null, interrupted: interrupted ?? false }
      ),
    })
  }
}
