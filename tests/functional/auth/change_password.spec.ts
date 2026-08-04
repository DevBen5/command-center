import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import User from '#core/auth/models/user'
import { ReauthThrottleService } from '#core/auth/services/reauth_throttle_service'
import { createUserWith } from '#tests/helpers/users'

/**
 * Changer son propre mot de passe (CC-147), depuis `/reglages`.
 *
 * ⚠️ Chaque test utilise `createUserWith([])` — aucune capacité — précisément pour prouver que
 * la route est ouverte à tout compte authentifié, pas seulement à ceux qui en portent une
 * (CC-71 : la route est sous `auth() + openRoute()`, comme le reste de `/reglages`).
 *
 * ⚠️ Le throttle vit en mémoire (`.env.test`) et n'est PAS rollbacké par la transaction de
 * test : `limiter.clear` en setup et en teardown, même raison que `login_throttle.spec.ts` et
 * `two_factor.spec.ts` — sans quoi les échecs volontaires d'ici bloqueraient les specs
 * suivantes, qui partagent l'IP 127.0.0.1.
 */
const AUTH_SESSION_KEY = 'auth_web'
const CURRENT_PASSWORD = 'secret123'

function changePassword(
  client: ApiClient,
  user: User,
  body: { currentPassword?: string; password?: string; password_confirmation?: string }
) {
  return client
    .post('/reglages/mot-de-passe')
    .form(body)
    .loginAs(user)
    .header('referrer', '/reglages')
    .withCsrfToken()
    .redirects(0)
}

function login(client: ApiClient, email: string, password: string) {
  return client
    .post('/login')
    .form({ email, password })
    .header('referrer', '/login')
    .withCsrfToken()
    .redirects(0)
}

test.group('Auth / changement de mot de passe', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(async () => {
    await limiter.clear(['memory'])
    return () => limiter.clear(['memory'])
  })

  test('un compte change son mot de passe et se reconnecte avec le nouveau ; l’ancien est refusé', async ({
    client,
  }) => {
    const user = await createUserWith([])

    const response = await changePassword(client, user, {
      currentPassword: CURRENT_PASSWORD,
      password: 'nouveau-mot-de-passe-1',
      password_confirmation: 'nouveau-mot-de-passe-1',
    })

    response.assertStatus(302)
    response.assertHeader('location', '/reglages')

    const ancien = await login(client, user.email, CURRENT_PASSWORD)
    ancien.assertHeader('location', '/login')
    ancien.assertSessionMissing(AUTH_SESSION_KEY)

    const nouveau = await login(client, user.email, 'nouveau-mot-de-passe-1')
    nouveau.assertSession(AUTH_SESSION_KEY, user.id)
  })

  test('le mot de passe actuel erroné est refusé et rien n’est écrit', async ({
    client,
    assert,
  }) => {
    // Le test qui porte le lot : un formulaire qui changerait le mot de passe sans vérifier
    // l'ancien verrouillerait le propriétaire dehors depuis une session volée — l'exact
    // contraire du but du ticket.
    const user = await createUserWith([])
    const hashAvant = user.password

    const response = await changePassword(client, user, {
      currentPassword: 'mauvais-mot-de-passe',
      password: 'nouveau-mot-de-passe-1',
      password_confirmation: 'nouveau-mot-de-passe-1',
    })

    response.assertStatus(302)
    response.assertHeader('location', '/reglages')
    assert.property(response.flashMessages(), 'errorsBag')

    await user.refresh()
    assert.equal(user.password, hashAvant)
  })

  test('un mot de passe trop court est refusé, par la même règle que le formulaire d’invitation', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith([])
    const hashAvant = user.password

    const response = await changePassword(client, user, {
      currentPassword: CURRENT_PASSWORD,
      password: 'court',
      password_confirmation: 'court',
    })

    response.assertStatus(302)
    response.assertHeader('location', '/reglages')

    await user.refresh()
    assert.equal(user.password, hashAvant)
  })

  test('les échecs comptent dans le throttle, et un compte bloqué ne peut pas le contourner par cet écran', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith([])
    const hashAvant = user.password

    for (let essai = 0; essai < 5; essai++) {
      await changePassword(client, user, {
        currentPassword: 'mauvais-mot-de-passe',
        password: 'nouveau-mot-de-passe-1',
        password_confirmation: 'nouveau-mot-de-passe-1',
      })
    }

    // Le 6e essai, avec le BON mot de passe actuel cette fois : bloqué quand même.
    const response = await changePassword(client, user, {
      currentPassword: CURRENT_PASSWORD,
      password: 'nouveau-mot-de-passe-1',
      password_confirmation: 'nouveau-mot-de-passe-1',
    })

    response.assertStatus(302)
    response.assertHeader('location', '/reglages')

    assert.isTrue(
      await limiter.use({ requests: 5, duration: '15 mins' }).isBlocked(`reauth_${user.id}`)
    )

    await user.refresh()
    assert.equal(user.password, hashAvant)
  })

  test('la route reste fermée sans session', async ({ client }) => {
    const response = await client
      .post('/reglages/mot-de-passe')
      .form({
        currentPassword: CURRENT_PASSWORD,
        password: 'nouveau-mot-de-passe-1',
        password_confirmation: 'nouveau-mot-de-passe-1',
      })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/login')
  })

  test('la fenêtre écoulée remet le compteur à zéro', async ({ assert }) => {
    // Même logique que `login_throttle.spec.ts` : le SERVICE porte la fenêtre, une instance à
    // fenêtre courte évite de dormir 15 minutes dans un test.
    const throttle = new ReauthThrottleService({ failures: 2, duration: 1 })

    await throttle.recordFailure(999)
    await throttle.recordFailure(999)
    assert.isAbove(await throttle.secondsBeforeRetry(999), 0)

    await new Promise((resolve) => setTimeout(resolve, 1100))

    assert.equal(await throttle.secondsBeforeRetry(999), 0)
  })
})
