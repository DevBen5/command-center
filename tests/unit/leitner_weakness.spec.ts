import { test } from '@japa/runner'
import {
  aggregateWeakness,
  retentionRate,
  UNCLASSIFIED_LABEL,
  WEAKNESS_MIN_REVIEWS,
  type ThemeAgainRow,
} from '#modules/leitner/services/leitner_weakness'

// La taxonomie de test : deux catégories, chacune avec des thèmes. `aggregateWeakness`
// s'en sert pour remonter un thème à sa catégorie — comme la base le fait en réel.
const TAXONOMY = [
  {
    id: 1,
    name: 'DevOps',
    themes: [
      { id: 10, name: 'Docker' },
      { id: 11, name: 'Kubernetes' },
    ],
  },
  { id: 2, name: 'Réseau', themes: [{ id: 20, name: 'TLS' }] },
]

test.group('leitner_weakness / retentionRate', () => {
  test('`hard` ne fait pas chuter la rétention — la réponse a été rappelée', ({ assert }) => {
    // Trois réussites dont un `hard` : rétention pleine.
    assert.strictEqual(retentionRate(['good', 'hard', 'good']), 100)
    assert.strictEqual(retentionRate(['hard', 'hard', 'hard']), 100)
  })

  test('`again` fait chuter la rétention — c’est le seul échec de rappel', ({ assert }) => {
    // Un `again` sur trois → 67 %. La même série avec `hard` à la place resterait à 100.
    assert.strictEqual(retentionRate(['good', 'again', 'good']), 67)
    assert.strictEqual(retentionRate(['again']), 0)
  })

  test('aucune révision → `null`, jamais 0 (0 % se lirait comme une mesure)', ({ assert }) => {
    assert.isNull(retentionRate([]))
  })
})

test.group('leitner_weakness / aggregateWeakness', () => {
  test('un `themeId` null tombe dans « Non classées », jamais absent de l’agrégat', ({
    assert,
  }) => {
    const rows: ThemeAgainRow[] = [
      { themeId: 10, total: 4, again: 1 },
      { themeId: null, total: 6, again: 3 },
    ]

    const result = aggregateWeakness(rows, TAXONOMY)

    const unclassified = result.find((category) => category.categoryId === null)
    assert.isDefined(
      unclassified,
      '« Non classées » doit toujours être présent quand des cartes sans thème ont des révisions'
    )
    assert.strictEqual(unclassified!.name, UNCLASSIFIED_LABEL)
    assert.strictEqual(unclassified!.total, 6)
    assert.strictEqual(unclassified!.again, 3)
    assert.strictEqual(unclassified!.rate, 50)
    assert.deepEqual(unclassified!.themes, [])
  })

  test('le total d’une catégorie SOMME ses thèmes sans concaténer — `count` en chaîne (bigint pg)', ({
    assert,
  }) => {
    // ⚠️ Les `count(*)` arrivent de Postgres en CHAÎNES. Sans `Number()`, `'6' + '6'`
    // ferait `'66'` : on vérifie une vraie addition. `assert.strictEqual` refuse `'12'`.
    const rows: ThemeAgainRow[] = [
      { themeId: 10, total: '6', again: '3' }, // Docker → DevOps
      { themeId: 11, total: '6', again: '1' }, // Kubernetes → DevOps
    ]

    const result = aggregateWeakness(rows, TAXONOMY)
    const devops = result.find((category) => category.categoryId === 1)

    assert.isDefined(devops)
    assert.strictEqual(devops!.total, 12) // 6 + 6, pas '66'
    assert.strictEqual(devops!.again, 4) //  3 + 1, pas '31'
    assert.strictEqual(devops!.rate, 33) // round(4 / 12 * 100)
    assert.lengthOf(devops!.themes, 2)
  })

  test('catégories ET thèmes triés décroissant par taux d’`again`', ({ assert }) => {
    const rows: ThemeAgainRow[] = [
      { themeId: 10, total: 10, again: 2 }, // Docker : 20 %
      { themeId: 11, total: 10, again: 8 }, // Kubernetes : 80 %
      { themeId: 20, total: 10, again: 5 }, // TLS → Réseau : 50 %
    ]

    const result = aggregateWeakness(rows, TAXONOMY)

    // DevOps agrège 20 % + 80 % = 10/20 = 50 %, à égalité avec Réseau (50 %) : à taux égal,
    // le plus gros volume d'abord (DevOps 20 révisions vs Réseau 10).
    assert.deepEqual(
      result.map((category) => category.name),
      ['DevOps', 'Réseau']
    )
    // Dans DevOps, Kubernetes (80 %) avant Docker (20 %).
    const devops = result.find((category) => category.categoryId === 1)!
    assert.deepEqual(
      devops.themes.map((theme) => theme.name),
      ['Kubernetes', 'Docker']
    )
  })

  test('`enoughData` bascule au seuil, sans masquer la ligne (c’est la page qui décide)', ({
    assert,
  }) => {
    const rows: ThemeAgainRow[] = [
      { themeId: 10, total: WEAKNESS_MIN_REVIEWS, again: 1 }, // pile au seuil → suffisant
      { themeId: 20, total: WEAKNESS_MIN_REVIEWS - 1, again: 1 }, // juste en dessous
    ]

    const result = aggregateWeakness(rows, TAXONOMY)
    const docker = result
      .flatMap((category) => category.themes)
      .find((theme) => theme.themeId === 10)
    const tls = result.flatMap((category) => category.themes).find((theme) => theme.themeId === 20)

    assert.isTrue(docker!.enoughData)
    assert.isFalse(tls!.enoughData)
    // Sous le seuil, la ligne existe quand même : elle est calculée, pas supprimée.
    assert.isDefined(tls)
  })

  test('historique vide → aucune catégorie', ({ assert }) => {
    assert.deepEqual(aggregateWeakness([], TAXONOMY), [])
  })
})
