import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import testUtils from '@adonisjs/core/services/test_utils'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerReview from '#modules/leitner/models/leitner_review'
import LeitnerService from '#modules/leitner/services/leitner_service'

// Intervalles attendus, boîte par boîte — duplique volontairement BOX_INTERVAL_DAYS :
// un test qui importerait la constante n'asserterait plus rien.
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

  test('`again` renvoie la carte en boîte 1 et la laisse due aujourd’hui', async ({ assert }) => {
    const card = await makeCard(4)

    await new LeitnerService().review(card, 'again')

    assert.equal(card.box, 1)
    // Due le jour même : la carte reste dans la file et revient dans la session.
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
