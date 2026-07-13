import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#core/auth/models/user'
import LeitnerCard from '#modules/leitner/models/leitner_card'

// La prop partagée `nav` alimente les pastilles de la barre latérale (AppLayout.vue).
// Le rendu du badge n'est pas testable côté serveur, mais la donnée dont il dépend l'est :
// une stat à zéro et une stat non chargée sont deux cas distincts, et le layout les
// distingue sur la présence de la valeur — pas sur sa vérité. Ces tests verrouillent
// cette distinction : `0` doit rester `0`, et jamais devenir absent ou nul.
test.group('Core / stats de navigation', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function login() {
    return User.create({
      fullName: 'Utilisateur Test',
      email: 'test@example.com',
      password: 'secret123',
    })
  }

  test('expose des compteurs à zéro sur une base vide', async ({ client, assert }) => {
    const user = await login()

    const response = await client.get('/').loginAs(user).withInertia()

    response.assertStatus(200)
    const props = response.inertiaProps as Record<string, any>

    assert.strictEqual(props.nav.services.down, 0)
    assert.strictEqual(props.nav.agents.failed, 0)
    assert.strictEqual(props.nav.veille.queue, 0)
    assert.strictEqual(props.nav.leitner.due, 0)
  })

  test('compte les cartes dues quand il y en a', async ({ client, assert }) => {
    const user = await login()
    await LeitnerCard.create({
      front: 'Recto',
      back: 'Verso',
      box: 1,
      nextReview: DateTime.now(),
    })

    const response = await client.get('/').loginAs(user).withInertia()

    const props = response.inertiaProps as Record<string, any>
    assert.strictEqual(props.nav.leitner.due, 1)
  })

  test('ne transporte aucune stat hors authentification', async ({ client, assert }) => {
    const response = await client.get('/login').withInertia()

    response.assertStatus(200)
    const props = response.inertiaProps as Record<string, any>

    // Pas de stat chargée : le layout ne doit afficher aucune pastille, surtout pas un « 0 ».
    assert.isNull(props.nav)
  })
})
