import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'
import capabilityService from '#core/auth/services/capability_service'
import { renderMarkdown } from '#core/shared/services/markdown_renderer'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCardProgress from '#modules/leitner/models/leitner_card_progress'
import LeitnerReview from '#modules/leitner/models/leitner_review'
import {
  provenanceSectionsFor,
  type ProvenanceSection,
} from '#modules/leitner/services/leitner_card_sections_service'
import { searchCourseSections } from '#modules/leitner/services/leitner_course_search_service'
import LeitnerFluencyService from '#modules/leitner/services/leitner_fluency_service'
import { tokenizeFrontHtml } from '#modules/leitner/services/leitner_front_html'
import { glossaryIndex } from '#modules/leitner/services/leitner_glossary_service'
import { gradeOutcomes } from '#modules/leitner/services/leitner_grade_outcomes'
import LeitnerJudgeService from '#modules/leitner/services/leitner_judge_service'
import LeitnerMasteryService from '#modules/leitner/services/leitner_mastery_service'
import { DEFAULT_BOX, progressBox } from '#modules/leitner/services/leitner_progress'
import LeitnerService, {
  type ScopeInput,
  type ScopeRefusal,
} from '#modules/leitner/services/leitner_service'
import { applyVisibility, assertVisibleOrAdmin } from '#modules/leitner/services/leitner_visibility'
import { courseSearchQuery } from '#modules/leitner/shared/course_search'
import {
  maintenanceDueCount,
  masteredThisMonth,
  nextMaintenanceAt,
} from '#modules/leitner/shared/mastery_inventory'
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
  async index({ auth, inertia, request, response, session }: HttpContext) {
    const service = new LeitnerService()
    const mastery = new LeitnerMasteryService()
    const userId = auth.user!.id
    const isAdmin = auth.user!.isAdmin

    let input: ScopeInput
    try {
      input = await request.validateUsing(reviewScopeValidator)
    } catch {
      // Un paquet mal formé retourne à l'écran de choix. Laisser filer l'exception
      // redirigerait sur le `referer` — donc sur l'URL fautive elle-même.
      return this.rejectScope(session, response, SCOPE_ERRORS.malformed)
    }

    const boxIntervals = await service.boxIntervals()
    const stats = await this.globalStats(service, userId, isAdmin)

    // ⚠️ **`queue` compte dans `asked`, et l'oublier ne lève RIEN** : `?queue=maintenance`
    // rendrait l'écran de choix, donc un bouton d'entretien qui « ne fait rien ». C'est le
    // mode d'échec silencieux n° 1 de CC-262, et `leitner_mastery_inventory.spec.ts` le
    // tient en assertant `view: 'session'` **et** le contenu de la file.
    const asked =
      input.scope !== undefined ||
      input.category !== undefined ||
      input.theme !== undefined ||
      input.queue !== undefined

    if (!asked) {
      const choices = await service.dueScopeChoices(userId, isAdmin)

      return inertia.render('modules/leitner/index', {
        view: 'choice',
        scope: null,
        queue: 'normal',
        choices,
        scopeError: session.flashMessages.get('scopeError') ?? null,
        boxCounts: await service.boxCounts(userId, undefined, isAdmin),
        masteredCount: await mastery.masteredCount(userId, undefined, isAdmin),
        boxIntervals,
        // L'inventaire d'acquis n'est servi QUE sur l'écran de choix : `/revision` ne fait
        // que réviser, et une liste de cartes connues à côté de la carte en cours serait
        // du bruit sur le seul écran qui demande de la concentration.
        mastery: await this.masteryInventory(mastery, userId, isAdmin),
        stats: { ...stats, dueCount: choices.totalDueCount },
      })
    }

    const resolved = await service.resolveScope(input, userId, isAdmin)
    if (!resolved.ok) return this.rejectScope(session, response, SCOPE_ERRORS[resolved.reason])

    // ⚠️ **Les deux files sont disjointes par construction** (`mastered_at is null` contre
    // `is not null`, CC-261) : rien à filtrer en plus, rien à synchroniser. La file demandée
    // choisit sa requête, et la suite de la page ne fait aucune différence entre les deux.
    const queue = input.queue === 'maintenance' ? 'maintenance' : 'normal'
    const dueCards =
      queue === 'maintenance'
        ? await service.maintenanceCards(userId, resolved.scope, isAdmin)
        : await service.dueCards(userId, resolved.scope, isAdmin)

    // La note précédente conditionne l'effet de `hard` (deux d'affilée = boîte 1) :
    // la page en a besoin pour annoncer honnêtement ce que fait le bouton.
    const lastGrades = await service.lastGrades(
      userId,
      dueCards.map((card) => card.id)
    )

    // ⚠️ « Terminé » et « rien à réviser ici » sont **la même file vide** : seul le
    // travail déjà fait aujourd'hui dans ce paquet les sépare. La question ne se
    // pose donc qu'une fois la file épuisée — et la réponse est un booléen, pas un
    // compteur : un chiffre faux serait pire que pas de chiffre.
    const finished =
      dueCards.length === 0
        ? await service.hasReviewedTodayInScope(userId, resolved.scope, isAdmin)
        : false

    // Le rang d'entretien ne se demande que pour les cartes déjà acquises : une carte de la
    // file normale repart au palier 0 par construction (`mastered_at` est posé à l'instant,
    // donc aucune révision ne lui est postérieure). Une seule requête pour toute la file.
    const ranks =
      queue === 'maintenance'
        ? await mastery.maintenanceRanks(
            userId,
            dueCards.map((card) => card.id)
          )
        : new Map<number, number>()
    const now = DateTime.now()

    // ⚠️ **Gate SERVEUR, pas seulement client** (CC-253) : `provenance` porte le corps
    // d'une section du corpus, exactement ce que `GET /:id/course-search` protège par
    // `leitner.courses.view`. La peupler sans vérifier la capacité enverrait ce contenu
    // dans les props Inertia à quiconque a seulement `leitner.view` — masquer le panneau
    // côté client ne fermerait rien, comme partout ailleurs dans ce module.
    const canViewCourses = await capabilityService.allows(auth.user!, 'leitner.courses.view')
    const provenance = canViewCourses
      ? await provenanceSectionsFor(
          dueCards.map((card) => card.id),
          userId,
          isAdmin
        )
      : new Map<number, ProvenanceSection[]>()
    // Les mots-clés du recto (CC-254) : masquer n'est pas fermer — sans la capacité, l'index
    // reste vide et rien ne peut être souligné, la route de contenu refusant en plus.
    const glossary = canViewCourses ? await glossaryIndex(userId, isAdmin) : []

    return inertia.render('modules/leitner/index', {
      view: 'session',
      scope: { label: resolved.label, finished },
      queue,
      dueCards: dueCards.map((card) => {
        // ⚠️ Le rendu est fait pour **toute** la file alors que la page n'affiche que
        // `dueCards[0]`. C'est un choix : une prop qui ne porterait le HTML que sur la première
        // carte serait un piège pour le prochain écran qui itère la file — un `v-html` sur
        // `undefined` n'affiche **rien**, sans erreur ni log, et `tsc` ne lit pas les `.vue`.
        // Le coût mesuré est sans commune mesure avec celui de la requête qui précède.
        const frontHtml = renderMarkdown(card.front)
        return {
          ...card.serialize(),
          // ⚠️ La boîte vient de la jointure de progression, pas d'une colonne de la carte :
          // `serialize()` ne rend pas les `$extras`, elle doit être recopiée ici.
          box: progressBox(card),
          lastGrade: lastGrades.get(card.id) ?? null,
          // L'état **avant** la note : c'est lui qui distingue « reste boîte 5 » de « sort
          // des acquis » sous le bouton « À revoir ». Toujours `true` dans la file
          // d'entretien, toujours `false` dans la file normale — les deux sont disjointes,
          // et le dire par carte évite à la page de le déduire de la file.
          mastered: (card.progress[0]?.masteredAt ?? null) !== null,
          // Le Markdown rendu (CC-133). **La colonne reste la source** : `front`/`back` partent
          // aussi, et ce sont eux que lisent l'édition, l'export et le juge.
          frontHtml,
          backHtml: renderMarkdown(card.back),
          // ⚠️ **Le recto rendu ET souligné (CC-276)** : un reparcours du MÊME `frontHtml`
          // (jamais un second `renderMarkdown`), qui tokenise ses nœuds de texte contre le
          // glossaire — `[]` sans `leitner.courses.view`, comme avant. La page rejoue cet
          // arbre en éléments Vue réels, jamais en `v-html` (`services/leitner_front_html.ts`).
          frontNodes: tokenizeFrontHtml(frontHtml, glossary),
          // Le lien explicite de provenance (CC-253), rendu avant les résultats de
          // recherche du panneau « Approfondir » — `[]` si la capacité manque, si la carte
          // n'a aucun lien, ou si son(ses) cours restent invisibles de cette personne.
          // ⚠️ Ne porte plus `bodyHtml` depuis CC-274 : le contenu se charge au clic, via
          // `GET /revision/cours/sections/:id`, dans la modale partagée avec le glossaire.
          provenance: (provenance.get(card.id) ?? []).map((section) => ({
            id: section.id,
            courseId: section.courseId,
            courseTitle: section.courseTitle,
            headingPath: section.headingPath,
            aliases: section.aliases,
            obsoleteAt: section.obsoleteAt,
          })),
          // ⚠️ **Ce que chaque note fera, calculé par la règle elle-même** (CC-262) : la page
          // ne recopie plus ni le plafond des boîtes ni l'intervalle. Le mode d'échec que ça
          // ferme est un écran qui promet 30 jours pendant que la base en programme 90.
          outcomes: gradeOutcomes({
            box: progressBox(card),
            lastGrade: lastGrades.get(card.id) ?? null,
            mastery: {
              // ⚠️ `?? null` pour la même raison que dans `review()` : une carte jamais notée
              // n'a pas de ligne de progression, et `undefined` ne se compare pas à `null`.
              box5EnteredAt: card.progress[0]?.box5EnteredAt ?? null,
              masteredAt: card.progress[0]?.masteredAt ?? null,
            },
            maintenanceRank: ranks.get(card.id) ?? 0,
            boxIntervals,
            now,
          }),
        }
      }),
      // La grille des 5 boîtes suit le paquet : elle décrit ce qu'on révise.
      boxCounts: await service.boxCounts(userId, resolved.scope, isAdmin),
      masteredCount: await mastery.masteredCount(userId, resolved.scope, isAdmin),
      boxIntervals,
      stats: { ...stats, dueCount: dueCards.length },
    })
  }

  /**
   * L'inventaire d'acquis tel que l'écran de choix le reçoit : les cartes, les compteurs
   * datés, et l'état de la file d'entretien.
   *
   * ⚠️ **Tout ce qui se compte ici se DÉRIVE de la même liste**, jamais d'une seconde
   * requête : « dont N ce mois-ci », « N à vérifier » et « la prochaine le … » répondent à
   * des questions dont la liste porte déjà la réponse. Deux lectures finiraient par
   * diverger, et l'écran annoncerait « 3 à vérifier » avant d'en présenter 2.
   */
  private async masteryInventory(service: LeitnerMasteryService, userId: number, isAdmin: boolean) {
    const now = DateTime.now()
    const today = now.toISODate()!
    const cards = await service.inventory(userId, isAdmin)

    return {
      cards,
      total: cards.length,
      thisMonth: masteredThisMonth(cards, today),
      // Le chiffre qui rend l'inventaire crédible plutôt qu'auto-congratulant : il vient
      // de l'historique (`kind`, CC-260), pas de l'état courant — une carte perdue puis
      // ré-acquise reste une carte perdue cette année.
      lostThisYear: await service.lostSince(userId, now.startOf('year')),
      maintenanceDue: maintenanceDueCount(cards, today),
      nextMaintenanceAt: nextMaintenanceAt(cards),
    }
  }

  /**
   * `streak`, `reviewedToday`, `retention` et `totalCards` **restent globaux**, paquet
   * ou pas : ce sont des mesures d'habitude et un inventaire, pas des mesures de thème.
   * Une série de 40 jours qui retomberait à zéro parce qu'on a ouvert un autre thème
   * serait absurde. Seuls `dueCount` et la grille des boîtes suivent le paquet.
   *
   * ⚠️ **« Global » veut dire « tous paquets confondus », pas « tous comptes
   * confondus »** (CC-119) : série, journée et rétention sont celles de `userId`.
   *
   * ⚠️ **`totalCards` a cessé d'être un inventaire commun avec CC-139** : le contenu
   * porte désormais un propriétaire, donc ce chiffre est filtré comme le reste — sinon
   * il annoncerait un total qui ne correspond à aucune liste que l'utilisateur peut
   * réellement parcourir.
   */
  private async globalStats(service: LeitnerService, userId: number, isAdmin: boolean = false) {
    const today = DateTime.now().startOf('day')

    const totalCardsQuery = LeitnerCard.query().count('* as total')
    applyVisibility(totalCardsQuery, 'leitner_cards', userId, isAdmin)
    const totalCards = await totalCardsQuery
    const recentReviews = await LeitnerReview.query()
      .where('user_id', userId)
      .where('reviewed_at', '>=', today.minus({ days: 30 }).toSQL()!)
    // `hard` reste une réussite : la réponse a été rappelée, péniblement.
    // Seul `again` est un échec de rappel.
    const retention =
      recentReviews.length > 0
        ? Math.round(
            (recentReviews.filter((r) => r.grade !== 'again').length / recentReviews.length) * 100
          )
        : null

    return {
      reviewedToday: await service.reviewedToday(userId),
      streak: await service.streakDays(userId),
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
  async review({ auth, params, request, response }: HttpContext) {
    const { grade, ...judgment } = await request.validateUsing(reviewValidator)
    const card = await LeitnerCard.findOrFail(params.id)
    // ⚠️ La carte se relit par id : sans ce contrôle, quelqu'un pourrait noter une carte
    // qu'il ne peut même pas voir depuis sa propre file (CC-139) — `applyVisibility` ne
    // protège que les requêtes filtrées, pas un `findOrFail` par id.
    assertVisibleOrAdmin(card, auth.user!.id, auth.user!.isAdmin)
    // La note vient de l'utilisateur, le reste est de la trace. `grade` est passé tel
    // quel : ce n'est pas parce qu'un verdict ou un chrono l'accompagne qu'il le corrige.
    //
    // ⚠️ La carte se relit en base par son id, mais **rien de ce qui s'écrit ne lui
    // appartient** (CC-119) : boîte, échéance et ligne d'historique vont à `auth.user`.
    // Noter n'a donc plus aucun effet sur ce que voient les autres.
    await new LeitnerService().review(auth.user!.id, card, grade, judgment)
    return response.redirect().withQs().back()
  }

  /**
   * « Approfondir » (CC-252) : la section du corpus la plus proche du recto de la carte,
   * par recherche plein texte Postgres — instantané, aucun LLM, aucune écriture.
   *
   * ⚠️ **`assertVisibleOrAdmin` sur la CARTE, même garde que `judge()`/`review()`** : la
   * capacité `leitner.courses.view` ouvre la route, mais rien n'empêcherait sinon de
   * sonder le contenu d'une carte privée d'un autre compte par son id — la requête FTS
   * elle-même est construite depuis `card.front`, jamais reçu du client.
   *
   * ⚠️ **Requête vide après nettoyage → aucun appel SQL.** Un recto réduit à des symboles
   * (rare, mais possible) ne doit pas tenter `plainto_tsquery('')` ; la garde applicative
   * évite l'aller-retour pour rien plutôt que de laisser Postgres trancher.
   */
  async courseSearch({ auth, params, response }: HttpContext) {
    const card = await LeitnerCard.findOrFail(params.id)
    assertVisibleOrAdmin(card, auth.user!.id, auth.user!.isAdmin)

    const query = courseSearchQuery(card.front)
    if (!query) return response.json({ results: [] })

    const sections = await searchCourseSections(query, auth.user!.id, auth.user!.isAdmin)

    // ⚠️ Ne porte plus `bodyHtml` depuis CC-274 : même raison que `provenance` ci-dessus.
    return response.json({
      results: sections.map((section) => ({
        id: section.id,
        courseId: section.courseId,
        courseTitle: section.course.title,
        headingPath: section.headingPath,
        aliases: section.aliases,
      })),
    })
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
  async judge({ auth, params, request, response }: HttpContext) {
    const { answer, thinkingMs, interrupted } = await request.validateUsing(judgeValidator)
    // La carte se relit en base : un `front`/`back` venus du client laisseraient juger
    // une carte qui n'existe pas, et feraient de cette route un proxy vers le LLM local.
    const card = await LeitnerCard.findOrFail(params.id)
    const userId = auth.user!.id
    // Même garde que `review()` : juger une carte qu'on ne peut pas voir consommerait le
    // LLM local pour du contenu privé d'un autre compte (CC-139).
    assertVisibleOrAdmin(card, userId, auth.user!.isAdmin)

    const judgment = await this.judgeService.judge(card, answer)

    // ⚠️ La boîte de référence est celle de **cette personne** (CC-119), et elle vaut 1
    // tant qu'elle n'a jamais noté la carte — l'absence de ligne, encore. Passer une
    // boîte prise ailleurs comparerait la vitesse de quelqu'un à un vivier qui n'est pas
    // le sien : une suggestion fausse, sans le moindre signe à l'écran.
    const progress = await LeitnerCardProgress.query()
      .where('user_id', userId)
      .where('leitner_card_id', card.id)
      .first()

    return response.json({
      ...judgment,
      // Le chrono ne fait que déplacer un surlignage : sans mesure exploitable ni
      // référence, `suggest` rend exactement ce que le juge proposait — en silence.
      suggestedGrade: await new LeitnerFluencyService().suggest(
        userId,
        card,
        progress?.box ?? DEFAULT_BOX,
        judgment.verdict,
        judgment.suggestedGrade,
        { thinkingMs: thinkingMs ?? null, interrupted: interrupted ?? false }
      ),
    })
  }
}
