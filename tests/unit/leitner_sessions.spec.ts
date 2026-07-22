import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  SESSION_GAP_MINUTES,
  groupIntoSessions,
  median,
} from '#modules/leitner/services/leitner_sessions'

/**
 * L'inférence de session est **du code pur** : ni base, ni requête, ni horloge —
 * les horodatages sont fournis. C'est donc ici, et nulle part ailleurs, qu'elle se
 * prouve : le service qui l'appelle ne fait que charger des lignes et agréger.
 *
 * Ce qu'elle enterre : un `/revision` qui n'affichait que des chiffres d'habitude
 * (série, revues du jour, rétention) et rien de l'**effort** réellement fourni.
 */
const START = DateTime.fromISO('2026-07-14T20:00:00')

/** Des révisions aux minutes données, comptées depuis `START`. */
function reviewsAt(...minutes: number[]) {
  return minutes.map((offset) => ({ reviewedAt: START.plus({ minutes: offset }) }))
}

test.group('Leitner / inférence de session', () => {
  test('un écart de 31 min coupe en deux sessions', ({ assert }) => {
    const sessions = groupIntoSessions(reviewsAt(0, 5, 36, 40), SESSION_GAP_MINUTES)

    assert.lengthOf(sessions, 2)
    assert.strictEqual(sessions[0].cardCount, 2)
    assert.strictEqual(sessions[1].cardCount, 2)
  })

  test('un écart de 29 min laisse une seule session', ({ assert }) => {
    const sessions = groupIntoSessions(reviewsAt(0, 5, 34, 40), SESSION_GAP_MINUTES)

    assert.lengthOf(sessions, 1)
    assert.strictEqual(sessions[0].cardCount, 4)
  })

  test('un écart d’exactement 30 min reste la même session', ({ assert }) => {
    // La coupure est sur « **plus de** SESSION_GAP_MINUTES » : le seuil lui-même
    // appartient encore à la session en cours.
    const sessions = groupIntoSessions(reviewsAt(0, 30), SESSION_GAP_MINUTES)

    assert.lengthOf(sessions, 1)
    assert.strictEqual(sessions[0].cardCount, 2)
  })

  test('une carte isolée fait une session de durée 0', ({ assert }) => {
    const sessions = groupIntoSessions(reviewsAt(0), SESSION_GAP_MINUTES)

    assert.lengthOf(sessions, 1)
    assert.strictEqual(sessions[0].cardCount, 1)
    // Elle dure 0 et s'affiche telle quelle : on ne sait pas quand elle a commencé,
    // et la masquer serait mentir sur l'effort.
    assert.strictEqual(sessions[0].durationSeconds, 0)
    // Aucune carte mesurable : la première d'une session n'a pas de début connu.
    assert.deepEqual(sessions[0].cardSeconds, [])
  })

  test('le temps par carte est l’écart entre deux notes consécutives', ({ assert }) => {
    const sessions = groupIntoSessions(reviewsAt(0, 1, 3, 6), SESSION_GAP_MINUTES)

    assert.lengthOf(sessions, 1)
    // Quatre cartes, **trois** temps : la première n'en a pas.
    assert.deepEqual(sessions[0].cardSeconds, [60, 120, 180])
    assert.strictEqual(sessions[0].durationSeconds, 360)
    assert.strictEqual(sessions[0].startedAt.toMillis(), START.toMillis())
    assert.strictEqual(sessions[0].endedAt.toMillis(), START.plus({ minutes: 6 }).toMillis())
  })

  test('une entrée désordonnée donne le même résultat qu’une entrée triée', ({ assert }) => {
    // Le mode d'échec silencieux du lot : une requête sans `orderBy` rend un ordre
    // arbitraire. Sans ce tri défensif, le découpage produirait des sessions absurdes
    // — sans lever, sans log, et avec des chiffres plausibles à l'écran.
    const sessions = groupIntoSessions(reviewsAt(40, 0, 36, 5), SESSION_GAP_MINUTES)

    assert.lengthOf(sessions, 2)
    assert.deepEqual(sessions[0].cardSeconds, [300])
    assert.deepEqual(sessions[1].cardSeconds, [240])
  })

  test('l’entrée n’est pas mutée', ({ assert }) => {
    const reviews = reviewsAt(40, 0)
    groupIntoSessions(reviews, SESSION_GAP_MINUTES)

    assert.strictEqual(reviews[0].reviewedAt.toMillis(), START.plus({ minutes: 40 }).toMillis())
  })

  test('un historique vide ne fait aucune session', ({ assert }) => {
    assert.deepEqual(groupIntoSessions([], SESSION_GAP_MINUTES), [])
  })
})

test.group('Leitner / médiane', () => {
  test('elle trie en numérique, pas en lexicographique', ({ assert }) => {
    // `[9, 10, 100].sort()` sans comparateur rend `[10, 100, 9]`, donc 100 : une
    // médiane fausse, et assez plausible pour ne jamais être remarquée.
    assert.strictEqual(median([9, 10, 100]), 10)
    assert.strictEqual(median([100, 9, 10]), 10)
  })

  test('sur un nombre pair de valeurs, elle prend le milieu des deux centrales', ({ assert }) => {
    assert.strictEqual(median([10, 20, 30, 40]), 25)
  })

  test('rien à mesurer rend null, jamais 0', ({ assert }) => {
    // `0` se lirait comme une mesure — « 0 s par carte » — alors que c'est une absence.
    assert.isNull(median([]))
  })

  test('une seule valeur est sa propre médiane', ({ assert }) => {
    assert.strictEqual(median([42]), 42)
  })
})
