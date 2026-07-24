import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import LeitnerReview from '#modules/leitner/models/leitner_review'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import {
  HEATMAP_WINDOW_DAYS,
  REGULARITY_WINDOWS,
  activeDays,
  countByDay,
  countByHour,
  countByWeekday,
  currentStreak,
  heatmapCells,
  heatmapMonths,
  longestStreak,
  type DayCell,
  type HeatmapMonth,
} from '#modules/leitner/services/leitner_habits'
import {
  SESSION_GAP_MINUTES,
  groupIntoSessions,
  median,
  type LeitnerSession,
} from '#modules/leitner/services/leitner_sessions'
import {
  STUCK_MIN_REVIEWS,
  UNCLASSIFIED_LABEL,
  aggregateWeakness,
  retentionRate,
  type WeaknessCategory,
} from '#modules/leitner/services/leitner_weakness'

/** La fenêtre la plus large affichée, et donc la seule qu'on charge. */
const WIDEST_WINDOW_DAYS = 365

/** La fenêtre des mesures d'effort — la même que celle de la rétention. */
const DETAIL_WINDOW_DAYS = 30

/** Le nombre de sessions listées sous les tuiles. */
const RECENT_SESSIONS = 10

/** Les fenêtres de rétention (jours), de la plus courte à la plus large. */
const RETENTION_WINDOW_DAYS = [7, 30, 90]

/** Combien de cartes chaque liste de « cartes à problème » montre au plus. */
const PROBLEM_CARDS_LIMIT = 8

/** Une carte « coincée » n'a jamais dépassé cette boîte. */
const STUCK_MAX_BOX = 2

export interface RecentSession {
  startedAt: string
  durationSeconds: number
  cardCount: number
}

/** Un taux de régularité : le brut **et** le pourcentage, jamais le pourcentage seul. */
export interface RegularityWindow {
  windowDays: number
  activeDays: number
  percent: number
}

export interface LeitnerHabitStats {
  currentStreak: number
  bestStreak: number
  regularity: RegularityWindow[]
  heatmap: DayCell[]
  heatmapMonths: HeatmapMonth[]
  heatmapDays: number
  maxPerDay: number
  byWeekday: number[]
  byHour: number[]
}

export interface LeitnerEffortStats {
  gapMinutes: number
  windowDays: number
  sessions7: number
  sessions30: number
  sessions365: number
  /** Toutes en secondes, et **`null` quand il n'y a rien à mesurer** — jamais 0. */
  medianSessionSeconds: number | null
  medianCardSeconds: number | null
  medianCardsPerSession: number | null
  totalSeconds: number
  recentSessions: RecentSession[]
}

/** La rétention sur une fenêtre. `rate` est `null` quand il n'y a rien à mesurer. */
export interface RetentionWindow {
  days: number
  rate: number | null
}

/**
 * Une carte à corriger. `count` change de sens selon la liste — nombre d'`again` pour
 * « le plus d'oublis », nombre de révisions pour « coincées » : c'est l'en-tête de la
 * section qui le nomme, comme le `count` du service veille.
 */
export interface ProblemCard {
  id: number
  front: string
  box: number
  /** « Catégorie · Thème », ou « Non classées ». */
  path: string
  count: number
}

export interface ProblemCards {
  mostAgain: ProblemCard[]
  stuck: ProblemCard[]
}

/**
 * Les statistiques d'**effort** : combien de sessions, de quelle durée, combien de
 * cartes dedans. Tout est déduit de `leitner_reviews` — aucune colonne n'a été
 * ajoutée pour ça, et l'historique déjà en base se lit rétroactivement.
 *
 * ⚠️ **Ces mesures sont globales, jamais restreintes à un paquet** — exactement comme `streak`,
 * `reviewedToday` et la rétention (voir `LeitnerService.boxCounts`). Une session est
 * un moment de travail, pas un moment de thème : la découper par thème n'aurait pas
 * de sens, puisqu'une même session peut en traverser plusieurs. Pas de `?theme=` sur
 * cet écran.
 */
export default class LeitnerStatsService {
  async effortStats(): Promise<LeitnerEffortStats> {
    const sessions = await this.sessions()
    const today = DateTime.now().startOf('day')

    const since = (days: number) => {
      const from = today.minus({ days }).toMillis()
      return sessions.filter((session) => session.startedAt.toMillis() >= from)
    }

    const detailed = since(DETAIL_WINDOW_DAYS)

    return {
      gapMinutes: SESSION_GAP_MINUTES,
      windowDays: DETAIL_WINDOW_DAYS,
      sessions7: since(7).length,
      sessions30: detailed.length,
      sessions365: since(WIDEST_WINDOW_DAYS).length,
      medianSessionSeconds: median(detailed.map((session) => session.durationSeconds)),
      medianCardSeconds: median(detailed.flatMap((session) => session.cardSeconds)),
      medianCardsPerSession: median(detailed.map((session) => session.cardCount)),
      totalSeconds: detailed.reduce((total, session) => total + session.durationSeconds, 0),
      recentSessions: sessions
        .slice(-RECENT_SESSIONS)
        .reverse()
        .map((session) => ({
          startedAt: session.startedAt.toISO()!,
          durationSeconds: session.durationSeconds,
          cardCount: session.cardCount,
        })),
    }
  }

  /**
   * Les statistiques d'**habitude** : les séries, la heatmap de l'année, la régularité
   * et le rythme (jour de semaine, heure). Comme l'effort, elles sont globales.
   *
   * ⚠️ **Le chargement n'a pas de fenêtre, et il ne peut pas en avoir une** : la
   * meilleure série est celle « jamais tenue », donc une série de 40 jours tenue il y a
   * deux ans doit encore se voir. C'est le seul point où cet écran lit tout
   * l'historique — `select('reviewed_at')` seul, volumétrie personnelle assumée, comme
   * `streakDays` le faisait déjà.
   *
   * ⚠️ **Aucune requête agrégée, et c'est la décision centrale du lot** : tout le
   * découpage en journées se fait en JS (`toISODate()`), donc dans le fuseau du process
   * Node — le même que le `DateTime.now()` des séries. Un `group by date(reviewed_at)`
   * utiliserait le fuseau du serveur Postgres et ferait diverger la heatmap de la série
   * d'une case au voisinage de minuit, sans erreur ni log. Bénéfice de bord : pas de
   * `count(*)`, donc pas de `bigint` rendu en chaîne à reconvertir.
   */
  async habitStats(): Promise<LeitnerHabitStats> {
    const today = DateTime.now().startOf('day')
    const reviews = await LeitnerReview.query().select('reviewed_at')

    const counts = countByDay(reviews)
    const days = new Set(counts.keys())
    const cells = heatmapCells(counts, today, HEATMAP_WINDOW_DAYS)
    const windowStart = today.minus({ days: HEATMAP_WINDOW_DAYS - 1 })

    return {
      currentStreak: currentStreak(days, today),
      bestStreak: longestStreak(days),
      regularity: REGULARITY_WINDOWS.map((windowDays) => {
        const active = activeDays(days, today, windowDays)
        return {
          windowDays,
          activeDays: active,
          percent: Math.round((active / windowDays) * 100),
        }
      }),
      heatmap: cells,
      heatmapMonths: heatmapMonths(cells),
      heatmapDays: HEATMAP_WINDOW_DAYS,
      maxPerDay: cells.reduce((max, cell) => Math.max(max, cell.count), 0),
      byWeekday: countByWeekday(reviews, windowStart),
      byHour: countByHour(reviews, windowStart),
    }
  }

  /**
   * La rétention sur trois fenêtres (7 / 30 / 90 j) — la même mesure d'habitude que le
   * chiffre unique de `/revision`, mais déclinée pour lire une **tendance**. Doctrine
   * inchangée : `hard` est une réussite, seul `again` un échec (voir `retentionRate`).
   *
   * Un seul chargement sur la fenêtre la plus large, puis un filtrage en JS par fenêtre —
   * comme `effortStats`, à volumétrie personnelle assumée.
   *
   * ⚠️ `reviewed_at` est un `timestamp` : `.toSQL()`, **jamais** `.toSQLDate()` (réservé à
   * `next_review`, colonne `date`). Les intervertir passe le typecheck et casse le filtre.
   */
  async retentionByWindow(): Promise<RetentionWindow[]> {
    const today = DateTime.now().startOf('day')
    const widest = Math.max(...RETENTION_WINDOW_DAYS)

    const reviews = await LeitnerReview.query()
      .select('grade', 'reviewed_at')
      .where('reviewed_at', '>=', today.minus({ days: widest }).toSQL()!)

    return RETENTION_WINDOW_DAYS.map((days) => {
      const from = today.minus({ days }).toMillis()
      const grades = reviews
        .filter((review) => review.reviewedAt.toMillis() >= from)
        .map((review) => review.grade)
      return { days, rate: retentionRate(grades) }
    })
  }

  /**
   * Le taux d'`again` par thème, agrégé par catégorie — la mesure la plus utile du lot :
   * elle désigne les points faibles réels. **Tout l'historique**, sans fenêtre : un point
   * faible est cumulatif.
   *
   * ⚠️ **UNE seule requête**, `group by leitner_theme_id`, jointure reviews → cards (une
   * carte ne porte que son thème). `count(*)` revient en `bigint` → chaîne ; le `Number()`
   * est fait dans `aggregateWeakness`, avec le reste de la logique pure. La remontée à la
   * catégorie se fait **en JS** via la taxonomie préchargée, comme `dueScopeChoices` :
   * aucune 3ᵉ copie de la sous-requête catégorie → thèmes. Patron `db.rawQuery` +
   * `count(*) FILTER` : cf. `VeilleStatsService`, `?` paramétré.
   */
  async weaknessByTheme(): Promise<WeaknessCategory[]> {
    const result = await db.rawQuery(
      `SELECT
         c.leitner_theme_id                    AS theme_id,
         count(*)                              AS total,
         count(*) FILTER (WHERE r.grade = ?)   AS again
       FROM leitner_reviews r
       JOIN leitner_cards c ON c.id = r.leitner_card_id
       GROUP BY c.leitner_theme_id`,
      ['again']
    )

    const rows = result.rows.map(
      (row: { theme_id: number | null; total: string; again: string }) => ({
        themeId: row.theme_id,
        total: row.total,
        again: row.again,
      })
    )

    const categories = await LeitnerCategory.query().preload('themes').orderBy('name')

    return aggregateWeakness(
      rows,
      categories.map((category) => ({
        id: category.id,
        name: category.name,
        themes: category.themes.map((theme) => ({ id: theme.id, name: theme.name })),
      }))
    )
  }

  /**
   * Deux listes de cartes à corriger, distinctes par construction : celles qui **cumulent
   * le plus d'`again`**, et celles **coincées en boîte 1-2** (jamais promues). Sur tout
   * l'historique. La page renvoie chacune vers `/revision/settings` — le seul point de
   * saisie ; `/revision` ne fait que réviser.
   */
  async problemCards(): Promise<ProblemCards> {
    return {
      mostAgain: await this.mostAgainCards(),
      stuck: await this.stuckCards(),
    }
  }

  /**
   * **Un seul chargement, un seul regroupement** — et c'est structurel, pas une
   * optimisation. Filtrer les révisions *avant* de les regrouper couperait en deux la
   * session à cheval sur la frontière de la fenêtre, et la compterait **deux fois** :
   * on regroupe donc sur la fenêtre la plus large, puis on range les sessions
   * obtenues. Reste la troncature au bord des 365 j — inévitable, et sans effet
   * visible sur un comptage annuel.
   *
   * ⚠️ `reviewed_at` est un `timestamp` : `toSQL()`, **jamais** `toSQLDate()` (qui est
   * réservé à `next_review`, colonne `date`). Les intervertir passe le typecheck et
   * casse le filtre en silence.
   *
   * L'`orderBy` fait doublon avec le tri de `groupIntoSessions`, et c'est voulu :
   * l'un dit l'intention ici, l'autre garantit le résultat là-bas.
   */
  private async sessions(): Promise<LeitnerSession[]> {
    const from = DateTime.now().startOf('day').minus({ days: WIDEST_WINDOW_DAYS })

    // Comme `reviewedToday` et `streakDays` : on charge les lignes et on compte en JS,
    // sans pagination. Volumétrie personnelle, c'est assumé.
    const reviews = await LeitnerReview.query()
      .select('reviewed_at')
      .where('reviewed_at', '>=', from.toSQL()!)
      .orderBy('reviewed_at', 'asc')

    return groupIntoSessions(reviews, SESSION_GAP_MINUTES)
  }

  /**
   * Les cartes qui cumulent le plus d'`again`. Le classement se fait en SQL (`group by`
   * carte), mais `whereIn` **perd cet ordre** au chargement des cartes : on le rétablit en
   * JS sur le compte d'`again`. `count(*)` bigint → `Number()`.
   */
  private async mostAgainCards(): Promise<ProblemCard[]> {
    const result = await db.rawQuery(
      `SELECT leitner_card_id AS card_id, count(*) AS again
       FROM leitner_reviews
       WHERE grade = ?
       GROUP BY leitner_card_id
       ORDER BY again DESC, leitner_card_id ASC
       LIMIT ?`,
      ['again', PROBLEM_CARDS_LIMIT]
    )

    const againByCard = new Map<number, number>()
    for (const row of result.rows) againByCard.set(row.card_id, Number(row.again))

    const ids = [...againByCard.keys()]
    if (ids.length === 0) return []

    const cards = await LeitnerCard.query()
      .whereIn('id', ids)
      .preload('theme', (theme) => theme.preload('category'))

    return cards
      .map((card) => this.toProblemCard(card, againByCard.get(card.id) ?? 0))
      .sort((a, b) => b.count - a.count || a.id - b.id)
  }

  /**
   * Les cartes **coincées en boîte 1-2** : jamais promues au-delà, malgré au moins
   * `STUCK_MIN_REVIEWS` tentatives. Le plancher de tentatives écarte les cartes neuves,
   * qui sont en boîte 1 sans avoir échoué à rien. `withCount` compte les révisions en
   * base ; le filtre et le tri se font en JS, à volumétrie personnelle.
   */
  private async stuckCards(): Promise<ProblemCard[]> {
    const cards = await LeitnerCard.query()
      .where('box', '<=', STUCK_MAX_BOX)
      .withCount('reviews')
      .preload('theme', (theme) => theme.preload('category'))

    return cards
      .map((card) => ({ card, reviewCount: Number(card.$extras.reviews_count) }))
      .filter(({ reviewCount }) => reviewCount >= STUCK_MIN_REVIEWS)
      .sort((a, b) => b.reviewCount - a.reviewCount || a.card.id - b.card.id)
      .slice(0, PROBLEM_CARDS_LIMIT)
      .map(({ card, reviewCount }) => this.toProblemCard(card, reviewCount))
  }

  private toProblemCard(card: LeitnerCard, count: number): ProblemCard {
    const theme = card.theme
    const path = theme ? `${theme.category.name} · ${theme.name}` : UNCLASSIFIED_LABEL
    return { id: card.id, front: card.front, box: card.box, path, count }
  }
}
