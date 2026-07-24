import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  activeDays,
  countByDay,
  countByHour,
  countByWeekday,
  currentStreak,
  heatmapCells,
  heatmapMonths,
  longestStreak,
} from '#modules/leitner/services/leitner_habits'

/**
 * Les mesures d'habitude sont **du code pur** : ni base, ni requête, ni horloge — le
 * jour courant est fourni. C'est donc ici, et nulle part ailleurs, qu'elles se
 * prouvent ; le service qui les appelle ne fait que charger des `reviewed_at`.
 *
 * Ce que ce fichier enterre : une série de révision qui ne savait dire qu'une chose —
 * la série *en cours*, donc `0` toute la journée tant qu'on n'a rien noté — et une
 * boucle inlinée dans une méthode qui faisait aussi sa requête, donc intestable.
 */
const TODAY = DateTime.fromISO('2026-07-24') // un vendredi
const MONDAY = '2026-07-20'

/** Des révisions aux jours donnés, à une heure quelconque. */
function reviewsOn(...days: string[]) {
  return days.map((day) => ({ reviewedAt: DateTime.fromISO(`${day}T14:30:00`) }))
}

test.group('Leitner / habitude — les séries', () => {
  test('une série passée plus longue que la série courante est retenue', ({ assert }) => {
    // Cinq jours tenus en janvier, deux jours en cours aujourd'hui.
    const days = new Set([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
      '2026-01-05',
      '2026-07-23',
      '2026-07-24',
    ])

    assert.strictEqual(longestStreak(days), 5)
    assert.strictEqual(currentStreak(days, TODAY), 2)
  })

  test('un trou d’un jour coupe la série', ({ assert }) => {
    const days = new Set(['2026-01-01', '2026-01-02', '2026-01-04'])

    assert.strictEqual(longestStreak(days), 2)
  })

  test('un ensemble vide rend 0', ({ assert }) => {
    assert.strictEqual(longestStreak(new Set()), 0)
    assert.strictEqual(currentStreak(new Set(), TODAY), 0)
  })

  test('un jour isolé est une série de 1', ({ assert }) => {
    assert.strictEqual(longestStreak(new Set(['2026-03-14'])), 1)
  })

  test('la contiguïté traverse un changement de mois', ({ assert }) => {
    // Le piège d'une comparaison de chaînes : `2026-01-31` puis `2026-02-01` se
    // suivent, ce qu'aucun tri lexicographique ne dira.
    const days = new Set(['2026-01-30', '2026-01-31', '2026-02-01'])

    assert.strictEqual(longestStreak(days), 3)
  })

  test('la série courante vaut 0 quand rien n’a été noté aujourd’hui', ({ assert }) => {
    // Le comportement d'origine de `streakDays`, et il ne change pas : c'est ce
    // silence-là que `longestStreak` vient combler, il ne le remplace pas.
    const days = new Set(['2026-07-22', '2026-07-23'])

    assert.strictEqual(currentStreak(days, TODAY), 0)
    assert.strictEqual(longestStreak(days), 2)
  })
})

test.group('Leitner / habitude — les jours actifs', () => {
  test('plusieurs révisions le même jour ne font qu’un jour actif', ({ assert }) => {
    const counts = countByDay(reviewsOn('2026-07-24', '2026-07-24', '2026-07-23'))

    assert.strictEqual(counts.size, 2)
    assert.strictEqual(counts.get('2026-07-24'), 2)
    assert.strictEqual(activeDays(new Set(counts.keys()), TODAY, 7), 2)
  })

  test('un jour hors fenêtre n’est pas compté', ({ assert }) => {
    // La fenêtre de 7 jours finit aujourd'hui et le contient : 18 → 24 juillet.
    const days = new Set(['2026-07-24', '2026-07-20', '2026-07-10'])

    assert.strictEqual(activeDays(days, TODAY, 7), 2)
    assert.strictEqual(activeDays(days, TODAY, 30), 3)
  })

  test('aucune révision rend 0 jour actif', ({ assert }) => {
    assert.strictEqual(activeDays(new Set(), TODAY, 30), 0)
  })
})

test.group('Leitner / habitude — la heatmap', () => {
  test('la grille commence un lundi et finit aujourd’hui', ({ assert }) => {
    const cells = heatmapCells(new Map(), TODAY, 14)

    // Le calage au lundi est le mode d'échec silencieux de la heatmap : sans lui la
    // première colonne est incomplète et chaque jour s'affiche sur la mauvaise ligne.
    assert.strictEqual(DateTime.fromISO(cells[0].date).weekday, 1)
    assert.strictEqual(cells[cells.length - 1].date, TODAY.toISODate())

    // La fenêtre demandée, plus le calage — et jamais une semaine complète de plus.
    assert.isAtLeast(cells.length, 14)
    assert.isBelow(cells.length, 21)
  })

  test('la dernière colonne n’est pas complétée après aujourd’hui', ({ assert }) => {
    const cells = heatmapCells(new Map(), TODAY, 14)
    const future = cells.filter((cell) => cell.date > TODAY.toISODate()!)

    // Un jour à venir rendu au palier 0 serait indiscernable d'un jour sans révision.
    assert.lengthOf(future, 0)
  })

  test('un jour sans révision existe, à 0', ({ assert }) => {
    const cells = heatmapCells(countByDay(reviewsOn('2026-07-24')), TODAY, 14)
    const yesterday = cells.find((cell) => cell.date === '2026-07-23')

    assert.strictEqual(yesterday?.count, 0)
    assert.strictEqual(yesterday?.level, 0)
  })

  test('les comptes atterrissent sur la bonne date', ({ assert }) => {
    const counts = countByDay(reviewsOn('2026-07-22', '2026-07-22', '2026-07-22', '2026-07-24'))
    const cells = heatmapCells(counts, TODAY, 14)

    assert.strictEqual(cells.find((cell) => cell.date === '2026-07-22')?.count, 3)
    assert.strictEqual(cells.find((cell) => cell.date === '2026-07-24')?.count, 1)
  })

  test('le palier suit le maximum de la fenêtre, et 0 reste 0', ({ assert }) => {
    const counts = new Map([
      ['2026-07-21', 1],
      ['2026-07-22', 2],
      ['2026-07-23', 3],
      ['2026-07-24', 4],
    ])
    const cells = heatmapCells(counts, TODAY, 14)
    const level = (date: string) => cells.find((cell) => cell.date === date)?.level

    assert.strictEqual(level('2026-07-21'), 1)
    assert.strictEqual(level('2026-07-22'), 2)
    assert.strictEqual(level('2026-07-23'), 3)
    assert.strictEqual(level('2026-07-24'), 4)
    assert.strictEqual(level('2026-07-20'), 0)
  })

  test('un historique vide ne divise pas par zéro', ({ assert }) => {
    const cells = heatmapCells(new Map(), TODAY, 14)

    assert.isTrue(cells.every((cell) => cell.level === 0 && cell.count === 0))
  })

  test('les étiquettes de mois sont posées sur des colonnes 1-indexées', ({ assert }) => {
    const cells = heatmapCells(new Map(), TODAY, 60)
    const months = heatmapMonths(cells)

    assert.isAtLeast(months.length, 2)
    assert.strictEqual(months[0].column, 1)
    assert.isTrue(months.every((month) => month.label.length > 0))

    // Jamais sur la dernière colonne : elle est partielle, l'étiquette déborderait.
    const columns = Math.ceil(cells.length / 7)
    assert.isTrue(months.every((month) => month.column < columns))
  })
})

test.group('Leitner / habitude — les histogrammes', () => {
  test('l’index 0 du jour de semaine est le lundi', ({ assert }) => {
    // Luxon numérote `weekday` de 1 (lundi) à 7 (dimanche) : oublier le `- 1`
    // décalerait tout l'histogramme d'un jour, sans rien casser de visible.
    const counts = countByWeekday(reviewsOn(MONDAY, MONDAY, '2026-07-24'), TODAY.minus({ days: 6 }))

    assert.lengthOf(counts, 7)
    assert.strictEqual(counts[0], 2) // lundi
    assert.strictEqual(counts[4], 1) // vendredi
  })

  test('les histogrammes ignorent ce qui précède la fenêtre', ({ assert }) => {
    const reviews = reviewsOn('2026-07-24', '2026-06-01')
    const from = TODAY.minus({ days: 6 })

    assert.strictEqual(
      countByWeekday(reviews, from).reduce((total, count) => total + count, 0),
      1
    )
    assert.strictEqual(
      countByHour(reviews, from).reduce((total, count) => total + count, 0),
      1
    )
  })

  test('l’heure range la révision dans son propre créneau', ({ assert }) => {
    const reviews = [
      { reviewedAt: DateTime.fromISO('2026-07-24T22:58:00') },
      { reviewedAt: DateTime.fromISO('2026-07-24T23:01:00') },
      { reviewedAt: DateTime.fromISO('2026-07-24T00:05:00') },
    ]

    const counts = countByHour(reviews, TODAY.minus({ days: 6 }))

    assert.lengthOf(counts, 24)
    assert.strictEqual(counts[22], 1)
    assert.strictEqual(counts[23], 1)
    assert.strictEqual(counts[0], 1)
  })
})
