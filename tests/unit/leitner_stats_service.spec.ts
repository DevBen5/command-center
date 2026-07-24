import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import testUtils from '@adonisjs/core/services/test_utils'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import LeitnerReview from '#modules/leitner/models/leitner_review'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'
import LeitnerStatsService from '#modules/leitner/services/leitner_stats_service'

// Ce que les fonctions pures ne prouvent PAS : la jointure reviews→cards, le fenêtrage
// SQL de `reviewed_at` (timestamp), et les deux requêtes de cartes. Ce fichier touche la
// base — le seul filet sur le SQL.

type Grade = 'again' | 'hard' | 'good' | 'easy'

async function makeCard(themeId: number | null, box = 3) {
  return LeitnerCard.create({
    front: `Question ${Math.random()}`,
    back: 'Réponse',
    box,
    nextReview: DateTime.now(),
    leitnerThemeId: themeId,
  })
}

/** Un lot de révisions sur une carte, toutes datées à `daysAgo`. */
async function review(card: LeitnerCard, grades: Grade[], daysAgo = 1) {
  const at = DateTime.now().minus({ days: daysAgo, hours: 1 })
  for (const grade of grades) {
    await LeitnerReview.create({ leitnerCardId: card.id, grade, reviewedAt: at })
  }
}

test.group('LeitnerStatsService / retentionByWindow', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('les fenêtres cumulent, `hard` reste une réussite, `again` fait chuter', async ({
    assert,
  }) => {
    const card = await makeCard(null)

    // 7 j : une réussite et un `hard` → 100 % (hard n'abaisse pas).
    await review(card, ['good', 'hard'], 2)
    // 8–30 j : un `again` entre.
    await review(card, ['again'], 15)
    // 31–90 j : un second `again`.
    await review(card, ['again'], 60)
    // Au-delà de 90 j : ne doit compter dans AUCUNE fenêtre — la preuve que `toSQL()`
    // borne bien (un `toSQLDate()` bogué laisserait fuir ou couperait ce cas).
    await review(card, ['again'], 200)

    const windows = await new LeitnerStatsService().retentionByWindow()
    const rate = (days: number) => windows.find((w) => w.days === days)?.rate

    assert.strictEqual(rate(7), 100) // good + hard
    assert.strictEqual(rate(30), 67) // + un again → 2/3
    assert.strictEqual(rate(90), 50) // + un again → 2/4 ; le 200 j est exclu
  })

  test('aucune révision → chaque fenêtre rend `null`, jamais 0', async ({ assert }) => {
    const windows = await new LeitnerStatsService().retentionByWindow()
    assert.deepEqual(
      windows.map((w) => w.rate),
      [null, null, null]
    )
  })
})

test.group('LeitnerStatsService / weaknessByTheme', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('taux d’`again` par thème, remonté à la catégorie, « Non classées » incluse', async ({
    assert,
  }) => {
    const devops = await LeitnerCategory.create({ name: 'DevOps' })
    const reseau = await LeitnerCategory.create({ name: 'Réseau' })
    const docker = await LeitnerTheme.create({ leitnerCategoryId: devops.id, name: 'Docker' })
    const k8s = await LeitnerTheme.create({ leitnerCategoryId: devops.id, name: 'Kubernetes' })
    const tls = await LeitnerTheme.create({ leitnerCategoryId: reseau.id, name: 'TLS' })

    // Docker : 10 rév dont 2 again (20 %). Kubernetes : 10 dont 8 again (80 %).
    await review(await makeCard(docker.id), fill(10, 2))
    await review(await makeCard(k8s.id), fill(10, 8))
    // TLS : 10 dont 5 again (50 %).
    await review(await makeCard(tls.id), fill(10, 5))
    // Non classées : 4 dont 3 again (75 %).
    await review(await makeCard(null), fill(4, 3))

    const result = await new LeitnerStatsService().weaknessByTheme()

    const byCategory = (id: number | null) => result.find((c) => c.categoryId === id)

    // DevOps agrège Docker + Kubernetes : 20 révisions, 10 again → 50 %. Le total est une
    // SOMME (Number), pas une concaténation de deux `bigint` en chaîne.
    const dev = byCategory(devops.id)!
    assert.strictEqual(dev.total, 20)
    assert.strictEqual(dev.again, 10)
    assert.strictEqual(dev.rate, 50)

    // « Non classées » ne disparaît jamais de l'agrégat.
    const unclassified = byCategory(null)!
    assert.strictEqual(unclassified.name, 'Non classées')
    assert.strictEqual(unclassified.total, 4)
    assert.strictEqual(unclassified.rate, 75)

    // Tri décroissant par taux : Non classées (75) · Réseau (50) · DevOps (50). À taux
    // égal, le plus gros volume d'abord → DevOps (20) avant Réseau (10).
    assert.deepEqual(
      result.map((c) => c.name),
      ['Non classées', 'DevOps', 'Réseau']
    )
  })
})

test.group('LeitnerStatsService / problemCards', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('« le plus d’again » classe par nombre d’`again`, décroissant', async ({ assert }) => {
    const worst = await makeCard(null)
    const mild = await makeCard(null)
    await review(worst, ['again', 'again', 'again', 'again', 'again'])
    await review(mild, ['again', 'again', 'good'])

    const { mostAgain } = await new LeitnerStatsService().problemCards()

    assert.strictEqual(mostAgain[0].id, worst.id)
    assert.strictEqual(mostAgain[0].count, 5)
    assert.strictEqual(mostAgain[1].id, mild.id)
    assert.strictEqual(mostAgain[1].count, 2) // seuls les `again` comptent, pas le `good`
  })

  test('« coincées en boîte 1-2 » : boîte basse ET assez de tentatives', async ({ assert }) => {
    const stuck = await makeCard(null, 1)
    const fresh = await makeCard(null, 1)
    const advanced = await makeCard(null, 4)
    await review(stuck, ['again', 'hard', 'again', 'hard']) // 4 tentatives, boîte 1 → coincée
    await review(fresh, ['good']) // 1 tentative → trop neuve pour être « coincée »
    await review(advanced, ['good', 'good', 'good', 'good']) // boîte 4 → pas coincée

    const { stuck: stuckCards } = await new LeitnerStatsService().problemCards()
    const ids = stuckCards.map((c) => c.id)

    assert.include(ids, stuck.id)
    assert.notInclude(ids, fresh.id)
    assert.notInclude(ids, advanced.id)
    assert.strictEqual(stuckCards.find((c) => c.id === stuck.id)?.count, 4) // nombre de révisions
  })
})

/** `total` grades dont `again` en `again`, le reste en `good`. */
function fill(total: number, again: number): Grade[] {
  return Array.from({ length: total }, (_, index) => (index < again ? 'again' : 'good'))
}
