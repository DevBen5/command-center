import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { createUserWith } from '#tests/helpers/users'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerSettings from '#modules/leitner/models/leitner_settings'
import LeitnerIngestion from '#modules/leitner/models/leitner_ingestion'

/**
 * CC-72 — Leitner en lecture seule pour les non-admins.
 *
 * Le rôle « invité » porte exactement `leitner.view` + `leitner.stats.view`, rien d'autre.
 * Ces tests sont TOUS côté serveur, et c'est le point : masquer un bouton n'est pas un
 * droit — une route est un contrat public, et un appel direct muni d'un cookie de session
 * valide n'a que faire du rendu Vue.
 *
 * ⚠️ **L'assertion qui compte n'est pas le code HTTP mais l'état de la base après le refus.**
 * Le module est mono-utilisateur (CC-70) : `box` et `next_review` sont des colonnes de la
 * carte, pas d'une progression par personne, et `leitner_settings` est une ligne unique et
 * partagée. C'est cette corruption des données du propriétaire qu'on empêche, pas un
 * formulaire.
 */
test.group('Leitner / lecture seule (invité)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  /** L'invité de CC-72 : il voit les cartes et les stats, il n'écrit rien. */
  function guest() {
    return createUserWith(['leitner.view', 'leitner.stats.view'])
  }

  function makeCard() {
    return LeitnerCard.create({
      front: 'Recto',
      back: 'Verso',
      box: 3,
      nextReview: DateTime.now().plus({ days: 5 }),
    })
  }

  test('un invité peut lister les cartes, le catalogue et les stats', async ({ client }) => {
    const user = await guest()

    // Les trois écrans en lecture : la file, le catalogue (`leitner.view`) et l'effort
    // (`leitner.stats.view`). Aucune n'écrit, toutes doivent répondre 200.
    for (const route of ['/revision', '/revision/settings', '/revision/stats']) {
      const response = await client.get(route).loginAs(user).withInertia()
      response.assertStatus(200)
    }
  })

  test('noter une carte est refusé, et la carte ne bouge pas en base', async ({
    client,
    assert,
  }) => {
    const user = await guest()
    const card = await makeCard()
    const boxAvant = card.box
    const dueAvant = card.nextReview.toISODate()

    const response = await client
      .post(`/revision/${card.id}/review`)
      .json({ grade: 'easy' })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(403)

    // Le cœur du lot : `easy` aurait envoyé la carte deux boîtes plus loin, pour tout le
    // monde. Elle n'a pas bougé.
    await card.refresh()
    assert.equal(card.box, boxAvant)
    assert.equal(card.nextReview.toISODate(), dueAvant)
  })

  test('créer une carte est refusé, et rien n’est écrit', async ({ client, assert }) => {
    const user = await guest()
    const cartesAvant = await LeitnerCard.all()

    const response = await client
      .post('/revision/cards')
      .json({ front: 'Injectée', back: 'par un invité' })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(403)
    const cartesApres = await LeitnerCard.all()
    assert.equal(cartesApres.length, cartesAvant.length)
  })

  test('régler les intervalles est refusé, et la ligne unique ne bouge pas', async ({
    client,
    assert,
  }) => {
    const user = await guest()
    const avant = await LeitnerSettings.findOrFail(1)
    const box1Avant = avant.box1Days

    const response = await client
      .put('/revision/settings/intervals')
      .json({ box1Days: 99, box2Days: 99, box3Days: 99, box4Days: 99, box5Days: 99 })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(403)

    // `leitner_settings` est partagée par toute l'installation : un invité ne redéfinit
    // pas l'espacement des révisions du propriétaire.
    const apres = await LeitnerSettings.findOrFail(1)
    assert.equal(apres.box1Days, box1Avant)
  })

  test('lancer une ingestion est refusé, et aucun travail n’est créé', async ({
    client,
    assert,
  }) => {
    const user = await guest()
    const travauxAvant = await LeitnerIngestion.all()

    const response = await client
      .post('/revision/ingest')
      .json({ text: 'Un cours de test, collé par quelqu’un qui n’en a pas le droit.' })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(403)
    const travauxApres = await LeitnerIngestion.all()
    assert.equal(travauxApres.length, travauxAvant.length)
  })

  test('exporter la base est refusé', async ({ client }) => {
    const user = await guest()

    // L'export est en lecture, mais il rend l'intégralité du contenu (réponses écrites
    // comprises) en un fichier : sous `leitner.backup`, refusé à l'invité.
    const response = await client.get('/revision/export').loginAs(user).redirects(0)

    response.assertStatus(403)
  })

  test('un refus sur une route JSON est un 403 JSON, pas une redirection', async ({
    client,
    assert,
  }) => {
    const user = await guest()

    // Les routes JSON nues (extraction, juge, diagnostic LLM) sont appelées en `fetch` :
    // un refus qui redirigerait casserait la page au lieu de dire non. Le middleware de
    // capacité rend un 403 avec corps JSON, uniformément — c'est vérifié ici.
    const response = await client
      .post('/revision/ingest/extract')
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(403)
    assert.property(response.body(), 'error')
  })
})
