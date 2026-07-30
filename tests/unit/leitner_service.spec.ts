import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import testUtils from '@adonisjs/core/services/test_utils'
import LeitnerReview from '#modules/leitner/models/leitner_review'
import LeitnerService from '#modules/leitner/services/leitner_service'
import type LeitnerCard from '#modules/leitner/models/leitner_card'
import type User from '#core/auth/models/user'
import { makeCard, setProgress } from '#tests/helpers/leitner'
import { createAdmin } from '#tests/helpers/users'

// Les intervalles par défaut (1 · 2 · 4 · 7 · 30) sont posés par la migration et
// dupliqués ici à dessein : un test qui importerait DEFAULT_BOX_INTERVAL_DAYS
// n'asserterait plus rien.
const TODAY = () => DateTime.now().toISODate()
const IN = (days: number) => DateTime.now().plus({ days }).toISODate()

/**
 * Une carte déjà placée en boîte `box` **pour cette personne**. Depuis CC-119 la boîte
 * n'est plus une propriété de la carte : il faut dire pour qui, sans quoi la question
 * n'a pas de réponse.
 */
async function cardInBox(user: User, box: number): Promise<LeitnerCard> {
  const card = await makeCard('Question de test', { back: 'Réponse de test' })
  await setProgress(user.id, card.id, { box })
  return card
}

test.group('LeitnerService / révision', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('`again` laisse la carte dans sa boîte et la laisse due aujourd’hui', async ({ assert }) => {
    const user = await createAdmin()
    const card = await cardInBox(user, 4)

    const progress = await new LeitnerService().review(user.id, card, 'again')

    // `again` ne rétrograde pas : il remet la carte dans la session, c'est tout.
    assert.equal(progress.box, 4)
    // Due le jour même : la carte reste dans la file et revient dans la session.
    assert.equal(progress.nextReview.toISODate(), TODAY())
  })

  test('`again` répété ne fait jamais descendre la carte', async ({ assert }) => {
    const user = await createAdmin()
    const card = await cardInBox(user, 5)
    const service = new LeitnerService()

    await service.review(user.id, card, 'again')
    await service.review(user.id, card, 'again')
    const progress = await service.review(user.id, card, 'again')

    assert.equal(progress.box, 5)
    assert.equal(progress.nextReview.toISODate(), TODAY())
  })

  test('`hard` laisse la carte dans sa boîte, à l’intervalle de cette boîte', async ({
    assert,
  }) => {
    const user = await createAdmin()
    const card = await cardInBox(user, 3)

    const progress = await new LeitnerService().review(user.id, card, 'hard')

    assert.equal(progress.box, 3)
    // Boîte 3 = 4 jours. La carte stagne, mais quitte la session du jour.
    assert.equal(progress.nextReview.toISODate(), IN(4))
  })

  test('deux `hard` d’affilée renvoient la carte en boîte 1, due le lendemain', async ({
    assert,
  }) => {
    const user = await createAdmin()
    const service = new LeitnerService()
    const card = await cardInBox(user, 3)

    const premier = await service.review(user.id, card, 'hard')
    assert.equal(premier.box, 3)

    const progress = await service.review(user.id, card, 'hard')

    assert.equal(progress.box, 1)
    // Boîte 1 = 1 jour : sanctionnée, mais pas ratée — elle ne revient pas dans la session.
    assert.equal(progress.nextReview.toISODate(), IN(1))
  })

  test('la règle du 2ᵉ `hard` ne traverse JAMAIS deux comptes', async ({ assert }) => {
    // ⚠️ **Le test qui prouve que le cloisonnement de l'historique n'était pas séparable
    // de celui de la progression** (CC-119). `lastGrade` lu sans filtre, le `hard` d'un
    // collègue arme la rétrogradation d'un autre : sa carte tomberait en boîte 1 sur un
    // premier `hard`, sans erreur, sans log — juste une progression détruite.
    const mine = await createAdmin()
    const theirs = await createAdmin()
    const service = new LeitnerService()

    const card = await makeCard('Partagée')
    await setProgress(mine.id, card.id, { box: 3 })
    await setProgress(theirs.id, card.id, { box: 3 })

    await service.review(theirs.id, card, 'hard')
    const progress = await service.review(mine.id, card, 'hard')

    // Un seul `hard` du côté de `mine` : la carte stagne, elle ne rétrograde pas.
    assert.equal(progress.box, 3)
  })

  test('un `hard` isolé ne rétrograde pas : seule la note précédente compte', async ({
    assert,
  }) => {
    const user = await createAdmin()
    const service = new LeitnerService()
    const card = await cardInBox(user, 3)

    await service.review(user.id, card, 'hard')
    await service.review(user.id, card, 'good')
    const progress = await service.review(user.id, card, 'hard')

    // hard → good → hard : les deux `hard` ne sont pas consécutifs, pas de rétrogradation.
    assert.equal(progress.box, 4)
    assert.equal(progress.nextReview.toISODate(), IN(7))
  })

  test('`good` fait monter la carte d’une boîte', async ({ assert }) => {
    const user = await createAdmin()
    const card = await cardInBox(user, 2)

    const progress = await new LeitnerService().review(user.id, card, 'good')

    assert.equal(progress.box, 3)
    // Boîte 3 = 4 jours.
    assert.equal(progress.nextReview.toISODate(), IN(4))
  })

  test('`easy` fait monter la carte de deux boîtes', async ({ assert }) => {
    const user = await createAdmin()
    const card = await cardInBox(user, 2)

    const progress = await new LeitnerService().review(user.id, card, 'easy')

    assert.equal(progress.box, 4)
    // Boîte 4 = 7 jours.
    assert.equal(progress.nextReview.toISODate(), IN(7))
  })

  test('la boîte est plafonnée à 5', async ({ assert }) => {
    const user = await createAdmin()
    const card = await cardInBox(user, 4)

    const progress = await new LeitnerService().review(user.id, card, 'easy')

    assert.equal(progress.box, 5)
    // Boîte 5 = révision mensuelle.
    assert.equal(progress.nextReview.toISODate(), IN(30))
  })

  test('une carte jamais notée démarre en boîte 1, sans ligne préalable', async ({ assert }) => {
    // L'absence de progression *est* « boîte 1, due aujourd'hui » : la première note la
    // matérialise, elle ne la trouve pas. Une lecture qui exigerait la ligne planterait
    // sur la toute première révision de chaque carte.
    const user = await createAdmin()
    const card = await makeCard('Jamais notée')

    const progress = await new LeitnerService().review(user.id, card, 'good')

    assert.equal(progress.box, 2)
    assert.equal(progress.nextReview.toISODate(), IN(2))
  })

  test('chaque révision est historisée avec sa note ET son auteur', async ({ assert }) => {
    const user = await createAdmin()
    const card = await cardInBox(user, 1)

    await new LeitnerService().review(user.id, card, 'hard')

    const reviews = await LeitnerReview.query().where('leitner_card_id', card.id)
    assert.lengthOf(reviews, 1)
    assert.equal(reviews[0].grade, 'hard')
    assert.equal(reviews[0].userId, user.id)
  })

  test('les stats comptent les révisions du jour, celles du compte seulement', async ({
    assert,
  }) => {
    const mine = await createAdmin()
    const theirs = await createAdmin()
    const service = new LeitnerService()
    const card = await cardInBox(mine, 1)

    await service.review(mine.id, card, 'good')
    await service.review(theirs.id, card, 'good')

    assert.equal(await service.reviewedToday(mine.id), 1)
    assert.equal(await service.streakDays(mine.id), 1)
  })

  test('noter ne déplace AUCUNE progression d’un autre compte', async ({ assert }) => {
    // ⚠️ **Le test qui compte du lot.** C'est l'invariant qui rend sûr d'accorder la note
    // à un collègue (CC-121) : sa révision n'atteint ni ma boîte, ni mon échéance.
    const mine = await createAdmin()
    const theirs = await createAdmin()
    const service = new LeitnerService()

    const card = await makeCard('Partagée')
    await setProgress(mine.id, card.id, { box: 2, dueDaysAgo: 1 })

    await service.review(theirs.id, card, 'easy')

    const untouched = await service.boxCounts(mine.id)
    assert.deepEqual(untouched, { 1: 0, 2: 1, 3: 0, 4: 0, 5: 0 })
    // Et la carte, elle, n'a pas bougé non plus : c'est du contenu communal.
    assert.lengthOf(await service.dueCards(mine.id), 1)
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
    const user = await createAdmin()
    const service = new LeitnerService()
    await service.updateBoxIntervals({ 1: 1, 2: 3, 3: 10, 4: 21, 5: 90 })

    const card = await cardInBox(user, 2)
    const progress = await service.review(user.id, card, 'good')

    assert.equal(progress.box, 3)
    // Boîte 3 réglée à 10 jours (4 par défaut).
    assert.equal(progress.nextReview.toISODate(), IN(10))
  })

  test('les intervalles restent un réglage d’INSTALLATION, partagé', async ({ assert }) => {
    // ⚠️ Décision de CC-119, à ne pas rouvrir sans y penser : les intervalles décrivent la
    // méthode, pas la personne. Une seule ligne (`check('id = 1')`), donc un réglage posé
    // par quelqu'un s'applique à tout le monde — c'est ce que ce test verrouille.
    const service = new LeitnerService()
    await service.updateBoxIntervals({ 1: 1, 2: 3, 3: 10, 4: 21, 5: 90 })

    assert.deepEqual(await new LeitnerService().boxIntervals(), {
      1: 1,
      2: 3,
      3: 10,
      4: 21,
      5: 90,
    })
  })

  test('`again` reste due le jour même quel que soit l’intervalle de sa boîte', async ({
    assert,
  }) => {
    const user = await createAdmin()
    const service = new LeitnerService()
    await service.updateBoxIntervals({ 1: 5, 2: 3, 3: 10, 4: 21, 5: 90 })

    const card = await cardInBox(user, 4)
    const progress = await service.review(user.id, card, 'again')

    assert.equal(progress.box, 4)
    // Aucun intervalle ne s'applique à `again` — surtout pas les 21 jours de sa
    // boîte : la carte revient dans la session en cours.
    assert.equal(progress.nextReview.toISODate(), TODAY())
  })

  test('le réglage ne recalcule pas les échéances déjà posées', async ({ assert }) => {
    const user = await createAdmin()
    const service = new LeitnerService()
    const card = await cardInBox(user, 2)
    const progress = await service.review(user.id, card, 'good')
    const scheduled = progress.nextReview.toISODate()

    await service.updateBoxIntervals({ 1: 1, 2: 2, 3: 60, 4: 7, 5: 30 })

    await progress.refresh()
    assert.equal(progress.nextReview.toISODate(), scheduled)
  })
})
