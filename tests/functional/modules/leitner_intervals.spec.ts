import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#core/auth/models/user'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerService from '#modules/leitner/services/leitner_service'

// Les intervalles des boîtes se règlent depuis /revision/settings, comme le reste
// de la saisie. Ils vivent en base (une seule ligne), pas dans une constante.
test.group('Leitner / intervalles des boîtes', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  function login() {
    return User.create({
      fullName: 'Utilisateur Test',
      email: 'test@example.com',
      password: 'secret123',
    })
  }

  const DEFAULTS = { box1Days: 1, box2Days: 2, box3Days: 4, box4Days: 7, box5Days: 30 }

  test('l’écran de gestion affiche les intervalles en vigueur', async ({ client, assert }) => {
    const user = await login()

    const response = await client.get('/revision/settings').loginAs(user).withInertia()

    response.assertStatus(200)
    const props = response.inertiaProps as Record<string, any>
    assert.deepEqual(props.boxIntervals, { 1: 1, 2: 2, 3: 4, 4: 7, 5: 30 })
  })

  test('le réglage est persisté et s’applique à la révision suivante', async ({
    client,
    assert,
  }) => {
    const user = await login()
    const card = await LeitnerCard.create({
      front: 'Recto',
      back: 'Verso',
      box: 2,
      nextReview: DateTime.now(),
    })

    await client
      .put('/revision/settings/intervals')
      .json({ ...DEFAULTS, box3Days: 10 })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    assert.deepEqual(await new LeitnerService().boxIntervals(), { 1: 1, 2: 2, 3: 10, 4: 7, 5: 30 })

    await client
      .post(`/revision/${card.id}/review`)
      .json({ grade: 'good' })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    await card.refresh()
    assert.equal(card.box, 3)
    // Boîte 3 réglée à 10 jours : c'est la base qui fait foi, pas la constante.
    assert.equal(card.nextReview.toISODate(), DateTime.now().plus({ days: 10 }).toISODate())
  })

  test('un intervalle à 0 est refusé sans rien écrire en base', async ({ client, assert }) => {
    const user = await login()

    const response = await client
      .put('/revision/settings/intervals')
      .json({ ...DEFAULTS, box2Days: 0 })
      .header('referrer', '/revision/settings')
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    // Un intervalle nul laisserait la carte due le jour de sa réussite, donc
    // éternellement en session : c'est le privilège de `again`.
    assert.deepEqual(await new LeitnerService().boxIntervals(), { 1: 1, 2: 2, 3: 4, 4: 7, 5: 30 })
  })
})
