import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#core/auth/models/user'
import { LOGIN_STAMP_KEY } from '#core/auth/services/session_lifetime'

/**
 * L'expiration absolue des sessions (CC-78) : au-delà de 7 jours après la
 * connexion, re-login obligatoire même en pleine activité.
 *
 * La cible des requêtes est /aucun-acces : la seule page authentifiée qu'un
 * compte nu peut ouvrir — le test mesure la session, pas les capacités.
 */
test.group('Auth / expiration absolue de session', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function bareUser() {
    return User.create({
      fullName: 'Utilisateur Test',
      email: 'test@example.com',
      password: 'secret123',
    })
  }

  test('expulse une session connectée depuis plus de 7 jours', async ({ client }) => {
    const user = await bareUser()

    const response = await client
      .get('/aucun-acces')
      .loginAs(user)
      .withSession({ [LOGIN_STAMP_KEY]: DateTime.now().minus({ days: 8 }).toISO() })
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/login')
  })

  test('laisse passer une session plus jeune que 7 jours', async ({ client }) => {
    const user = await bareUser()

    const response = await client
      .get('/aucun-acces')
      .loginAs(user)
      .withSession({ [LOGIN_STAMP_KEY]: DateTime.now().minus({ days: 6 }).toISO() })
      .redirects(0)

    response.assertStatus(200)
  })

  test('un tampon absent est posé, jamais expulsé', async ({ client }) => {
    // Les sessions d'avant CC-78 n'ont pas de tampon : les expulser
    // déconnecterait tout le monde au déploiement. Le tampon part de maintenant.
    const user = await bareUser()

    const response = await client.get('/aucun-acces').loginAs(user).redirects(0)

    response.assertStatus(200)
    response.assertSession(LOGIN_STAMP_KEY)
  })

  test('un tampon illisible expulse', async ({ client }) => {
    // Personne ne peut écrire ça dans une session chiffrée — seul un bug de
    // notre code le produirait. Le sens sûr est l'expulsion, pas l'indulgence.
    const user = await bareUser()

    const response = await client
      .get('/aucun-acces')
      .loginAs(user)
      .withSession({ [LOGIN_STAMP_KEY]: 'pas-une-date' })
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/login')
  })

  test('la connexion pose le tampon', async ({ client }) => {
    await bareUser()

    const response = await client
      .post('/login')
      .form({ email: 'test@example.com', password: 'secret123' })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertSession(LOGIN_STAMP_KEY)
  })
})
