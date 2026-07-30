import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import type User from '#core/auth/models/user'
import { createAdmin, createUserWith } from '#tests/helpers/users'
import { boxOf, makeCard as createCard, nextReviewOf, setProgress } from '#tests/helpers/leitner'
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
 *
 * ⚠️ **La moitié de sa justification est tombée avec CC-119, l'autre pas — et c'est la
 * distinction à tenir.** `box` et `next_review` ne sont plus des colonnes de la carte :
 * une note d'invité n'atteindrait donc plus le planning de personne, et c'est
 * précisément ce qui autorisera **CC-121** à lui accorder `leitner.review`. Restent
 * fermées ici les écritures qui touchent du **partagé** : le contenu (cartes, taxonomie),
 * l'ingestion, et `leitner_settings` — une ligne unique (`check('id = 1')`), parce que
 * les intervalles sont restés un réglage d'**installation** et non de personne. Ce
 * fichier reste donc le filet de ce qui doit continuer à refuser après CC-121.
 */
test.group('Leitner / lecture seule (invité)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  /** L'invité de CC-72 : il voit les cartes et les stats, il n'écrit rien. */
  function guest() {
    return createUserWith(['leitner.view', 'leitner.stats.view'])
  }

  /** Une carte, et la progression du **propriétaire** dessus — celle qu'on protège. */
  async function makeOwnedCard(owner: User) {
    const card = await createCard('Recto')
    await setProgress(owner.id, card.id, { box: 3, dueDaysAgo: -5 })
    return card
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
    const owner = await createAdmin()
    const card = await makeOwnedCard(owner)
    const dueAvant = (await nextReviewOf(owner.id, card.id))!.toISODate()

    const response = await client
      .post(`/revision/${card.id}/review`)
      .json({ grade: 'easy' })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(403)

    // ⚠️ **L'assertion qui compte n'est pas le 403, c'est l'état de la base après le
    // refus** — et depuis CC-119 elle porte sur la progression du PROPRIÉTAIRE, plus sur
    // la carte. Le cloisonnement fait qu'une note de l'invité n'atteindrait de toute
    // façon plus ce planning : ce test garde donc sa valeur ailleurs — il verrouille que
    // la capacité reste fermée tant que CC-121 ne l'a pas ouverte, et que le refus
    // n'écrit **rien du tout**, pas même une ligne de progression pour l'invité.
    assert.equal(await boxOf(owner.id, card.id), 3)
    assert.equal((await nextReviewOf(owner.id, card.id))!.toISODate(), dueAvant)
    assert.isNull(await nextReviewOf(user.id, card.id))
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
