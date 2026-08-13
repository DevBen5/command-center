import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCardProgress from '#modules/leitner/models/leitner_card_progress'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import LeitnerReview from '#modules/leitner/models/leitner_review'
import LeitnerSettings from '#modules/leitner/models/leitner_settings'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'
import { isUsableMeasure } from '#modules/leitner/services/leitner_fluency'
import { countByDay, currentStreak } from '#modules/leitner/services/leitner_habits'
import LeitnerFluencyService from '#modules/leitner/services/leitner_fluency_service'
import { nextMasteryState } from '#modules/leitner/services/leitner_mastery'
import {
  DEFAULT_BOX,
  joinProgress,
  orderByQueue,
  progressBox,
  selectWithBox,
  whereDue,
} from '#modules/leitner/services/leitner_progress'
import { ALL_CARDS, applyScope, type CardScope } from '#modules/leitner/services/leitner_scope'
import { applyVisibility } from '#modules/leitner/services/leitner_visibility'

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

/**
 * **De quelle file la carte venait** au moment de la note (CC-260) — jamais où elle finit.
 * Il vit ici pour la même raison que `Verdict` : il cohabite sur une ligne de
 * `leitner_reviews`. Voir `LeitnerReview.kind` pour le piège d'ordre qu'il porte.
 */
export type ReviewKind = 'normal' | 'maintenance'

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
   * Les cartes à réviser dans un paquet **pour cette personne**, dans l'ordre de la file.
   *
   * Ordre : la plus en retard d'abord ; à égalité, la moins récemment touchée. Une
   * carte notée `again` reste due aujourd'hui (donc dernière au premier critère) et
   * vient d'être écrite (donc dernière au second) : elle repart en fin de file au
   * lieu de se re-présenter aussitôt.
   *
   * ⚠️ **Une carte sans progression est due**, et c'est ce qui donne sa file à un compte
   * neuf. Toute la mécanique — jointure externe, `coalesce`, ordre — vit dans
   * `leitner_progress.ts` : va y lire les trois pièges avant de toucher à cette requête.
   */
  async dueCards(
    userId: number,
    scope: CardScope = ALL_CARDS,
    isAdmin: boolean = false
  ): Promise<LeitnerCard[]> {
    const today = DateTime.now().startOf('day')

    const query = LeitnerCard.query().preload('theme', (theme) => theme.preload('category'))

    joinProgress(query, userId)
    selectWithBox(query)
    whereDue(query, today)
    orderByQueue(query, today)
    applyScope(query, scope)
    applyVisibility(query, 'leitner_cards', userId, isAdmin)

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
  async resolveScope(
    input: ScopeInput,
    userId: number,
    isAdmin: boolean = false
  ): Promise<ScopeResolution> {
    const asked = [input.scope, input.category, input.theme].filter((value) => value !== undefined)
    if (asked.length > 1) return { ok: false, reason: 'combined' }

    if (input.theme !== undefined) {
      const themeQuery = LeitnerTheme.query().where('id', input.theme).preload('category')
      applyVisibility(themeQuery, 'leitner_themes', userId, isAdmin)
      const theme = await themeQuery.first()
      // ⚠️ Un thème invisible (privé chez quelqu'un d'autre) est traité comme inexistant,
      // pas comme un refus distinct : le distinguer laisserait deviner qu'un id « existe »
      // sans y avoir accès — la même fuite que résoudrait un 404 plutôt qu'un 403 ailleurs.
      if (!theme) return { ok: false, reason: 'unknown-theme' }
      return {
        ok: true,
        scope: { kind: 'theme', id: theme.id },
        label: `${theme.category.name} · ${theme.name}`,
      }
    }

    if (input.category !== undefined) {
      const categoryQuery = LeitnerCategory.query().where('id', input.category)
      applyVisibility(categoryQuery, 'leitner_categories', userId, isAdmin)
      const category = await categoryQuery.first()
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
  async dueScopeChoices(userId: number, isAdmin: boolean = false): Promise<ScopeChoices> {
    const today = DateTime.now().startOf('day')

    const dueByThemeQuery = LeitnerCard.query()
      .select('leitner_cards.leitner_theme_id')
      .count('* as total')
      .groupBy('leitner_cards.leitner_theme_id')

    joinProgress(dueByThemeQuery, userId)
    whereDue(dueByThemeQuery, today)
    // ⚠️ Sans ce filtre, le compte « dû » d'un thème partagé additionnerait les cartes
    // privées d'un autre compte : un invité lirait « 12 dues » alors que 8 lui sont
    // invisibles — un chiffre plausible et faux, le pire mode d'échec de cet écran.
    applyVisibility(dueByThemeQuery, 'leitner_cards', userId, isAdmin)

    const rows = await dueByThemeQuery

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

    // ⚠️ La taxonomie elle-même est filtrée, pas seulement les comptes qu'elle porte :
    // sinon le nom d'une catégorie ou d'un thème privé d'un autre compte fuiterait dans
    // l'arbre de choix, même à 0 carte due.
    const categoriesQuery = LeitnerCategory.query()
      .preload('themes', (themes) => {
        applyVisibility(themes, 'leitner_themes', userId, isAdmin)
        themes.orderBy('name')
      })
      .orderBy('name')
    applyVisibility(categoriesQuery, 'leitner_categories', userId, isAdmin)
    const categories = await categoriesQuery

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
   *
   * ⚠️ **Le filtre par personne n'est pas cosmétique** : sans lui, l'écran annoncerait
   * « terminé, bravo » à quelqu'un qui n'a rien révisé, parce qu'un collègue est passé
   * sur le même thème dans la journée.
   */
  async hasReviewedTodayInScope(
    userId: number,
    scope: CardScope,
    isAdmin: boolean = false
  ): Promise<boolean> {
    const startOfDay = DateTime.now().startOf('day')

    const query = LeitnerCard.query()
      .select('leitner_cards.id')
      .whereHas('reviews', (reviews) =>
        reviews.where('user_id', userId).where('reviewed_at', '>=', startOfDay.toSQL()!)
      )

    applyScope(query, scope)
    applyVisibility(query, 'leitner_cards', userId, isAdmin)
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
   * ⚠️ **Tout ce qui accompagne la note est de l'HISTORIQUE, pas une entrée de la
   * règle.** Aucune ligne de cette méthode ne lit `answer`, `verdict`, `latencyMs` ni
   * les mesures de fluence pour décider d'une boîte : la note reste le seul moteur du
   * module. Un `verdict: 'faux'` avec `grade: 'easy'` s'enregistre tel quel — c'est même
   * le cas que le ticket demande de garantir. Si un jour ce couple pilotait la boîte,
   * `again` cesserait de vouloir dire « remets-la moi » et la règle métier serait à
   * rouvrir, pas à contourner ici.
   *
   * ⚠️ **Depuis CC-260, la note pose aussi les MARQUES DE MAÎTRISE**, et elles ne changent
   * rien à ce qui précède : `nextBox` reste seul à décider d'une boîte, `nextMasteryState`
   * ne fait qu'observer le mouvement qu'il vient de produire. Personne ne lit encore
   * `mastered_at` — aucune file, aucun compteur, aucun écran.
   *
   * ⚠️ **Rien de ce qui est écrit ici n'est partagé** (CC-119) : la boîte, l'échéance et
   * la ligne d'historique appartiennent à `userId` seul. C'est ce qui rend sûr d'accorder
   * la note à un collègue — et c'est aussi pourquoi `lastGrade` est lu **par personne** :
   * la règle du 2ᵉ `hard` d'affilée ne doit jamais traverser deux comptes.
   */
  async review(
    userId: number,
    card: LeitnerCard,
    grade: Grade,
    // Le type porte la garantie, pas seulement le validateur de la route : ce service
    // est public et directement testable. Un `string` ici, « corrigé » par un `as` à
    // l'écriture, laisserait un appelant interne écrire n'importe quel verdict en base.
    judgment: {
      answer?: string | null
      verdict?: Verdict | null
      latencyMs?: number | null
      thinkingMs?: number | null
      totalMs?: number | null
      interrupted?: boolean
    } = {}
  ): Promise<LeitnerCardProgress> {
    const intervals = await this.boxIntervals()
    const answer = judgment.answer?.trim() || null

    // ⚠️ **AVANT l'insertion, et l'ordre n'est pas négociable.** Ces deux questions
    // comptent les révisions **déjà enregistrées** : posées après le `create()` plus bas,
    // la première répondrait « oui » y compris sur une première présentation (plus aucune
    // mesure ne serait jamais écrite — sans erreur, sans log, avec une colonne
    // éternellement vide) et la seconde verrait la note qu'on est en train de poser.
    const thinkingMs = await this.usableThinkingMs(userId, card, answer, judgment)
    const lastGrade = await this.lastGrade(userId, card)

    // Deux tables au lieu d'une depuis CC-119 : l'invariant « une note = un mouvement de
    // boîte ET une ligne d'historique » ne tient plus tout seul. Un échec entre les deux
    // laisserait une boîte avancée sans trace — ou une trace sans mouvement, qui
    // réarmerait la règle du 2ᵉ `hard` sur une note que la carte n'a jamais reçue.
    return db.transaction(async (trx) => {
      // ⚠️ `firstOrNew`, pas `firstOrFail` : l'absence de ligne est l'état normal d'une
      // première note. La contrainte unique (user_id, card_id) est le rempart contre deux
      // onglets qui la poseraient au même instant — un échec bruyant, jamais deux lignes.
      const progress = await LeitnerCardProgress.firstOrNew(
        { userId, leitnerCardId: card.id },
        { box: DEFAULT_BOX, nextReview: DateTime.now() },
        { client: trx }
      )

      // ⚠️ **L'état AVANT la note, capturé avant toute mutation** — même endroit et même
      // raison que `lastGrade` plus haut, et c'est le piège central de CC-260 : `kind` dit
      // **de quelle file la carte venait**, pas où elle finit. Une carte maîtrisée ratée
      // en entretien produit une révision `maintenance` alors qu'elle en ressort non
      // maîtrisée. Lu après le mouvement, le symptôme est indétectable : l'historique
      // dirait qu'aucun entretien n'a jamais échoué.
      //
      // ⚠️ **Les `?? null` ne sont pas décoratifs.** `firstOrNew` rend un modèle **neuf**
      // dont ces deux colonnes valent `undefined`, pas `null` : un `!== null` posé
      // directement dessus classerait **toute première note** en `'maintenance'`, sans
      // erreur ni log.
      const before = {
        box: progress.box,
        box5EnteredAt: progress.box5EnteredAt ?? null,
        masteredAt: progress.masteredAt ?? null,
      }
      const kind: ReviewKind = before.masteredAt !== null ? 'maintenance' : 'normal'

      progress.box = this.nextBox(before.box, grade, lastGrade)
      // La règle vit dans `leitner_mastery.ts`, pure : ni base ni horloge, donc prouvable
      // sans attendre trente jours. L'intervalle vient de la base, jamais de la constante.
      const mastery = nextMasteryState({
        boxBefore: before.box,
        boxAfter: progress.box,
        grade,
        current: before,
        box5Days: intervals[5],
        now: DateTime.now(),
      })
      progress.box5EnteredAt = mastery.box5EnteredAt
      progress.masteredAt = mastery.masteredAt
      progress.nextReview =
        grade === 'again' ? DateTime.now() : DateTime.now().plus({ days: intervals[progress.box] })
      await progress.save()

      await LeitnerReview.create(
        {
          userId,
          leitnerCardId: card.id,
          grade,
          kind,
          // ⚠️ `before.box`, jamais `progress.box` : celui-ci vient d'être écrasé par
          // `nextBox`. La paire dit le mouvement, elle n'a de valeur que si elle encadre
          // réellement la note.
          boxBefore: before.box,
          boxAfter: progress.box,
          // Une réponse vide n'est pas une réponse : `null`, comme les révisions d'avant
          // ce lot. `verdict` reste `null` quand aucun juge n'a tranché — « jamais jugé »
          // et « jugé faux » ne doivent pas se confondre en base.
          answer,
          verdict: judgment.verdict ?? null,
          latencyMs: judgment.latencyMs ?? null,
          thinkingMs,
          // Le temps total, lui, s'écrit toujours : c'est de l'observation, aucune règle
          // ne le lit. Il dit surtout la longueur de la réponse tapée.
          totalMs: judgment.totalMs ?? null,
          reviewedAt: DateTime.now(),
        },
        { client: trx }
      )

      return progress
    })
  }

  /**
   * Le temps de réflexion, **ou `null` s'il n'est comparable à rien**.
   *
   * ⚠️ **Les trois conditions d'`isUsableMeasure` gouvernent ici l'écriture et, dans
   * `LeitnerFluencyService`, la proposition — elles ne peuvent pas diverger.** Écrire la
   * mesure d'une re-présentation ferait dériver la médiane de la carte vers le bas
   * (mémoire de travail), et une carte mal sue finirait par se voir proposer `easy` :
   * exactement ce que ce lot existe pour empêcher. C'est ce couplage qui autorise à
   * relire `thinking_ms` sans jamais filtrer.
   *
   * S'y ajoute **une quatrième condition, propre à l'écriture** : une révision sans
   * réponse écrite n'est pas retenue — dévoiler sans rien taper n'est pas une tentative
   * de rappel, et l'inclure mélangerait deux populations dans la même colonne. La
   * proposition n'a pas à la connaître : le juge n'est jamais appelé sans réponse.
   */
  private async usableThinkingMs(
    userId: number,
    card: LeitnerCard,
    answer: string | null,
    judgment: { thinkingMs?: number | null; interrupted?: boolean }
  ): Promise<number | null> {
    if (answer === null || judgment.thinkingMs === null || judgment.thinkingMs === undefined) {
      return null
    }

    const measure = {
      thinkingMs: judgment.thinkingMs,
      interrupted: judgment.interrupted ?? false,
      represented: await new LeitnerFluencyService().wasPresentedToday(userId, card.id),
    }

    return isUsableMeasure(measure) ? measure.thinkingMs : null
  }

  /**
   * Boîte atteinte pour cette note, à partir de la boîte courante et de la **note
   * précédente de la même personne**. Pure : elle ne lit ni base ni horloge, ce qui la
   * rend assertable directement — et empêche qu'un appelant lui glisse le `lastGrade`
   * d'un autre compte sans que ça se voie.
   */
  private nextBox(box: number, grade: Grade, lastGrade: Grade | null): number {
    switch (grade) {
      case 'again':
        // La boîte est inchangée : `again` remet la carte dans la session, il ne
        // rétrograde pas. Seul `next_review` bouge (à aujourd'hui), dans `review()`.
        return box
      case 'hard':
        return lastGrade === 'hard' ? 1 : box
      case 'good':
        return Math.min(5, box + 1)
      case 'easy':
        return Math.min(5, box + 2)
    }
  }

  /**
   * Dernière note **de cette personne** sur cette carte, `null` si elle ne l'a jamais
   * révisée. ⚠️ C'est elle qui arme la règle du 2ᵉ `hard` d'affilée : lue sans filtre,
   * le `hard` d'un collègue ferait retomber la carte d'un autre en boîte 1.
   */
  async lastGrade(userId: number, card: LeitnerCard): Promise<Grade | null> {
    const last = await LeitnerReview.query()
      .where('user_id', userId)
      .where('leitner_card_id', card.id)
      .orderBy('reviewed_at', 'desc')
      .orderBy('id', 'desc')
      .first()
    return last?.grade ?? null
  }

  /** Dernière note de cette personne sur chacune des cartes données, en une requête. */
  async lastGrades(userId: number, cardIds: number[]): Promise<Map<number, Grade>> {
    const grades = new Map<number, Grade>()
    if (cardIds.length === 0) return grades

    const reviews = await LeitnerReview.query()
      .where('user_id', userId)
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
  async boxCounts(
    userId: number,
    scope: CardScope = ALL_CARDS,
    isAdmin: boolean = false
  ): Promise<Record<number, number>> {
    const query = LeitnerCard.query()
    joinProgress(query, userId)
    selectWithBox(query)
    applyScope(query, scope)
    applyVisibility(query, 'leitner_cards', userId, isAdmin)

    const cards = await query
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    for (const card of cards) {
      const box = progressBox(card)
      counts[box] = (counts[box] ?? 0) + 1
    }
    return counts
  }

  /**
   * Global au sens du **paquet** — jamais restreint à un thème (voir `boxCounts`) —
   * mais bien restreint à **une personne** : c'est sa journée de travail, pas celle de
   * l'installation.
   */
  async reviewedToday(userId: number): Promise<number> {
    const startOfDay = DateTime.now().startOf('day')
    const reviews = await LeitnerReview.query()
      .where('user_id', userId)
      .where('reviewed_at', '>=', startOfDay.toSQL()!)
    return reviews.length
  }

  /**
   * La série **en cours**, celle qu'affiche `/revision`. Le comptage lui-même vit dans
   * `leitner_habits.ts` et n'est pas recopié ici : l'onglet Stats affiche la même série
   * à côté de la meilleure jamais tenue, et **deux boucles auraient fini par diverger**
   * — sur le fuseau, ou sur la question de savoir si aujourd'hui compte.
   */
  async streakDays(userId: number): Promise<number> {
    const reviews = await LeitnerReview.query().where('user_id', userId).select('reviewed_at')
    const reviewedDays = new Set(countByDay(reviews).keys())

    return currentStreak(reviewedDays, DateTime.now())
  }
}
