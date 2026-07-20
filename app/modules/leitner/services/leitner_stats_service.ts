import { DateTime } from 'luxon'
import LeitnerReview from '#modules/leitner/models/leitner_review'
import {
  SESSION_GAP_MINUTES,
  groupIntoSessions,
  median,
  type LeitnerSession,
} from '#modules/leitner/services/leitner_sessions'

/** La fenêtre la plus large affichée, et donc la seule qu'on charge. */
const WIDEST_WINDOW_DAYS = 365

/** La fenêtre des mesures d'effort — la même que celle de la rétention. */
const DETAIL_WINDOW_DAYS = 30

/** Le nombre de sessions listées sous les tuiles. */
const RECENT_SESSIONS = 10

export interface RecentSession {
  startedAt: string
  durationSeconds: number
  cardCount: number
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
}
