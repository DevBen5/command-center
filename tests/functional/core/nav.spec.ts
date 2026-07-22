import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import { createAdmin, createUserWith } from '#tests/helpers/users'

// La prop partagée `nav` alimente les pastilles de la barre latérale (AppLayout.vue).
// Le rendu du badge n'est pas testable côté serveur, mais la donnée dont il dépend l'est :
// une stat à zéro et une stat non chargée sont deux cas distincts, et le layout les
// distingue sur la présence de la valeur — pas sur sa vérité. Ces tests verrouillent
// cette distinction : `0` doit rester `0`, et jamais devenir absent ou nul.
//
// Depuis CC-71 s'y ajoute un troisième cas : `null` **par manque de droit**. Il se
// confond volontairement avec « non chargé » côté layout — dans les deux cas il n'y a
// rien à afficher — mais il ne se confond pas avec `0`.
test.group('Core / stats de navigation', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('expose des compteurs à zéro sur une base vide', async ({ client, assert }) => {
    const admin = await createAdmin()

    const response = await client.get('/').loginAs(admin).withInertia()

    response.assertStatus(200)
    const props = response.inertiaProps as Record<string, any>

    assert.strictEqual(props.nav.services.down, 0)
    assert.strictEqual(props.nav.agents.failed, 0)
    assert.strictEqual(props.nav.veille.queue, 0)
    assert.strictEqual(props.nav.leitner.due, 0)
  })

  test('compte les cartes dues quand il y en a', async ({ client, assert }) => {
    const admin = await createAdmin()
    await LeitnerCard.create({
      front: 'Recto',
      back: 'Verso',
      box: 1,
      nextReview: DateTime.now(),
    })

    const response = await client.get('/').loginAs(admin).withInertia()

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

  test('ne transporte pas les compteurs des modules interdits', async ({ client, assert }) => {
    // ⚠️ Un compteur est déjà une information : « 12 items en file » en dit sur un module
    // auquel ce compte n'a pas accès. Le masquage de l'entrée dans la barre est du confort,
    // mais autant ne pas envoyer la donnée non plus.
    const lecteur = await createUserWith(['dashboard.view', 'leitner.view'])

    const response = await client.get('/').loginAs(lecteur).withInertia()

    response.assertStatus(200)
    const props = response.inertiaProps as Record<string, any>

    assert.isNull(props.nav.services)
    assert.isNull(props.nav.agents)
    assert.isNull(props.nav.veille)
    // Celui-là est accordé : il vaut 0, pas null — les deux ne veulent pas dire la même chose.
    assert.strictEqual(props.nav.leitner.due, 0)
  })

  test('partage les capacités sans jamais matérialiser « tout » pour un admin', async ({
    client,
    assert,
  }) => {
    const admin = await createAdmin()

    const response = await client.get('/').loginAs(admin).withInertia()
    const props = response.inertiaProps as Record<string, any>

    assert.isTrue(props.user.isAdmin)
    // ⚠️ Un administrateur passe outre la vérification, il ne porte pas la liste de tout.
    // L'aplatir ici obligerait à la tenir à jour à chaque ajout de capacité.
    assert.isEmpty(props.user.capabilities)
  })

  test('partage les capacités d’un compte non-admin', async ({ client, assert }) => {
    const lecteur = await createUserWith(['dashboard.view', 'leitner.view'])

    const response = await client.get('/').loginAs(lecteur).withInertia()
    const props = response.inertiaProps as Record<string, any>

    assert.isFalse(props.user.isAdmin)
    assert.sameMembers(props.user.capabilities, ['dashboard.view', 'leitner.view'])
  })
})
