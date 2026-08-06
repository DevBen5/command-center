import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import db from '@adonisjs/lucid/services/db'
import { TOTP, Secret } from 'otpauth'
import type User from '#core/auth/models/user'
import { VAULT_UNLOCK_KEY } from '#modules/coffre/services/vault_session'
import { createUserWith, enrollTotp } from '#tests/helpers/users'
import { createVault, lockedSession, PASSPHRASE } from '#tests/helpers/coffre'

/**
 * La porte du coffre (CC-178) : deux facteurs, un seul compteur d'échecs.
 *
 * ⚠️ **C'est la moitié que `coffre_wall.spec.ts` ne peut pas tenir** : là-bas le marqueur est
 * forgé, ici il est réellement **écrit par la route**. Les deux ensemble disent que la porte pose
 * exactement ce que le mur exige — séparément, aucune des deux ne le dirait.
 *
 * ⚠️ **Les compteurs du throttle vivent en mémoire** (`.env.test`) et **ne sont pas rollbackés** :
 * `limiter.clear` en setup et en teardown, comme `login_throttle.spec.ts` — sans quoi les échecs
 * volontaires d'ici bloqueraient les specs suivantes.
 */
function codeFor(secret: string, at: number = Date.now()): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate({ timestamp: at })
}

/** ⚠️ `loginAs` **avant** `withSession`, l'ordre établi par `session_expiry.spec.ts`. */
function ouvrir(client: ApiClient, user: User, code: string, passphrase: string) {
  return client
    .post('/coffre/ouvrir')
    .form({ code, passphrase })
    .loginAs(user)
    .withSession(lockedSession())
    .header('referrer', '/coffre/ouvrir')
    .withCsrfToken()
    .redirects(0)
}

test.group('Coffre / la porte', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(async () => {
    await limiter.clear()
    return async () => limiter.clear()
  })

  test('code et passphrase justes : la porte pose le marqueur et renvoie au coffre', async ({
    client,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const secret = await enrollTotp(user)
    await createVault(user)

    const response = await ouvrir(client, user, codeFor(secret), PASSPHRASE)

    response.assertStatus(302)
    response.assertHeader('location', '/coffre')
    // ⚠️ L'assertion qui compte : le 302 seul ne dirait pas que le coffre est ouvert. C'est le
    // marqueur en session qui est la seule chose que le mur consulte.
    response.assertSession(VAULT_UNLOCK_KEY)
  })

  test('un code faux n’ouvre rien', async ({ client }) => {
    const user = await createUserWith(['coffre.view'])
    await enrollTotp(user)
    await createVault(user)

    const response = await ouvrir(client, user, '000000', PASSPHRASE)

    response.assertStatus(302)
    response.assertSessionMissing(VAULT_UNLOCK_KEY)
  })

  test('une passphrase fausse n’ouvre rien, même avec le bon code', async ({ client }) => {
    const user = await createUserWith(['coffre.view'])
    const secret = await enrollTotp(user)
    await createVault(user)

    const response = await ouvrir(client, user, codeFor(secret), 'une-autre-passphrase')

    response.assertStatus(302)
    response.assertSessionMissing(VAULT_UNLOCK_KEY)
  })

  test('un compte sans second facteur ne peut pas ouvrir, quelle que soit la passphrase', async ({
    client,
  }) => {
    // ⚠️ La conséquence assumée du choix « TOTP + passphrase » : sans enrôlement, le coffre est
    // inatteignable — y compris pour son propriétaire. L'écran le dit avant le formulaire ;
    // ce test dit que le serveur le tient aussi, `curl` compris.
    const user = await createUserWith(['coffre.view'])
    await createVault(user)

    const response = await ouvrir(client, user, '123456', PASSPHRASE)

    response.assertStatus(302)
    response.assertSessionMissing(VAULT_UNLOCK_KEY)
  })

  test('les échecs sont throttlés par le compteur de CC-147, pas par un second', async ({
    client,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const secret = await enrollTotp(user)
    await createVault(user)

    // Cinq échecs = le seuil de `ReauthThrottleService`. Le sixième essai doit être refusé
    // **avant** toute vérification, même avec les deux bonnes preuves.
    for (let essai = 0; essai < 5; essai += 1) {
      await ouvrir(client, user, '000000', PASSPHRASE)
    }

    const bloque = await ouvrir(client, user, codeFor(secret), PASSPHRASE)

    bloque.assertStatus(302)
    bloque.assertSessionMissing(VAULT_UNLOCK_KEY)

    // ⚠️ Sans cette seconde moitié, le test passerait au vert sur une porte qui refuse **tout**.
    await limiter.clear()
    const apres = await ouvrir(client, user, codeFor(secret), PASSPHRASE)
    apres.assertSession(VAULT_UNLOCK_KEY)
  })

  test('poser le coffre : la passphrase est créée, et un second coffre est refusé', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const secret = await enrollTotp(user)

    const creation = await client
      .post('/coffre/creation')
      .form({
        code: codeFor(secret),
        passphrase: PASSPHRASE,
        passphrase_confirmation: PASSPHRASE,
      })
      .loginAs(user)
      .withSession(lockedSession())
      .header('referrer', '/coffre/ouvrir')
      .withCsrfToken()
      .redirects(0)

    creation.assertStatus(302)
    creation.assertHeader('location', '/coffre')
    creation.assertSession(VAULT_UNLOCK_KEY)

    // ⚠️ **Un second coffre changerait le sel, donc la clé — et rendrait indéchiffrables, sans
    // lever, toutes les entrées déjà écrites.** C'est le mode d'échec silencieux du lot.
    const second = await client
      .post('/coffre/creation')
      .form({
        code: codeFor(secret, Date.now() + 60_000),
        passphrase: 'une-toute-autre-passphrase',
        passphrase_confirmation: 'une-toute-autre-passphrase',
      })
      .loginAs(user)
      .withSession(lockedSession())
      .header('referrer', '/coffre/ouvrir')
      .withCsrfToken()
      .redirects(0)

    second.assertStatus(302)

    const coffres = await db.rawQuery('select id from coffre_vaults where user_id = ?', [user.id])
    assert.lengthOf(coffres.rows, 1, 'un second coffre a été posé — le sel a changé sous les pieds')
  })

  test('verrouiller retire le marqueur', async ({ client }) => {
    const user = await createUserWith(['coffre.view'])
    const secret = await enrollTotp(user)
    await createVault(user)

    await ouvrir(client, user, codeFor(secret), PASSPHRASE)

    const response = await client
      .post('/coffre/verrouiller')
      .loginAs(user)
      .withSession(lockedSession())
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/coffre/ouvrir')
    response.assertSessionMissing(VAULT_UNLOCK_KEY)
  })
})
