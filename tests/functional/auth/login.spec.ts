import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#core/auth/models/user'

// Chaque test tourne dans une transaction globale, rollbackée à la fin :
// les utilisateurs créés ici ne polluent jamais les autres tests.
test.group('Auth / connexion', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('redirige un visiteur non authentifié vers /login', async ({ client }) => {
    const response = await client.get('/services').redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/login')
  })

  test('affiche la page de connexion aux invités', async ({ client }) => {
    const response = await client.get('/login')

    response.assertStatus(200)
  })

  test('connecte un utilisateur avec de bons identifiants', async ({ client }) => {
    await User.create({
      fullName: 'Utilisateur Test',
      email: 'test@example.com',
      password: 'secret123',
    })

    const response = await client
      .post('/login')
      .form({ email: 'test@example.com', password: 'secret123' })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/')
  })

  test('refuse de mauvais identifiants et renvoie vers le formulaire', async ({ client }) => {
    await User.create({
      fullName: 'Utilisateur Test',
      email: 'test@example.com',
      password: 'secret123',
    })

    const response = await client
      .post('/login')
      .form({ email: 'test@example.com', password: 'mauvais-mot-de-passe' })
      .header('referrer', '/login')
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/login')
  })

  test('redirige un utilisateur déjà connecté hors de /login', async ({ client }) => {
    const user = await User.create({
      fullName: 'Utilisateur Test',
      email: 'test@example.com',
      password: 'secret123',
    })

    const response = await client.get('/login').loginAs(user).redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/')
  })

  test('déconnecte et renvoie vers /login', async ({ client }) => {
    const user = await User.create({
      fullName: 'Utilisateur Test',
      email: 'test@example.com',
      password: 'secret123',
    })

    const response = await client.post('/logout').loginAs(user).withCsrfToken().redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/login')
  })
})
