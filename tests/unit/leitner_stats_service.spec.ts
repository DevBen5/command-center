import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import testUtils from '@adonisjs/core/services/test_utils'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import LeitnerReview from '#modules/leitner/models/leitner_review'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'
import LeitnerStatsService from '#modules/leitner/services/leitner_stats_service'
import type LeitnerCard from '#modules/leitner/models/leitner_card'
import type User from '#core/auth/models/user'
import { makeCard as createCard, setProgress } from '#tests/helpers/leitner'
import { createAdmin } from '#tests/helpers/users'

// Ce que les fonctions pures ne prouvent PAS : la jointure reviews→cards, le fenêtrage
// SQL de `reviewed_at` (timestamp), et les deux requêtes de cartes. Ce fichier touche la
// base — le seul filet sur le SQL.
//
// ⚠️ Depuis CC-119, il porte aussi le **cloisonnement** de cet écran : chaque mesure est
// celle d'une personne. Un filtre `user_id` oublié ne lève rien, il gonfle des chiffres
// qui restent plausibles — le pire mode d'échec de l'onglet Stats.

type Grade = 'again' | 'hard' | 'good' | 'easy'

let sequence = 0

async function makeCard(user: User, themeId: number | null, box = 3) {
  sequence += 1
  const card = await createCard(`Question ${sequence}`, { back: 'Réponse', themeId })
  await setProgress(user.id, card.id, { box })
  return card
}

/** Un lot de révisions sur une carte, toutes datées à `daysAgo`. */
async function review(user: User, card: LeitnerCard, grades: Grade[], daysAgo = 1) {
  const at = DateTime.now().minus({ days: daysAgo, hours: 1 })
  for (const grade of grades) {
    await LeitnerReview.create({ userId: user.id, leitnerCardId: card.id, grade, reviewedAt: at })
  }
}

test.group('LeitnerStatsService / retentionByWindow', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('les fenêtres cumulent, `hard` reste une réussite, `again` fait chuter', async ({
    assert,
  }) => {
    const user = await createAdmin()
    const card = await makeCard(user, null)

    // 7 j : une réussite et un `hard` → 100 % (hard n'abaisse pas).
    await review(user, card, ['good', 'hard'], 2)
    // 8–30 j : un `again` entre.
    await review(user, card, ['again'], 15)
    // 31–90 j : un second `again`.
    await review(user, card, ['again'], 60)
    // Au-delà de 90 j : ne doit compter dans AUCUNE fenêtre — la preuve que `toSQL()`
    // borne bien (un `toSQLDate()` bogué laisserait fuir ou couperait ce cas).
    await review(user, card, ['again'], 200)

    const windows = await new LeitnerStatsService().retentionByWindow(user.id)
    const rate = (days: number) => windows.find((w) => w.days === days)?.rate

    assert.strictEqual(rate(7), 100) // good + hard
    assert.strictEqual(rate(30), 67) // + un again → 2/3
    assert.strictEqual(rate(90), 50) // + un again → 2/4 ; le 200 j est exclu
  })

  test('la rétention d’un compte ignore les révisions des autres', async ({ assert }) => {
    // Sans le filtre, les échecs d'un collègue feraient chuter ma rétention — un chiffre
    // parfaitement plausible, et faux, sur l'écran censé mesurer mon travail.
    const mine = await createAdmin()
    const theirs = await createAdmin()
    const card = await makeCard(mine, null)

    await review(mine, card, ['good', 'good'], 2)
    await review(theirs, card, ['again', 'again'], 2)

    const windows = await new LeitnerStatsService().retentionByWindow(mine.id)
    assert.strictEqual(windows.find((w) => w.days === 7)?.rate, 100)
  })

  test('aucune révision → chaque fenêtre rend `null`, jamais 0', async ({ assert }) => {
    const user = await createAdmin()
    const windows = await new LeitnerStatsService().retentionByWindow(user.id)
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
    const user = await createAdmin()
    const devops = await LeitnerCategory.create({ name: 'DevOps' })
    const reseau = await LeitnerCategory.create({ name: 'Réseau' })
    const docker = await LeitnerTheme.create({ leitnerCategoryId: devops.id, name: 'Docker' })
    const k8s = await LeitnerTheme.create({ leitnerCategoryId: devops.id, name: 'Kubernetes' })
    const tls = await LeitnerTheme.create({ leitnerCategoryId: reseau.id, name: 'TLS' })

    // Docker : 10 rév dont 2 again (20 %). Kubernetes : 10 dont 8 again (80 %).
    await review(user, await makeCard(user, docker.id), fill(10, 2))
    await review(user, await makeCard(user, k8s.id), fill(10, 8))
    // TLS : 10 dont 5 again (50 %).
    await review(user, await makeCard(user, tls.id), fill(10, 5))
    // Non classées : 4 dont 3 again (75 %).
    await review(user, await makeCard(user, null), fill(4, 3))

    // ⚠️ Un autre compte pilonne le même thème d'`again` : il ne doit pas apparaître.
    // Sans le filtre, DevOps passerait de 50 % à 70 % — un point faible désigné à tort.
    const theirs = await createAdmin()
    await review(theirs, await makeCard(theirs, docker.id), fill(10, 8))

    const result = await new LeitnerStatsService().weaknessByTheme(user.id)

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
    const user = await createAdmin()
    const worst = await makeCard(user, null)
    const mild = await makeCard(user, null)
    await review(user, worst, ['again', 'again', 'again', 'again', 'again'])
    await review(user, mild, ['again', 'again', 'good'])

    const { mostAgain } = await new LeitnerStatsService().problemCards(user.id)

    assert.strictEqual(mostAgain[0].id, worst.id)
    assert.strictEqual(mostAgain[0].count, 5)
    assert.strictEqual(mostAgain[1].id, mild.id)
    assert.strictEqual(mostAgain[1].count, 2) // seuls les `again` comptent, pas le `good`
  })

  test('« coincées en boîte 1-2 » : boîte basse ET assez de tentatives', async ({ assert }) => {
    const user = await createAdmin()
    const stuck = await makeCard(user, null, 1)
    const fresh = await makeCard(user, null, 1)
    const advanced = await makeCard(user, null, 4)
    await review(user, stuck, ['again', 'hard', 'again', 'hard']) // 4 tentatives, boîte 1
    await review(user, fresh, ['good']) // 1 tentative → trop neuve pour être « coincée »
    await review(user, advanced, ['good', 'good', 'good', 'good']) // boîte 4 → pas coincée

    const { stuck: stuckCards } = await new LeitnerStatsService().problemCards(user.id)
    const ids = stuckCards.map((c) => c.id)

    assert.include(ids, stuck.id)
    assert.notInclude(ids, fresh.id)
    assert.notInclude(ids, advanced.id)
    assert.strictEqual(stuckCards.find((c) => c.id === stuck.id)?.count, 4) // nombre de révisions
  })

  test('« coincées » lit MA boîte et MES tentatives, pas celles du voisin', async ({ assert }) => {
    // La même carte : montée en boîte 5 par un collègue, coincée en boîte 1 chez moi.
    // ⚠️ Deux filtres distincts se croisent ici — la boîte (jointure de progression) et le
    // compte de tentatives (`withCount` filtré). En oublier un désignerait des cartes que
    // je n'ai jamais vues, ou masquerait celles qui me résistent vraiment.
    const mine = await createAdmin()
    const theirs = await createAdmin()
    const card = await makeCard(mine, null, 1)
    await setProgress(theirs.id, card.id, { box: 5 })

    await review(mine, card, ['again', 'again', 'again'])
    await review(theirs, card, ['good', 'good', 'good'])

    const forMe = await new LeitnerStatsService().problemCards(mine.id)
    const forThem = await new LeitnerStatsService().problemCards(theirs.id)

    assert.include(
      forMe.stuck.map((c) => c.id),
      card.id
    )
    assert.strictEqual(forMe.stuck.find((c) => c.id === card.id)?.count, 3)
    // Boîte 5 chez lui : la carte n'est pas « coincée », et son compte n'inclut pas mes 3.
    assert.notInclude(
      forThem.stuck.map((c) => c.id),
      card.id
    )
  })

  test('la boîte affichée sur une carte à problème est celle du lecteur', async ({ assert }) => {
    const mine = await createAdmin()
    const theirs = await createAdmin()
    const card = await makeCard(mine, null, 2)
    await setProgress(theirs.id, card.id, { box: 5 })

    await review(mine, card, ['again', 'again'])
    await review(theirs, card, ['again', 'again'])

    const forMe = await new LeitnerStatsService().problemCards(mine.id)
    const forThem = await new LeitnerStatsService().problemCards(theirs.id)

    assert.strictEqual(forMe.mostAgain.find((c) => c.id === card.id)?.box, 2)
    assert.strictEqual(forThem.mostAgain.find((c) => c.id === card.id)?.box, 5)
  })
})

/** `total` grades dont `again` en `again`, le reste en `good`. */
function fill(total: number, again: number): Grade[] {
  return Array.from({ length: total }, (_, index) => (index < again ? 'again' : 'good'))
}
