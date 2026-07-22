import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import type User from '#core/auth/models/user'
import { createUserWith } from '#tests/helpers/users'
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
    return createUserWith(['leitner.view', 'leitner.review'])
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

  /*
  |----------------------------------------------------------------------------
  | Le timer fantôme : la fluence AFFINE la proposition, elle ne la décide pas
  |----------------------------------------------------------------------------
  | Le juge laisse `hard`, `good` et `easy` indistincts — tous trois sont « juste »
  | pour lui. Le temps jusqu'à la première frappe récupère la nuance, à trois
  | conditions sans lesquelles la mesure ment. Ces conditions sont les trois
  | critères de succès du ticket, et les voici bout en bout.
  |
  | La règle elle-même est prouvée unitairement (`tests/unit/leitner_fluency.spec.ts`,
  | du code pur) : ce qui se joue ici est le **branchement** — la référence lue en
  | base, la re-présentation tranchée côté serveur, et ce qui finit vraiment écrit.
  */

  /** Des mesures passées, donc jamais des re-présentations du jour. */
  async function withFluencyHistory(card: LeitnerCard, thinkingMs: number, count: number) {
    for (let index = 0; index < count; index++) {
      await LeitnerReview.create({
        leitnerCardId: card.id,
        grade: 'good',
        thinkingMs,
        reviewedAt: DateTime.now().minus({ days: index + 1 }),
      })
    }
  }

  /** Le verso exact court-circuite le juge : verdict « juste », et aucun LLM à brancher. */
  function judge(client: any, user: User, card: LeitnerCard, measure: any) {
    return client
      .post(`/revision/${card.id}/judge`)
      .json({ answer: 'Verso', ...measure })
      .loginAs(user)
      .withCsrfToken()
  }

  test('une réponse juste ET très rapide fait proposer `easy`', async ({ client }) => {
    const user = await login()
    const card = await makeCard('Bien sue', 2)
    // Cinq mesures : la carte devient sa propre référence, médiane 10 s.
    await withFluencyHistory(card, 10_000, 5)

    const response = await judge(client, user, card, { thinkingMs: 3_000, totalMs: 6_000 })

    response.assertStatus(200)
    // Sans le chrono, CC-43 s'arrêtait à `good` sur tout verdict juste. C'est la nuance
    // que ce lot récupère — et elle reste une SUGGESTION, pas une note appliquée.
    response.assertBodyContains({ verdict: 'juste', suggestedGrade: 'easy' })
  })

  test('une carte qui ne se connaît pas encore se compare à sa boîte', async ({ client }) => {
    const user = await login()
    const known = await makeCard('Voisine de boîte', 2)
    await withFluencyHistory(known, 10_000, 20)
    // La cible n'a aucune mesure à elle : c'est la médiane de la boîte qui sert.
    const card = await makeCard('Nouvelle en boîte 2', 2)

    const response = await judge(client, user, card, { thinkingMs: 3_000, totalMs: 6_000 })

    response.assertStatus(200)
    // ⚠️ Ce test existe pour la **jointure**, pas pour la règle (prouvée unitairement) :
    // une relation mal nommée rendrait zéro ligne, donc « aucune référence », donc la
    // présélection de CC-43 — un repli parfaitement silencieux, et le lot ne servirait
    // jamais tant qu'une carte n'a pas 5 mesures à elle.
    response.assertBodyContains({ verdict: 'juste', suggestedGrade: 'easy' })
  })

  test('une carte re-présentée dans la journée n’est jamais proposée `easy`', async ({
    client,
  }) => {
    const user = await login()
    const card = await makeCard('Ratée puis redonnée', 2)
    await withFluencyHistory(card, 10_000, 5)
    // ⚠️ Le premier critère du ticket. `again` a laissé la carte due le jour même : la
    // seconde réponse est rapide par **mémoire de travail**, pas par apprentissage.
    // La proposer `easy` reviendrait à promouvoir une carte qu'on vient de rater.
    await review(client, user, card, 'again')

    const response = await judge(client, user, card, { thinkingMs: 300, totalMs: 800 })

    response.assertStatus(200)
    // Même mesure absurde de rapidité qu'au test précédent : c'est la re-présentation,
    // et elle seule, qui fait retomber sur la présélection de CC-43.
    response.assertBodyContains({ verdict: 'juste', suggestedGrade: 'good' })
  })

  test('une carte sans historique retombe sur la présélection de CC-43', async ({ client }) => {
    const user = await login()
    const card = await makeCard('Jamais mesurée', 1)

    const response = await judge(client, user, card, { thinkingMs: 200, totalMs: 500 })

    response.assertStatus(200)
    // ⚠️ Le deuxième critère du ticket. Sans référence, il n'y a rien à comparer : le
    // lot doit être **indiscernable de son absence** — pas de badge, pas de message.
    response.assertBodyContains({ verdict: 'juste', suggestedGrade: 'good' })
  })

  test('une perte de focus écarte la mesure au lieu de l’historiser', async ({
    client,
    assert,
  }) => {
    const user = await login()
    const card = await makeCard('Interrompue', 2)

    // ⚠️ Le troisième critère du ticket. Le téléphone a sonné pendant la réflexion.
    //
    // ⚠️ **40 s, et surtout PAS 400 s** : au-delà du plafond de 120 s, la mesure serait
    // écartée de toute façon et ce test passerait même si le drapeau `interrupted`
    // n'était plus lu nulle part. Ici elle est parfaitement plausible : seul le drapeau
    // l'écarte.
    await review(client, user, card, 'good', {
      answer: 'Une réponse écrite après l’interruption.',
      thinkingMs: 40_000,
      totalMs: 55_000,
      interrupted: true,
    })

    const saved = await LeitnerReview.query().where('leitner_card_id', card.id).firstOrFail()
    // `null` = « mesure inexploitable », jamais « instantané ». Sans ça, cette valeur
    // polluerait la médiane de la carte et lui vaudrait `hard` pendant des semaines.
    assert.isNull(saved.thinkingMs)
    // Le temps total, lui, s'écrit toujours : c'est de l'observation, aucune règle ne
    // le lit. Il permettra de vérifier après coup que mesurer la 1ʳᵉ frappe était juste.
    assert.equal(saved.totalMs, 55_000)
  })

  test('une interruption annoncée au juge annule aussi le raffinement', async ({ client }) => {
    const user = await login()
    const card = await makeCard('Interrompue puis jugée', 2)
    await withFluencyHistory(card, 10_000, 5)

    // 40 s contre une médiane de 10 s : sans le drapeau, ce serait `hard`. Ce test
    // couvre le **câblage** du drapeau de bout en bout — page → validateur → `suggest` —
    // que l'unitaire ne voit pas.
    const response = await judge(client, user, card, {
      thinkingMs: 40_000,
      totalMs: 55_000,
      interrupted: true,
    })

    response.assertStatus(200)
    response.assertBodyContains({ verdict: 'juste', suggestedGrade: 'good' })
  })

  test('une première présentation répondue historise bien sa mesure', async ({
    client,
    assert,
  }) => {
    const user = await login()
    const card = await makeCard('Première du jour', 1)

    await review(client, user, card, 'good', {
      answer: 'Ma réponse.',
      thinkingMs: 7_500,
      totalMs: 21_000,
    })

    const saved = await LeitnerReview.query().where('leitner_card_id', card.id).firstOrFail()
    // ⚠️ Le test de l'ordre d'écriture : la question « déjà présentée aujourd'hui ? »
    // compte les révisions existantes, donc elle DOIT être posée avant l'insertion.
    // Posée après, elle répondrait toujours « oui » — et cette colonne resterait
    // éternellement vide, sans une erreur ni un log.
    assert.equal(saved.thinkingMs, 7_500)
    assert.equal(saved.totalMs, 21_000)
  })

  test('la mesure d’une re-présentation n’entre pas dans l’historique', async ({
    client,
    assert,
  }) => {
    const user = await login()
    const card = await makeCard('Redonnée dans la session', 2)

    await review(client, user, card, 'again', { answer: 'Raté.', thinkingMs: 20_000 })
    await review(client, user, card, 'good', { answer: 'Su, cette fois.', thinkingMs: 900 })

    const saved = await LeitnerReview.query().where('leitner_card_id', card.id).orderBy('id', 'asc')

    // ⚠️ **Le même filtre gouverne l'affichage et l'écriture, et les deux ne peuvent
    // pas diverger.** Retenir les 900 ms de la seconde tentative ferait dériver la
    // médiane de la carte vers le bas, et une carte mal sue finirait par se voir
    // proposer `easy` : exactement ce que ce lot existe pour empêcher. C'est ce
    // couplage qui permet de relire `thinking_ms` sans jamais filtrer.
    assert.equal(saved[0].thinkingMs, 20_000)
    assert.isNull(saved[1].thinkingMs)
  })

  test('une révision sans réponse écrite ne mesure rien', async ({ client, assert }) => {
    const user = await login()
    const card = await makeCard('Dévoilée sans répondre', 1)

    // Dévoiler sans rien taper n'est pas une tentative de rappel : l'inclure
    // mélangerait deux populations dans la même colonne — le reproche fait à
    // `latency_ms`, qu'on ne refait pas ici.
    await review(client, user, card, 'good', { thinkingMs: 4_000, totalMs: 9_000 })

    const saved = await LeitnerReview.query().where('leitner_card_id', card.id).firstOrFail()
    assert.isNull(saved.thinkingMs)
    assert.equal(saved.totalMs, 9_000)
  })
})
