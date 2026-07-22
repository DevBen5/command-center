import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import testUtils from '@adonisjs/core/services/test_utils'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerReview from '#modules/leitner/models/leitner_review'
import LeitnerService from '#modules/leitner/services/leitner_service'

// Les intervalles par défaut (1 · 2 · 4 · 7 · 30) sont posés par la migration et
// dupliqués ici à dessein : un test qui importerait DEFAULT_BOX_INTERVAL_DAYS
// n'asserterait plus rien.
const TODAY = () => DateTime.now().toISODate()
const IN = (days: number) => DateTime.now().plus({ days }).toISODate()

function makeCard(box: number) {
  return LeitnerCard.create({
    front: 'Question de test',
    back: 'Réponse de test',
    box,
    nextReview: DateTime.now(),
  })
}

test.group('LeitnerService / révision', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('`again` laisse la carte dans sa boîte et la laisse due aujourd’hui', async ({ assert }) => {
    const card = await makeCard(4)

    await new LeitnerService().review(card, 'again')

    // `again` ne rétrograde pas : il remet la carte dans la session, c'est tout.
    assert.equal(card.box, 4)
    // Due le jour même : la carte reste dans la file et revient dans la session.
    assert.equal(card.nextReview.toISODate(), TODAY())
  })

  test('`again` répété ne fait jamais descendre la carte', async ({ assert }) => {
    const card = await makeCard(5)
    const service = new LeitnerService()

    await service.review(card, 'again')
    await service.review(card, 'again')
    await service.review(card, 'again')

    assert.equal(card.box, 5)
    assert.equal(card.nextReview.toISODate(), TODAY())
  })

  test('`hard` laisse la carte dans sa boîte, à l’intervalle de cette boîte', async ({
    assert,
  }) => {
    const card = await makeCard(3)

    await new LeitnerService().review(card, 'hard')

    assert.equal(card.box, 3)
    // Boîte 3 = 4 jours. La carte stagne, mais quitte la session du jour.
    assert.equal(card.nextReview.toISODate(), IN(4))
  })

  test('deux `hard` d’affilée renvoient la carte en boîte 1, due le lendemain', async ({
    assert,
  }) => {
    const service = new LeitnerService()
    const card = await makeCard(3)

    await service.review(card, 'hard')
    assert.equal(card.box, 3)

    await service.review(card, 'hard')

    assert.equal(card.box, 1)
    // Boîte 1 = 1 jour : sanctionnée, mais pas ratée — elle ne revient pas dans la session.
    assert.equal(card.nextReview.toISODate(), IN(1))
  })

  test('un `hard` isolé ne rétrograde pas : seule la note précédente compte', async ({
    assert,
  }) => {
    const service = new LeitnerService()
    const card = await makeCard(3)

    await service.review(card, 'hard')
    await service.review(card, 'good')
    await service.review(card, 'hard')

    // hard → good → hard : les deux `hard` ne sont pas consécutifs, pas de rétrogradation.
    assert.equal(card.box, 4)
    assert.equal(card.nextReview.toISODate(), IN(7))
  })

  test('`good` fait monter la carte d’une boîte', async ({ assert }) => {
    const card = await makeCard(2)

    await new LeitnerService().review(card, 'good')

    assert.equal(card.box, 3)
    // Boîte 3 = 4 jours.
    assert.equal(card.nextReview.toISODate(), IN(4))
  })

  test('`easy` fait monter la carte de deux boîtes', async ({ assert }) => {
    const card = await makeCard(2)

    await new LeitnerService().review(card, 'easy')

    assert.equal(card.box, 4)
    // Boîte 4 = 7 jours.
    assert.equal(card.nextReview.toISODate(), IN(7))
  })

  test('la boîte est plafonnée à 5', async ({ assert }) => {
    const card = await makeCard(4)

    await new LeitnerService().review(card, 'easy')

    assert.equal(card.box, 5)
    // Boîte 5 = révision mensuelle.
    assert.equal(card.nextReview.toISODate(), IN(30))
  })

  test('chaque révision est historisée avec sa note', async ({ assert }) => {
    const card = await makeCard(1)

    await new LeitnerService().review(card, 'hard')

    const reviews = await LeitnerReview.query().where('leitner_card_id', card.id)
    assert.lengthOf(reviews, 1)
    assert.equal(reviews[0].grade, 'hard')
  })

  test('les stats comptent les révisions du jour', async ({ assert }) => {
    const service = new LeitnerService()
    const card = await makeCard(1)
    await service.review(card, 'good')

    assert.equal(await service.reviewedToday(), 1)
    assert.equal(await service.streakDays(), 1)
  })
})

test.group('LeitnerService / intervalles des boîtes', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('les intervalles par défaut sont ceux posés par la migration', async ({ assert }) => {
    assert.deepEqual(await new LeitnerService().boxIntervals(), { 1: 1, 2: 2, 3: 4, 4: 7, 5: 30 })
  })

  test('la révision applique les intervalles réglés, pas les valeurs par défaut', async ({
    assert,
  }) => {
    const service = new LeitnerService()
    await service.updateBoxIntervals({ 1: 1, 2: 3, 3: 10, 4: 21, 5: 90 })

    const card = await makeCard(2)
    await service.review(card, 'good')

    assert.equal(card.box, 3)
    // Boîte 3 réglée à 10 jours (4 par défaut).
    assert.equal(card.nextReview.toISODate(), IN(10))
  })

  test('`again` reste due le jour même quel que soit l’intervalle de sa boîte', async ({
    assert,
  }) => {
    const service = new LeitnerService()
    await service.updateBoxIntervals({ 1: 5, 2: 3, 3: 10, 4: 21, 5: 90 })

    const card = await makeCard(4)
    await service.review(card, 'again')

    assert.equal(card.box, 4)
    // Aucun intervalle ne s'applique à `again` — surtout pas les 21 jours de sa
    // boîte : la carte revient dans la session en cours.
    assert.equal(card.nextReview.toISODate(), TODAY())
  })

  test('le réglage ne recalcule pas les échéances déjà posées', async ({ assert }) => {
    const service = new LeitnerService()
    const card = await makeCard(2)
    await service.review(card, 'good')
    const scheduled = card.nextReview.toISODate()

    await service.updateBoxIntervals({ 1: 1, 2: 2, 3: 60, 4: 7, 5: 30 })

    await card.refresh()
    assert.equal(card.nextReview.toISODate(), scheduled)
  })
})
