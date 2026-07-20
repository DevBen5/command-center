import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#core/auth/models/user'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerReview from '#modules/leitner/models/leitner_review'
import LlmClient, { LlmUnavailableError } from '#modules/leitner/services/llm_client'
import FakeLlmClient from '#tests/fakes/fake_llm_client'

// La file de révision est reconstruite à chaque chargement de /revision : il n'y a
// aucun état de session. Ces tests vérifient qu'une carte ratée revient bien dans la
// session en cours — et qu'elle y revient en FIN de file, sans se re-présenter en boucle.
//
// ⚠️ Ils visent `?scope=all` : `/revision` **nu** est désormais l'écran de choix d'un
// paquet. Leurs assertions n'ont pas bougé d'une ligne, et c'est le but — `?scope=all`
// se comporte exactement comme `/revision` d'avant le ciblage par thème.
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
    const response = await client.get('/revision?scope=all').loginAs(user).withInertia()
    response.assertStatus(200)
    return (response.inertiaProps as Record<string, any>).dueCards as any[]
  }

  function review(client: any, user: User, card: LeitnerCard, grade: string, judgment: any = {}) {
    return client
      .post(`/revision/${card.id}/review`)
      .json({ grade, ...judgment })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)
  }

  test('une carte notée `again` reste due le jour même, dans sa boîte', async ({
    client,
    assert,
  }) => {
    const user = await login()
    const card = await makeCard('Ratée', 3)

    await review(client, user, card, 'again')

    await card.refresh()
    // `again` ne rétrograde pas : il remet la carte dans la session, sans sanction.
    assert.equal(card.box, 3)
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

    const response = await client.get('/revision?scope=all').loginAs(user).withInertia()
    const props = response.inertiaProps as Record<string, any>

    // Sans ces deux props, les boutons ne peuvent pas annoncer leur effet réel :
    // ici un second `hard` renverrait la carte en boîte 1.
    assert.equal(props.dueCards[0].lastGrade, 'hard')
    assert.deepEqual(props.boxIntervals, { 1: 1, 2: 2, 3: 4, 4: 7, 5: 30 })
  })

  /*
  |----------------------------------------------------------------------------
  | La réponse écrite et le juge : il PROPOSE, l'utilisateur DISPOSE
  |----------------------------------------------------------------------------
  | Les deux garanties de ce lot, et elles se contredisent en apparence : le juge
  | doit servir à quelque chose (un verdict s'historise), et il ne doit décider de
  | rien (la note appliquée reste celle du clic).
  */

  test("un verdict `faux` n'empêche pas d'appliquer `easy` — le juge ne note pas", async ({
    client,
    assert,
  }) => {
    const user = await login()
    const card = await makeCard('Notée contre le juge', 2)

    // Le cas que le ticket demande de garantir : le juge dit faux, l'utilisateur sait
    // qu'il savait, il clique « Facile ». C'est SA note qui s'applique.
    await review(client, user, card, 'easy', {
      answer: 'Une réponse que le juge a trouvée fausse.',
      verdict: 'faux',
      latencyMs: 320,
    })

    await card.refresh()
    // `easy` = +2 boîtes. Si le verdict avait pesé, on serait resté en boîte 2.
    assert.equal(card.box, 4)
    // L'échéance suit la boîte atteinte : `faux` n'a pas rendu la carte due ce soir.
    assert.notEqual(card.nextReview.toISODate(), DateTime.now().toISODate())

    const saved = await LeitnerReview.query().where('leitner_card_id', card.id).firstOrFail()
    // Les deux cohabitent en base, et c'est normal : la note dit l'effort de rappel,
    // le verdict dit la justesse. Ils ne mesurent pas la même chose.
    assert.equal(saved.grade, 'easy')
    assert.equal(saved.verdict, 'faux')
    assert.equal(saved.answer, 'Une réponse que le juge a trouvée fausse.')
    assert.equal(saved.latencyMs, 320)
  })

  test('sans juge, la file se comporte exactement comme avant ce lot', async ({
    client,
    assert,
  }) => {
    const user = await login()
    const card = await makeCard('Notée sans juge', 3)

    // Aucun champ de jugement : c'est l'auto-évaluation d'avant le ticket.
    await review(client, user, card, 'again')

    await card.refresh()
    assert.equal(card.box, 3)
    assert.equal(card.nextReview.toISODate(), DateTime.now().toISODate())
    assert.lengthOf(await dueCards(client, user), 1)

    const saved = await LeitnerReview.query().where('leitner_card_id', card.id).firstOrFail()
    // ⚠️ `null` se relit comme « jamais jugé », jamais comme « jugé faux ».
    assert.isNull(saved.answer)
    assert.isNull(saved.verdict)
    assert.isNull(saved.latencyMs)
  })

  test('la réponse écrite est conservée même quand le juge est éteint', async ({
    client,
    assert,
  }) => {
    const user = await login()
    const card = await makeCard('Répondue pendant une panne', 1)

    await review(client, user, card, 'good', { answer: 'Ma réponse.', verdict: null })

    const saved = await LeitnerReview.query().where('leitner_card_id', card.id).firstOrFail()
    // Ce qui permettra de rejuger a posteriori ce qui a été écrit pendant la panne.
    assert.equal(saved.answer, 'Ma réponse.')
    assert.isNull(saved.verdict)
  })

  test('un juge éteint rend 200 et aucun verdict — jamais une erreur', async ({ client }) => {
    const user = await login()
    const card = await makeCard('À juger', 1)

    // ⚠️ Le test qui porte l'attendu « repli obligatoire » : LM Studio est mort, et le
    // dévoilement du verso ne doit PAS casser. Un 500 ici bloquerait la révision.
    app.container.swap(
      LlmClient,
      () =>
        new FakeLlmClient(() => {
          throw new LlmUnavailableError('Le serveur LLM est injoignable.')
        })
    )

    try {
      const response = await client
        .post(`/revision/${card.id}/judge`)
        .json({ answer: 'Une réponse quelconque.' })
        .loginAs(user)
        .withCsrfToken()

      response.assertStatus(200)
      response.assertBodyContains({ verdict: null, suggestedGrade: null, unavailable: true })
    } finally {
      app.container.restore(LlmClient)
    }
  })

  test('le juge rend un verdict et le bouton qu’il suggère', async ({ client, assert }) => {
    const user = await login()
    const card = await makeCard('À juger aussi', 1)

    app.container.swap(
      LlmClient,
      () => new FakeLlmClient(['{"verdict":"partiel","manquant":"la seconde moitié"}'])
    )

    try {
      const response = await client
        .post(`/revision/${card.id}/judge`)
        .json({ answer: 'Une moitié de réponse.' })
        .loginAs(user)
        .withCsrfToken()

      response.assertStatus(200)
      // `partiel → hard` : une réponse incomplète a été rappelée péniblement.
      response.assertBodyContains({
        verdict: 'partiel',
        missing: 'la seconde moitié',
        suggestedGrade: 'hard',
        unavailable: false,
      })
    } finally {
      app.container.restore(LlmClient)
    }

    // ⚠️ Juger n'écrit RIEN : tant qu'aucun bouton n'est cliqué, il n'y a pas de
    // révision. C'est aussi ce qui rend un double-clic sans conséquence en base.
    assert.lengthOf(await LeitnerReview.query().where('leitner_card_id', card.id), 0)
  })
})
