import { DateTime } from 'luxon'
import type { TimedReview } from '#modules/leitner/services/leitner_sessions'

/**
 * Les mesures d'**habitude** : les séries, la heatmap, la régularité et les deux
 * histogrammes de rythme. **CODE PUR** — ni base, ni requête, ni horloge : le « jour
 * courant » est toujours un paramètre. C'est ce qui rend prouvable ce que la boucle
 * inlinée dans `LeitnerService.streakDays()` ne pouvait pas être.
 *
 * ⚠️ **Une seule voie pour découper la journée, et c'est celle-ci : le JS.** Tout
 * dérive de `reviewedAt.toISODate()`, donc du fuseau du **process Node** — le même que
 * le `DateTime.now()` des séries. La voie SQL (`group by date(reviewed_at)`, fuseau du
 * serveur Postgres) n'est **pas** prise : mélanger les deux ferait diverger la heatmap
 * et la série d'une case au voisinage de minuit, sans que rien ne le signale. Corollaire
 * gratuit : aucun `count(*)`, donc pas de `bigint` rendu en chaîne à convertir.
 */

/** La fenêtre de la heatmap et des histogrammes — un an, aujourd'hui compris. */
export const HEATMAP_WINDOW_DAYS = 365

/** Les fenêtres du taux de régularité, dans l'ordre d'affichage. */
export const REGULARITY_WINDOWS = [7, 30, HEATMAP_WINDOW_DAYS]

/** Le nombre de paliers de couleur d'une case, `0` (aucune révision) exclu. */
const HEAT_LEVELS = 4

/**
 * Les abréviations de mois, **en dur et dans ce fichier** : les tirer d'un `toFormat`
 * localisé ferait dépendre l'étiquetage de la heatmap du jeu ICU embarqué par Node —
 * un build `small-icu` rendrait des mois anglais, sans erreur ni test rouge.
 */
const MONTH_LABELS = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
]

/** Une case de la heatmap : un jour, son compte, et son palier de couleur. */
export interface DayCell {
  date: string
  count: number
  level: number
}

/** Une étiquette de mois, posée sur la colonne où ce mois commence. */
export interface HeatmapMonth {
  /** L'index de colonne (1 = la première semaine), tel quel pour `grid-column-start`. */
  column: number
  label: string
}

/**
 * Les révisions rangées par jour calendaire. La clé est une date ISO (`2026-07-24`),
 * jamais un horodatage : c'est l'unique unité de toutes les mesures d'habitude.
 */
export function countByDay(reviews: TimedReview[]): Map<string, number> {
  const counts = new Map<string, number>()

  for (const review of reviews) {
    const day = review.reviewedAt.toISODate()
    if (day === null) continue
    counts.set(day, (counts.get(day) ?? 0) + 1)
  }

  return counts
}

/**
 * La **meilleure série jamais tenue** — celle que la série courante ne dit pas. Elle
 * lit tout l'historique, sans fenêtre : une série de 40 jours tenue l'an dernier reste
 * la meilleure, même après six mois d'arrêt.
 *
 * Les dates ISO se trient lexicographiquement, mais la **contiguïté** se vérifie par
 * l'arithmétique de dates (`nextDay`) et jamais sur la chaîne : le 31 janvier est suivi
 * du 1ᵉʳ février, ce qu'aucune comparaison de texte ne dira.
 */
export function longestStreak(days: Set<string>): number {
  const sorted = [...days].sort()

  let best = 0
  let run = 0
  let previous: string | null = null

  for (const day of sorted) {
    run = previous !== null && day === nextDay(previous) ? run + 1 : 1
    if (run > best) best = run
    previous = day
  }

  return best
}

/**
 * La série **en cours** : le curseur part d'aujourd'hui et remonte tant qu'il trouve un
 * jour actif.
 *
 * ⚠️ **Elle vaut donc 0 toute la journée tant qu'on n'a rien noté**, et c'est voulu :
 * c'est la définition qu'affiche `/revision` depuis toujours, et la changer ici la
 * changerait là-bas. C'est précisément ce silence que `longestStreak` vient combler —
 * il ne le remplace pas.
 */
export function currentStreak(days: Set<string>, today: DateTime): number {
  let streak = 0
  let cursor = today.startOf('day')

  while (days.has(cursor.toISODate()!)) {
    streak++
    cursor = cursor.minus({ days: 1 })
  }

  return streak
}

/**
 * Les jours actifs d'une fenêtre qui **finit aujourd'hui**, aujourd'hui compris.
 *
 * Le dénominateur est la fenêtre entière, jamais l'âge de la base : « 12 jours sur 30 »
 * garde le même sens d'un mois à l'autre. Sur une base jeune le pourcentage paraît bas,
 * d'où la règle d'affichage — **le brut à côté du pourcentage, jamais le pourcentage
 * seul**.
 */
export function activeDays(days: Set<string>, today: DateTime, windowDays: number): number {
  const end = today.startOf('day')
  let active = 0

  for (let index = 0; index < windowDays; index++) {
    if (days.has(end.minus({ days: index }).toISODate()!)) active++
  }

  return active
}

/**
 * La grille de la heatmap, **une case par jour**, de la plus ancienne à aujourd'hui.
 * Le rendu n'a plus qu'à empiler 7 lignes en `grid-flow-col` : aucun calcul ne reste
 * dans la page.
 *
 * ⚠️ **Deux calages, et leur retrait ne lève rien :**
 *
 * - Le premier jour est ramené au **lundi qui précède** le début de la fenêtre. Sans ça
 *   la première colonne est incomplète, tout glisse d'un cran, et chaque jour s'affiche
 *   sur la mauvaise ligne — une grille pleine, plausible, et fausse.
 * - La dernière colonne, elle, **n'est pas complétée** : un jour à venir rendu au palier
 *   0 serait indiscernable d'un jour sans révision. On s'arrête à aujourd'hui.
 */
export function heatmapCells(
  counts: Map<string, number>,
  today: DateTime,
  windowDays: number = HEATMAP_WINDOW_DAYS
): DayCell[] {
  const end = today.startOf('day')
  const start = end.minus({ days: windowDays - 1 }).startOf('week')

  const cells: DayCell[] = []
  let max = 0

  for (let cursor = start; cursor.toMillis() <= end.toMillis(); cursor = cursor.plus({ days: 1 })) {
    const count = counts.get(cursor.toISODate()!) ?? 0
    if (count > max) max = count
    cells.push({ date: cursor.toISODate()!, count, level: 0 })
  }

  for (const cell of cells) cell.level = heatLevel(cell.count, max)

  return cells
}

/**
 * Les étiquettes de mois de la heatmap : une par mois, sur la colonne où il commence.
 * La colonne est rendue telle quelle en `grid-column-start` — donc **1-indexée**.
 *
 * La toute dernière colonne n'est jamais étiquetée : elle est partielle (elle s'arrête
 * à aujourd'hui) et son étiquette déborderait de la grille.
 */
export function heatmapMonths(cells: DayCell[]): HeatmapMonth[] {
  const columns = Math.ceil(cells.length / 7)
  const months: HeatmapMonth[] = []
  let previous: number | null = null

  for (let column = 0; column < columns; column++) {
    const first = cells[column * 7]
    if (first === undefined) continue

    const month = DateTime.fromISO(first.date).month
    if (month !== previous && column < columns - 1) {
      months.push({ column: column + 1, label: MONTH_LABELS[month - 1] })
    }
    previous = month
  }

  return months
}

/**
 * Les révisions par jour de la semaine, sur une fenêtre finissant aujourd'hui.
 *
 * ⚠️ **L'index 0 est le lundi.** Luxon numérote `weekday` de 1 (lundi) à 7 (dimanche) :
 * le `- 1` n'est pas cosmétique, l'oublier décale tout l'histogramme d'un jour sans rien
 * casser de visible.
 */
export function countByWeekday(reviews: TimedReview[], from: DateTime): number[] {
  const counts = new Array<number>(7).fill(0)

  for (const review of reviewsSince(reviews, from)) {
    counts[review.reviewedAt.weekday - 1]++
  }

  return counts
}

/**
 * Les révisions par heure, sur une fenêtre finissant aujourd'hui.
 *
 * ⚠️ **C'est l'heure de la NOTE, pas celle de la présentation** : une carte affichée à
 * 22h58 et notée à 23h01 compte pour 23 h. Sans conséquence à cette granularité, mais
 * ça n'est pas « l'heure à laquelle on révise » au sens strict.
 */
export function countByHour(reviews: TimedReview[], from: DateTime): number[] {
  const counts = new Array<number>(24).fill(0)

  for (const review of reviewsSince(reviews, from)) {
    counts[review.reviewedAt.hour]++
  }

  return counts
}

/** Le palier de couleur d'une case, **relatif au maximum de la fenêtre affichée**. */
function heatLevel(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0
  return Math.min(HEAT_LEVELS, Math.max(1, Math.ceil((count / max) * HEAT_LEVELS)))
}

/** Le lendemain d'une date ISO — l'arithmétique de dates, jamais celle des chaînes. */
function nextDay(day: string): string {
  return DateTime.fromISO(day).plus({ days: 1 }).toISODate()!
}

function reviewsSince(reviews: TimedReview[], from: DateTime): TimedReview[] {
  const floor = from.startOf('day').toMillis()
  return reviews.filter((review) => review.reviewedAt.toMillis() >= floor)
}
