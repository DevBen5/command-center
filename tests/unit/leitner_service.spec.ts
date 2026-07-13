import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import testUtils from '@adonisjs/core/services/test_utils'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerReview from '#modules/leitner/models/leitner_review'
import LeitnerService from '#modules/leitner/services/leitner_service'

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

  test('une bonne réponse fait monter la carte d’une boîte', async ({ assert }) => {
    const card = await makeCard(2)

    await new LeitnerService().review(card, 'good')

    assert.equal(card.box, 3)
    // Boîte 3 = révision dans 4 jours.
    assert.equal(card.nextReview.toISODate(), DateTime.now().plus({ days: 4 }).toISODate())
  })

  test('un échec renvoie la carte en boîte 1, due le lendemain', async ({ assert }) => {
    const card = await makeCard(4)

    await new LeitnerService().review(card, 'again')

    assert.equal(card.box, 1)
    assert.equal(card.nextReview.toISODate(), DateTime.now().plus({ days: 1 }).toISODate())
  })

  test('la boîte est plafonnée à 5', async ({ assert }) => {
    const card = await makeCard(5)

    await new LeitnerService().review(card, 'easy')

    assert.equal(card.box, 5)
    // Boîte 5 = révision mensuelle.
    assert.equal(card.nextReview.toISODate(), DateTime.now().plus({ days: 30 }).toISODate())
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
