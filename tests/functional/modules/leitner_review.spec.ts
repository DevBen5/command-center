import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#core/auth/models/user'
import LeitnerCard from '#modules/leitner/models/leitner_card'

// La file de révision est reconstruite à chaque chargement de /revision : il n'y a
// aucun état de session. Ces tests vérifient qu'une carte ratée revient bien dans la
// session en cours — et qu'elle y revient en FIN de file, sans se re-présenter en boucle.
test.group('Leitner / file de révision', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  function login() {
    return User.create({
      fullName: 'Utilisateur Test',
      email: 'test@example.com',
      password: 'secret123',
    })
  }

  function makeCard(front: string, box: number) {
    return LeitnerCard.create({ front, back: 'Verso', box, nextReview: DateTime.now() })
  }

  async function dueCards(client: any, user: User) {
    const response = await client.get('/revision').loginAs(user).withInertia()
    response.assertStatus(200)
    return (response.inertiaProps as Record<string, any>).dueCards as any[]
  }

  function review(client: any, user: User, card: LeitnerCard, grade: string) {
    return client
      .post(`/revision/${card.id}/review`)
      .json({ grade })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)
  }

  test('une carte notée `again` reste due le jour même', async ({ client, assert }) => {
    const user = await login()
    const card = await makeCard('Ratée', 3)

    await review(client, user, card, 'again')

    await card.refresh()
    assert.equal(card.box, 1)
    assert.equal(card.nextReview.toISODate(), DateTime.now().toISODate())
    // Elle est toujours dans la file : on revoit ce qu'on vient de rater.
    assert.lengthOf(await dueCards(client, user), 1)
  })

  test('une carte notée `again` repart en fin de file, pas en tête', async ({ client, assert }) => {
    const user = await login()
    const first = await makeCard('Première', 3)
    await makeCard('Seconde', 2)

    const before = await dueCards(client, user)
    assert.deepEqual(
      before.map((card) => card.front),
      ['Première', 'Seconde']
    )

    await review(client, user, first, 'again')

    // `first` retombe en boîte 1 : un tri par boîte la remettrait en tête et la
    // re-présenterait aussitôt. Elle doit passer derrière « Seconde ».
    const after = await dueCards(client, user)
    assert.deepEqual(
      after.map((card) => card.front),
      ['Seconde', 'Première']
    )
  })

  test('une carte réussie quitte la session du jour', async ({ client, assert }) => {
    const user = await login()
    const good = await makeCard('Sue', 2)
    const hard = await makeCard('Péniblement sue', 2)

    await review(client, user, good, 'good')
    await review(client, user, hard, 'hard')

    // `hard` fait stagner la carte, mais l'échéance reste dans le futur : la
    // session se vide. Seul `again` maintient une carte due.
    assert.lengthOf(await dueCards(client, user), 0)
  })

  test('la page reçoit la note précédente et les intervalles des boîtes', async ({
    client,
    assert,
  }) => {
    const user = await login()
    const card = await makeCard('Déjà difficile', 3)
    await review(client, user, card, 'hard')
    await card.merge({ nextReview: DateTime.now() }).save()

    const response = await client.get('/revision').loginAs(user).withInertia()
    const props = response.inertiaProps as Record<string, any>

    // Sans ces deux props, les boutons ne peuvent pas annoncer leur effet réel :
    // ici un second `hard` renverrait la carte en boîte 1.
    assert.equal(props.dueCards[0].lastGrade, 'hard')
    assert.deepEqual(props.boxIntervals, { 1: 1, 2: 2, 3: 4, 4: 7, 5: 30 })
  })
})
