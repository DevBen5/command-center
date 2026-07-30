import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import User from '#core/auth/models/user'
import { LoginThrottleService } from '#core/auth/services/login_throttle_service'

/**
 * Le throttle de POST /login (CC-78) : par IP et par email, sur les échecs seulement.
 *
 * ⚠️ Les compteurs vivent dans le store mémoire (`.env.test`), PAS dans la base :
 * la transaction globale ne les rollback pas. D'où le `limiter.clear` en setup ET
 * en teardown — sans lui, les échecs accumulés ici bloqueraient les connexions
 * des specs suivantes (elles partagent toutes l'IP 127.0.0.1), et l'échec de
 * `login.spec.ts` s'accumulerait ici.
 */
test.group('Auth / throttle de connexion', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(async () => {
    await limiter.clear(['memory'])
    return () => limiter.clear(['memory'])
  })

  /** Un échec de connexion : mauvais mot de passe, posté comme le ferait le formulaire. */
  async function failOnce(client: ApiClient, email: string) {
    await client
      .post('/login')
      .form({ email, password: 'mauvais-mot-de-passe' })
      .header('referrer', '/login')
      .withCsrfToken()
      .redirects(0)
  }

  test('5 échecs sur un email le bloquent, même avec le bon mot de passe ensuite', async ({
    client,
  }) => {
    await User.create({
      fullName: 'Utilisateur Test',
      email: 'cible@example.com',
      password: 'secret123',
    })

    for (let i = 0; i < 5; i++) {
      await failOnce(client, 'cible@example.com')
    }

    // Le bon mot de passe ne passe plus : c'est la preuve que le blocage précède
    // la vérification. Un compte non bloqué atterrirait sur /aucun-acces.
    const response = await client
      .post('/login')
      .form({ email: 'cible@example.com', password: 'secret123' })
      .header('referrer', '/login')
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/login')
  })

  test("les échecs d'un email ne bloquent pas les autres", async ({ client }) => {
    await User.create({
      fullName: 'Utilisateur Test',
      email: 'innocent@example.com',
      password: 'secret123',
    })

    // 5 échecs sur un AUTRE email : son compteur est plein, celui d'innocent@ est
    // vide, et l'IP (5 échecs) reste sous son seuil de 10.
    for (let i = 0; i < 5; i++) {
      await failOnce(client, 'attaque@example.com')
    }

    const response = await client
      .post('/login')
      .form({ email: 'innocent@example.com', password: 'secret123' })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/aucun-acces')
  })

  test("10 échecs d'une IP la bloquent, même pour un email jamais tenté", async ({ client }) => {
    await User.create({
      fullName: 'Utilisateur Test',
      email: 'victime@example.com',
      password: 'secret123',
    })

    // L'attaquant arrose : 10 emails différents, un échec chacun. Aucun compteur
    // email n'atteint son seuil de 5 — c'est bien l'IP seule qui bloque.
    for (let i = 0; i < 10; i++) {
      await failOnce(client, `compte${i}@example.com`)
    }

    const response = await client
      .post('/login')
      .form({ email: 'victime@example.com', password: 'secret123' })
      .header('referrer', '/login')
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/login')
  })

  test('une connexion réussie remet les compteurs à zéro', async ({ client }) => {
    await User.create({
      fullName: 'Utilisateur Test',
      email: 'cible@example.com',
      password: 'secret123',
    })

    // 4 échecs (sous le seuil de 5), un succès, puis 4 nouveaux échecs : si le
    // succès n'effaçait pas, on serait à 8 et la dernière tentative — bon mot de
    // passe — serait bloquée au lieu d'atterrir.
    for (let i = 0; i < 4; i++) {
      await failOnce(client, 'cible@example.com')
    }

    const success = await client
      .post('/login')
      .form({ email: 'cible@example.com', password: 'secret123' })
      .withCsrfToken()
      .redirects(0)
    success.assertHeader('location', '/aucun-acces')

    for (let i = 0; i < 4; i++) {
      await failOnce(client, 'cible@example.com')
    }

    const response = await client
      .post('/login')
      .form({ email: 'cible@example.com', password: 'secret123' })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/aucun-acces')
  })

  test('la fenêtre écoulée remet les compteurs à zéro', async ({ assert }) => {
    // La même logique que la prod, avec une fenêtre d'une seconde : dormir
    // 15 minutes dans un test n'est pas une option, et c'est le SERVICE qui
    // porte la fenêtre — le contrôleur ne fait que l'interroger.
    const throttle = new LoginThrottleService({ ipFailures: 2, emailFailures: 2, duration: 1 })

    await throttle.recordFailure('10.0.0.1', 'fenetre@example.com')
    await throttle.recordFailure('10.0.0.1', 'fenetre@example.com')
    assert.isAbove(await throttle.secondsBeforeRetry('10.0.0.1', 'fenetre@example.com'), 0)

    await new Promise((resolve) => setTimeout(resolve, 1100))

    assert.equal(await throttle.secondsBeforeRetry('10.0.0.1', 'fenetre@example.com'), 0)
  })
})
