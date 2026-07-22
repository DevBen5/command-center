import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { createAdmin, createUserWith, createUserWithoutAccess } from '#tests/helpers/users'

/**
 * La vérification est sur la **route**, pas dans l'UI.
 *
 * ⚠️ Masquer un bouton n'est pas un droit : une route est un contrat public, et un appel
 * direct muni d'un cookie de session valide n'a que faire du rendu Vue. Ces tests font
 * exactement cet appel direct.
 */
test.group('Core / capacités sur les routes', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('un compte authentifié sans aucune capacité n’accède à rien', async ({ client }) => {
    const user = await createUserWithoutAccess()

    for (const route of ['/', '/veille', '/revision', '/revision/settings']) {
      const response = await client.get(route).loginAs(user)
      response.assertStatus(403)
    }
  })

  test('une capacité de lecture n’ouvre pas l’écriture', async ({ client }) => {
    const user = await createUserWith(['leitner.view'])

    const lecture = await client.get('/revision').loginAs(user)
    lecture.assertStatus(200)

    // La note écrit `box` et `next_review` sur la carte : c'est pour ça que `leitner.review`
    // est séparée de `leitner.view`, et le refus doit tenir sur l'appel direct.
    const ecriture = await client
      .post('/revision/1/review')
      .json({ grade: 'easy' })
      .loginAs(user)
      .withCsrfToken()
    ecriture.assertStatus(403)
  })

  test('une capacité d’un module n’en ouvre pas un autre', async ({ client }) => {
    const user = await createUserWith(['veille.view'])

    const permis = await client.get('/veille').loginAs(user)
    permis.assertStatus(200)

    const refuse = await client.get('/revision').loginAs(user)
    refuse.assertStatus(403)
  })

  test('Services et Agents sont refusés même avec toutes les capacités déclarées', async ({
    client,
  }) => {
    // ⚠️ Le test de l'invariant côté HTTP : ce compte porte **toutes** les capacités que
    // les modules déclarent, et Services reste fermé — parce qu'aucune capacité ne le
    // couvre, pas parce qu'une règle l'interdit nommément.
    const user = await createUserWith([
      'dashboard.view',
      'veille.view',
      'veille.items.write',
      'veille.sources.write',
      'leitner.view',
      'leitner.review',
      'leitner.cards.read',
      'leitner.cards.write',
      'leitner.ingest',
      'leitner.settings',
    ])

    const services = await client.get('/services').loginAs(user)
    services.assertStatus(403)

    const agents = await client.get('/agents').loginAs(user)
    agents.assertStatus(403)
  })

  test('l’écran d’administration est refusé à un non-admin', async ({ client }) => {
    const user = await createUserWith(['dashboard.view'])

    const liste = await client.get('/admin/users').loginAs(user)
    liste.assertStatus(403)

    const roles = await client.get('/admin/roles').loginAs(user)
    roles.assertStatus(403)

    // L'écriture aussi, pas seulement l'affichage : c'est elle qui distribue les droits.
    const creation = await client
      .post('/admin/users')
      .json({ fullName: 'Intrus', email: 'intrus@example.com' })
      .loginAs(user)
      .withCsrfToken()
    creation.assertStatus(403)
  })

  test('is_admin passe partout, y compris sur ce qu’aucun rôle ne couvre', async ({ client }) => {
    const admin = await createAdmin()

    for (const route of ['/', '/services', '/agents', '/veille', '/revision', '/admin/users']) {
      const response = await client.get(route).loginAs(admin)
      response.assertStatus(200)
    }
  })

  test('un compte désactivé est déconnecté malgré une session valide', async ({ client }) => {
    const user = await createUserWith(['dashboard.view'])
    user.isActive = false
    await user.save()

    // ⚠️ Le cas qui compte : la session existe déjà quand la désactivation tombe. Sans la
    // vérification dans `AuthMiddleware`, ce compte continuerait de naviguer avec le cookie
    // qu'il avait — c'est-à-dire précisément dans le cas où on désactive en urgence.
    const response = await client.get('/').loginAs(user).redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/login')
  })

  test('une surcharge retire une capacité accordée par le rôle', async ({ client }) => {
    const user = await createUserWith(['leitner.view'])

    const avant = await client.get('/revision').loginAs(user)
    avant.assertStatus(200)

    const { default: UserCapability } = await import('#core/auth/models/user_capability')
    await UserCapability.create({ userId: user.id, capability: 'leitner.view', granted: false })

    const apres = await client.get('/revision').loginAs(user)
    apres.assertStatus(403)
  })

  test('une surcharge accorde une capacité hors du rôle', async ({ client }) => {
    const user = await createUserWithoutAccess()

    const { default: UserCapability } = await import('#core/auth/models/user_capability')
    await UserCapability.create({ userId: user.id, capability: 'leitner.view', granted: true })

    const response = await client.get('/revision').loginAs(user)
    response.assertStatus(200)
  })
})
