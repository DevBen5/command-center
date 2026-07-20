import { DateTime } from 'luxon'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import LeitnerReview from '#modules/leitner/models/leitner_review'
import LeitnerSettings from '#modules/leitner/models/leitner_settings'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'
import { ALL_CARDS, applyScope, type CardScope } from '#modules/leitner/services/leitner_scope'

// Intervalle (en jours) avant la prochaine révision, selon la boîte **atteinte**
// (donc après mouvement). Ce ne sont que les valeurs de départ : les intervalles
// réellement appliqués vivent en base (table `leitner_settings`, une seule ligne)
// et se règlent depuis /revision/settings. Lire `boxIntervals()`, jamais ceci.
export const DEFAULT_BOX_INTERVAL_DAYS: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 30 }

export type Grade = 'again' | 'hard' | 'good' | 'easy'

/**
 * Ce qu'un juge peut dire d'une réponse écrite — à ne jamais confondre avec `Grade`.
 *
 * Les deux vivent ici parce qu'ils cohabitent sur une même ligne de `leitner_reviews`,
 * mais ils ne mesurent pas la même chose : `Grade` note l'**effort de rappel** (et pilote
 * les boîtes), `Verdict` note la **justesse** (et ne pilote rien — il présélectionne un
 * bouton). C'est cette séparation qui fait tenir tout le module : voir
 * `LeitnerJudgeService`, qui porte le mapping de l'un vers l'autre.
 */
export type Verdict = 'juste' | 'partiel' | 'faux'

export type BoxIntervals = Record<number, number>

/** Le paquet tel qu'il arrive de la query string, une fois validé. */
export interface ScopeInput {
  scope?: 'all' | 'unclassified'
  category?: number
  theme?: number
}

/** Pourquoi un paquet est refusé. Chaque raison doit avoir son message côté contrôleur. */
export type ScopeRefusal = 'combined' | 'unknown-theme' | 'unknown-category'

/**
 * Un paquet résolu, ou le refus qui l'a remplacé. **Il n'y a pas de troisième
 * cas** : c'est ce type qui interdit structurellement le repli muet sur « tout ».
 */
export type ScopeResolution =
  { ok: true; scope: CardScope; label: string } | { ok: false; reason: ScopeRefusal }

export interface ScopeThemeChoice {
  id: number
  name: string
  dueCount: number
}

export interface ScopeCategoryChoice {
  id: number
  name: string
  dueCount: number
  themes: ScopeThemeChoice[]
}

/** L'écran de choix : ce qu'on peut réviser, et **combien y est dû**. */
export interface ScopeChoices {
  categories: ScopeCategoryChoice[]
  unclassifiedDueCount: number
  totalDueCount: number
}

export default class LeitnerService {
  /** Ligne unique de réglages (`id = 1`), recréée aux valeurs par défaut si absente. */
  async settings(): Promise<LeitnerSettings> {
    return LeitnerSettings.firstOrCreate(
      { id: 1 },
      {
        box1Days: DEFAULT_BOX_INTERVAL_DAYS[1],
        box2Days: DEFAULT_BOX_INTERVAL_DAYS[2],
        box3Days: DEFAULT_BOX_INTERVAL_DAYS[3],
        box4Days: DEFAULT_BOX_INTERVAL_DAYS[4],
        box5Days: DEFAULT_BOX_INTERVAL_DAYS[5],
      }
    )
  }

  /** Intervalles en vigueur, boîte par boîte. */
  async boxIntervals(): Promise<BoxIntervals> {
    const settings = await this.settings()
    return {
      1: settings.box1Days,
      2: settings.box2Days,
      3: settings.box3Days,
      4: settings.box4Days,
      5: settings.box5Days,
    }
  }

  /**
   * Ne touche pas aux cartes : les échéances déjà posées gardent l'ancien
   * intervalle, le nouveau ne s'applique qu'aux révisions suivantes.
   */
  async updateBoxIntervals(intervals: BoxIntervals): Promise<BoxIntervals> {
    const settings = await this.settings()
    await settings
      .merge({
        box1Days: intervals[1],
        box2Days: intervals[2],
        box3Days: intervals[3],
        box4Days: intervals[4],
        box5Days: intervals[5],
      })
      .save()

    return this.boxIntervals()
  }

  /*
  |----------------------------------------------------------------------------
  | Le paquet d'une session
  |----------------------------------------------------------------------------
  | Elle vit **dans l'URL** (`/revision?theme=3`) et nulle part ailleurs : ni en
  | base, ni en session. Ces méthodes ne la stockent donc jamais — elles la
  | reçoivent à chaque requête, et la file se reconstruit entièrement.
  */

  /**
   * Les cartes à réviser dans un paquet, dans **l'ordre de la file**.
   *
   * Ordre : la plus en retard d'abord ; à égalité, la moins récemment touchée. Une
   * carte notée `again` reste due aujourd'hui (donc dernière au premier critère) et
   * vient d'être écrite (donc dernière au second) : elle repart en fin de file au
   * lieu de se re-présenter aussitôt. **Ne trie jamais par `box`** : un échec la
   * ramène en boîte 1, elle repasserait devant toutes les cartes de boîte ≥ 2 et
   * se re-présenterait en boucle. Le paquet n'y change rien.
   *
   * ⚠️ `next_review` est une colonne `date` : `toSQLDate()`, jamais `toSQL()` —
   * l'intervertir passe le typecheck et casse le filtre en silence.
   */
  async dueCards(scope: CardScope = ALL_CARDS): Promise<LeitnerCard[]> {
    const today = DateTime.now().startOf('day')

    const query = LeitnerCard.query()
      .preload('theme', (theme) => theme.preload('category'))
      .where('next_review', '<=', today.toSQLDate()!)
      .orderBy('next_review', 'asc')
      .orderBy('updated_at', 'asc')
      .orderBy('id', 'asc')

    applyScope(query, scope)
    return query
  }

  /**
   * Traduit la query string en paquet — ou le **refuse**.
   *
   * ⚠️ Un id inexistant ne retombe **jamais** sur « tout » : un thème supprimé depuis
   * un autre onglet, et l'utilisateur réviserait l'intégralité de ses cartes en
   * croyant travailler Docker. `category` et `theme` ensemble sont un refus, pas une
   * devinette : ni « le dernier gagne », ni « le plus précis gagne ».
   */
  async resolveScope(input: ScopeInput): Promise<ScopeResolution> {
    const asked = [input.scope, input.category, input.theme].filter((value) => value !== undefined)
    if (asked.length > 1) return { ok: false, reason: 'combined' }

    if (input.theme !== undefined) {
      const theme = await LeitnerTheme.query().where('id', input.theme).preload('category').first()
      if (!theme) return { ok: false, reason: 'unknown-theme' }
      return {
        ok: true,
        scope: { kind: 'theme', id: theme.id },
        label: `${theme.category.name} · ${theme.name}`,
      }
    }

    if (input.category !== undefined) {
      const category = await LeitnerCategory.find(input.category)
      if (!category) return { ok: false, reason: 'unknown-category' }
      return { ok: true, scope: { kind: 'category', id: category.id }, label: category.name }
    }

    if (input.scope === 'unclassified') {
      return { ok: true, scope: { kind: 'unclassified' }, label: 'Cartes non classées' }
    }

    return { ok: true, scope: ALL_CARDS, label: 'Toutes les cartes' }
  }

  /**
   * L'arbre de l'écran de choix, avec le nombre de cartes **dues** de chaque nœud —
   * jamais son nombre total : un thème de 200 cartes dont 0 est due n'a aucun intérêt
   * ce soir. (`LeitnerCatalogService.categoryTree()` compte les totales : il ne
   * convient pas ici.)
   *
   * **Une requête pour les comptes**, agrégée en JS : une requête par thème serait un
   * N+1 gratuit.
   */
  async dueScopeChoices(): Promise<ScopeChoices> {
    const today = DateTime.now().startOf('day')

    const rows = await LeitnerCard.query()
      .where('next_review', '<=', today.toSQLDate()!)
      .select('leitner_theme_id')
      .count('* as total')
      .groupBy('leitner_theme_id')

    const dueByTheme = new Map<number, number>()
    let unclassifiedDueCount = 0
    let totalDueCount = 0

    for (const row of rows) {
      // Postgres rend `count(*)` en `bigint`, donc en **chaîne** : sans `Number`, les
      // sommes de catégorie plus bas concatèneraient au lieu d'additionner.
      const total = Number(row.$extras.total)
      totalDueCount += total
      if (row.leitnerThemeId === null) unclassifiedDueCount = total
      else dueByTheme.set(row.leitnerThemeId, total)
    }

    const categories = await LeitnerCategory.query()
      .preload('themes', (themes) => themes.orderBy('name'))
      .orderBy('name')

    return {
      categories: categories.map((category) => {
        const themes = category.themes.map((theme) => ({
          id: theme.id,
          name: theme.name,
          dueCount: dueByTheme.get(theme.id) ?? 0,
        }))

        return {
          id: category.id,
          name: category.name,
          dueCount: themes.reduce((total, theme) => total + theme.dueCount, 0),
          themes,
        }
      }),
      unclassifiedDueCount,
      totalDueCount,
    }
  }

  /**
   * A-t-on révisé une carte de ce paquet aujourd'hui ? C'est ce qui distingue
   * « paquet terminé » de « paquet vide dès le départ » — deux écrans que rien
   * d'autre ne sépare, puisque les deux sont une file vide.
   *
   * **Un booléen, jamais un compteur** : le nombre de cartes revues dans le paquet
   * n'est pas affiché, et `reviewedToday()` ne pourrait de toute façon pas le donner
   * (il est global — il annoncerait les cartes revues dans *tous* les thèmes).
   *
   * ⚠️ `reviewed_at` est un `timestamp` — `toSQL()`, là où `dueCards` filtre une
   * colonne `date` avec `toSQLDate()`. Les intervertir passe le typecheck.
   */
  async hasReviewedTodayInScope(scope: CardScope): Promise<boolean> {
    const startOfDay = DateTime.now().startOf('day')

    const query = LeitnerCard.query()
      .select('id')
      .whereHas('reviews', (reviews) => reviews.where('reviewed_at', '>=', startOfDay.toSQL()!))

    applyScope(query, scope)
    return (await query.first()) !== null
  }

  /**
   * Applique une note à une carte. Chaque note a un effet distinct :
   *
   * - `again` : **la boîte ne bouge pas**, la carte est **due le jour même**. Elle
   *   reste dans `dueCards` et revient en fin de file dans la session en cours.
   *   C'est « remets-la moi maintenant », pas une sanction : rater une fois ne
   *   défait pas ce qui a été acquis, seule la promotion est suspendue.
   * - `hard`  : la carte **stagne** dans sa boîte. Deux `hard` consécutifs sur
   *   la même carte la renvoient en boîte 1 : stagner deux fois n'est pas savoir.
   *   ⚠️ C'est désormais le **seul** chemin de rétrogradation.
   * - `good`  : +1 boîte.
   * - `easy`  : +2 boîtes.
   *
   * Hors `again`, `next_review` = aujourd'hui + l'intervalle de la boîte atteinte.
   * La boîte est plafonnée à 5.
   *
   * ⚠️ **`answer`/`verdict`/`latencyMs` sont de l'HISTORIQUE, pas des entrées de la
   * règle.** Aucune ligne de cette méthode ne les lit : la note reste le seul moteur du
   * module. Un `verdict: 'faux'` avec `grade: 'easy'` s'enregistre tel quel — c'est même
   * le cas que le ticket demande de garantir. Si un jour ce couple pilotait la boîte,
   * `again` cesserait de vouloir dire « remets-la moi » et la règle métier serait à
   * rouvrir, pas à contourner ici.
   */
  async review(
    card: LeitnerCard,
    grade: Grade,
    // Le type porte la garantie, pas seulement le validateur de la route : ce service
    // est public et directement testable. Un `string` ici, « corrigé » par un `as` à
    // l'écriture, laisserait un appelant interne écrire n'importe quel verdict en base.
    judgment: {
      answer?: string | null
      verdict?: Verdict | null
      latencyMs?: number | null
    } = {}
  ): Promise<LeitnerCard> {
    const intervals = await this.boxIntervals()

    card.box = await this.nextBox(card, grade)
    card.nextReview =
      grade === 'again' ? DateTime.now() : DateTime.now().plus({ days: intervals[card.box] })
    await card.save()

    await LeitnerReview.create({
      leitnerCardId: card.id,
      grade,
      // Une réponse vide n'est pas une réponse : `null`, comme les révisions d'avant ce
      // lot. `verdict` reste `null` quand aucun juge n'a tranché — « jamais jugé » et
      // « jugé faux » ne doivent pas se confondre en base.
      answer: judgment.answer?.trim() || null,
      verdict: judgment.verdict ?? null,
      latencyMs: judgment.latencyMs ?? null,
      reviewedAt: DateTime.now(),
    })

    return card
  }

  /** Boîte atteinte par la carte pour cette note, avant enregistrement. */
  private async nextBox(card: LeitnerCard, grade: Grade): Promise<number> {
    switch (grade) {
      case 'again':
        // La boîte est inchangée : `again` remet la carte dans la session, il ne
        // rétrograde pas. Seul `next_review` bouge (à aujourd'hui), dans `review()`.
        return card.box
      case 'hard':
        return (await this.lastGrade(card)) === 'hard' ? 1 : card.box
      case 'good':
        return Math.min(5, card.box + 1)
      case 'easy':
        return Math.min(5, card.box + 2)
    }
  }

  /** Dernière note enregistrée pour cette carte, `null` si jamais révisée. */
  async lastGrade(card: LeitnerCard): Promise<Grade | null> {
    const last = await LeitnerReview.query()
      .where('leitner_card_id', card.id)
      .orderBy('reviewed_at', 'desc')
      .orderBy('id', 'desc')
      .first()
    return last?.grade ?? null
  }

  /** Dernière note de chacune des cartes données, en une requête. */
  async lastGrades(cardIds: number[]): Promise<Map<number, Grade>> {
    const grades = new Map<number, Grade>()
    if (cardIds.length === 0) return grades

    const reviews = await LeitnerReview.query()
      .whereIn('leitner_card_id', cardIds)
      .orderBy('reviewed_at', 'asc')
      .orderBy('id', 'asc')

    // Trié par ancienneté croissante : la dernière écriture gagne.
    for (const review of reviews) grades.set(review.leitnerCardId, review.grade)
    return grades
  }

  /**
   * La grille des 5 boîtes — **elle suit le paquet** : elle décrit ce qu'on est en
   * train de réviser. À l'inverse de `reviewedToday`, `streakDays` et de la rétention,
   * qui restent globales : ce sont des mesures d'**habitude**, pas de thème. Une série
   * de 40 jours qui retomberait à zéro parce qu'on a ouvert un autre thème serait
   * absurde.
   */
  async boxCounts(scope: CardScope = ALL_CARDS): Promise<Record<number, number>> {
    const query = LeitnerCard.query().select('box')
    applyScope(query, scope)

    const cards = await query
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    for (const card of cards) counts[card.box] = (counts[card.box] ?? 0) + 1
    return counts
  }

  /** Global — mesure d'habitude, jamais restreinte à un paquet (voir `boxCounts`). */
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
