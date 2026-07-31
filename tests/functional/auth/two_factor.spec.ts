import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import { TOTP, Secret } from 'otpauth'
import User from '#core/auth/models/user'
import UserRecoveryCode from '#core/auth/models/user_recovery_code'
import twoFactor from '#core/auth/services/two_factor_service'
import { overrideAdminTotpRequired } from '#core/auth/services/two_factor_policy'
import { PENDING_2FA_KEY, pendingChallengeFor } from '#core/auth/services/two_factor_challenge'
import invitationService from '#core/auth/services/invitation_service'
import { createAdmin, createUserWith, enrollTotp } from '#tests/helpers/users'

/**
 * Le second facteur TOTP (CC-114), de bout en bout.
 *
 * ⚠️ **`auth_web` est la clé de session du guard, et c'est l'assertion qui compte ici.** Un
 * 302 vers l'écran du code ne prouve rien tout seul : si `auth.login()` avait déjà eu lieu, la
 * session serait ouverte et le second facteur ne serait qu'une politesse. `assertSessionMissing`
 * est la seule façon de dire « le mot de passe n'a *pas* connecté ».
 *
 * ⚠️ **Chaque requête du client Japa est indépendante** — elles ne partagent pas de cookie de
 * session. L'étape 2 pose donc son marqueur avec `withSession()`, comme `session_expiry.spec.ts`
 * pose son tampon de connexion. Ce que ça ne prouve pas : que les deux étapes se lient bout à
 * bout dans un vrai navigateur. Ce que ça prouve, et qui est le nerf : l'étape 1 **écrit** ce
 * marqueur et rien d'autre, l'étape 2 ne se contente **que** de lui.
 *
 * ⚠️ Ce qui reste hors de portée : qu'une vraie application d'authentification lise le QR
 * affiché. Le paramétrage qui rend ce QR lisible est figé par `tests/unit/totp.spec.ts` contre
 * un vecteur de la RFC — c'est le plus près qu'on aille sans téléphone.
 *
 * ⚠️ Les compteurs du throttle vivent en mémoire (`.env.test`) et **ne sont pas rollbackés** :
 * `limiter.clear` en setup et en teardown, comme `login_throttle.spec.ts` — sans quoi les
 * échecs volontaires d'ici bloqueraient les specs suivantes, qui partagent l'IP 127.0.0.1.
 */
const AUTH_SESSION_KEY = 'auth_web'

/** Le code que l'application d'authentification afficherait à cet instant. */
function codeFor(secret: string, at: number = Date.now()): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate({ timestamp: at })
}

function login(client: ApiClient, email: string, password = 'secret123') {
  return client
    .post('/login')
    .form({ email, password })
    .header('referrer', '/login')
    .withCsrfToken()
    .redirects(0)
}

/** L'étape 2, avec le marqueur qu'aurait posé l'étape 1. */
function submitCode(client: ApiClient, user: User, code: string) {
  return client
    .post('/login/2fa')
    .form({ code })
    .withSession({ [PENDING_2FA_KEY]: pendingChallengeFor(user.id) })
    .header('referrer', '/login/2fa')
    .withCsrfToken()
    .redirects(0)
}

test.group('Auth / second facteur', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(async () => {
    await limiter.clear(['memory'])
    return () => limiter.clear(['memory'])
  })

  test('un compte sans second facteur se connecte comme avant', async ({ client }) => {
    // Le critère de succès du ticket, et le cas de presque tous les comptes : rien de ce lot
    // ne doit s'interposer sur ce chemin-là.
    const user = await createUserWith(['leitner.view'])

    const response = await login(client, user.email)

    response.assertStatus(302)
    response.assertHeader('location', '/revision')
    response.assertSession(AUTH_SESSION_KEY, user.id)
  })

  test('un compte enrôlé n’est PAS connecté par son seul mot de passe', async ({ client }) => {
    const user = await createUserWith(['leitner.view'])
    await enrollTotp(user)

    const response = await login(client, user.email)

    response.assertStatus(302)
    response.assertHeader('location', '/login/2fa')
    // L'assertion décisive : la session ne porte aucune connexion, seulement le demi-tour.
    response.assertSessionMissing(AUTH_SESSION_KEY)
    response.assertSession(PENDING_2FA_KEY)
  })

  test('le bon code connecte, et mène là où le compte a le droit d’aller', async ({ client }) => {
    const user = await createUserWith(['leitner.view'])
    const secret = await enrollTotp(user)

    const response = await submitCode(client, user, codeFor(secret))

    response.assertStatus(302)
    response.assertHeader('location', '/revision')
    response.assertSession(AUTH_SESSION_KEY, user.id)
    // Le demi-tour est consommé : le laisser derrière soi serait un second chemin d'entrée
    // dont personne ne tient les comptes.
    response.assertSessionMissing(PENDING_2FA_KEY)
  })

  test('un mauvais code ne connecte pas', async ({ client }) => {
    const user = await createUserWith(['leitner.view'])
    await enrollTotp(user)

    const response = await submitCode(client, user, '000000')

    response.assertStatus(302)
    response.assertSessionMissing(AUTH_SESSION_KEY)
  })

  test('un code déjà consommé ne resert pas', async ({ client }) => {
    // L'anti-rejeu, vu de l'extérieur : le même code, deux fois, dans sa fenêtre de validité.
    // L'état vit en base (`totp_last_step`), donc il traverse deux requêtes indépendantes.
    const user = await createUserWith(['leitner.view'])
    const secret = await enrollTotp(user)
    const code = codeFor(secret)

    const premier = await submitCode(client, user, code)
    premier.assertSession(AUTH_SESSION_KEY, user.id)

    const rejoue = await submitCode(client, user, code)
    rejoue.assertSessionMissing(AUTH_SESSION_KEY)
  })

  test('les échecs de code comptent dans le throttle, qu’un mot de passe rejoué n’efface pas', async ({
    client,
    assert,
  }) => {
    /**
     * ⚠️ **Le mode d'échec le plus coûteux de ce lot, et il est silencieux.** Le throttle de
     * CC-78 efface ses compteurs dès qu'un mot de passe est bon. Si cet effacement restait à
     * l'étape 1, quiconque connaît le mot de passe rejouerait le formulaire entre chaque essai
     * de code : six chiffres, un million de combinaisons, plus aucun plafond. La boucle
     * ci-dessous **est** cette attaque — c'est le blocage qui doit finir par tomber.
     */
    const user = await createUserWith(['leitner.view'])
    await enrollTotp(user)

    for (let essai = 0; essai < 5; essai++) {
      await login(client, user.email)
      await submitCode(client, user, '000000')
    }

    const response = await login(client, user.email)

    // Bloqué dès le mot de passe : renvoyé au formulaire de connexion, pas à l'écran du code.
    response.assertHeader('location', '/login')
    assert.isTrue(
      await limiter
        .use({ requests: 5, duration: '15 mins' })
        .isBlocked(`login_email_${user.email.toLowerCase()}`)
    )
  })

  test('un code de secours connecte, et ne resert jamais', async ({ client, assert }) => {
    const user = await createUserWith(['leitner.view'])
    await enrollTotp(user)
    const codes = await twoFactor.regenerateRecoveryCodes(user)

    const premier = await submitCode(client, user, codes[0])
    premier.assertHeader('location', '/revision')
    premier.assertSession(AUTH_SESSION_KEY, user.id)

    // Le même code, une seconde fois : c'est l'usage unique qui est en jeu.
    const rejoue = await submitCode(client, user, codes[0])
    rejoue.assertSessionMissing(AUTH_SESSION_KEY)

    const restants = await UserRecoveryCode.query().where('user_id', user.id).whereNull('used_at')
    assert.lengthOf(restants, 9)
  })

  test('un code de secours se recopie tel qu’il s’affiche, tiret compris', async ({ client }) => {
    // Les codes sont **affichés** en `XXXX-XXXX` : sans normalisation, les recopier tels quels
    // échouerait, et la seule façon de s'en servir serait de deviner qu'il faut retirer le
    // tiret — au pire moment, celui où l'on vient de perdre son téléphone.
    const user = await createUserWith(['leitner.view'])
    await enrollTotp(user)
    const codes = await twoFactor.regenerateRecoveryCodes(user)

    const response = await submitCode(client, user, `  ${codes[0].toLowerCase()}  `)

    response.assertSession(AUTH_SESSION_KEY, user.id)
  })

  test('un code de secours reste utilisable même si le secret est illisible', async ({
    client,
  }) => {
    // ⚠️ APP_KEY changée : tous les `totp_secret` deviennent illisibles d'un coup. Les codes de
    // secours sont hachés, donc indépendants de cette clé — c'est ce qui fait de la porte de
    // secours une vraie porte, et pas une seconde serrure sur le même barillet.
    const user = await createUserWith(['leitner.view'])
    await enrollTotp(user)
    const codes = await twoFactor.regenerateRecoveryCodes(user)

    user.totpSecret = 'chiffre-illisible'
    await user.save()

    const response = await submitCode(client, user, codes[0])

    response.assertSession(AUTH_SESSION_KEY, user.id)
  })

  test('un secret illisible refuse la connexion au lieu de l’ouvrir', async ({ client }) => {
    // L'autre moitié du cas précédent : sans code de secours sous la main, un secret
    // indéchiffrable doit **fermer**. Le traiter comme « pas de second facteur » désarmerait
    // la protection au moment précis où quelque chose d'anormal est arrivé à la base.
    const user = await createUserWith(['leitner.view'])
    const secret = await enrollTotp(user)
    user.totpSecret = 'chiffre-illisible'
    await user.save()

    const response = await submitCode(client, user, codeFor(secret))

    response.assertSessionMissing(AUTH_SESSION_KEY)
  })

  test('un compte désactivé entre les deux étapes ne finit pas sa connexion', async ({
    client,
  }) => {
    const user = await createUserWith(['leitner.view'])
    const secret = await enrollTotp(user)
    user.isActive = false
    await user.save()

    const response = await submitCode(client, user, codeFor(secret))

    response.assertHeader('location', '/login')
    response.assertSessionMissing(AUTH_SESSION_KEY)
  })

  test('un marqueur expiré renvoie au mot de passe', async ({ client }) => {
    // Un demi-tour de connexion ne doit pas rester consommable des heures sur une machine
    // partagée. La borne vit dans `two_factor_challenge.ts`.
    const user = await createUserWith(['leitner.view'])
    const secret = await enrollTotp(user)

    const response = await client
      .post('/login/2fa')
      .form({ code: codeFor(secret) })
      .withSession({
        [PENDING_2FA_KEY]: { userId: user.id, at: '2020-01-01T00:00:00.000+00:00' },
      })
      .withCsrfToken()
      .redirects(0)

    response.assertHeader('location', '/login')
    response.assertSessionMissing(AUTH_SESSION_KEY)
  })

  test('l’écran du code n’est pas atteignable sans avoir donné son mot de passe', async ({
    client,
  }) => {
    const response = await client.get('/login/2fa').redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/login')
  })

  test('l’écran du code se rend, et nomme le compte attendu', async ({ client }) => {
    /**
     * ⚠️ **Sans ce test, aucun n'ouvre jamais cet écran** : les autres postent directement le
     * code. Ce qu'il prouve — le marqueur est relu, le compte retrouvé, la page répond 200 avec
     * l'email attendu — est ce qui casserait le plus discrètement.
     *
     * ⚠️ Ce qu'il **ne** prouve **pas** : que `core/auth/login_two_factor` désigne un fichier
     * qui existe. `inertia.render` ne touche pas le disque ; la résolution du nom vers
     * `app/core/auth/pages/login_two_factor.vue` se fait dans `inertia/app/app.ts`, **côté
     * client**. Un nom erroné répondrait donc 200 ici et n'échouerait que devant l'utilisateur
     * (point 3 du CLAUDE.md) — limite partagée avec `pages.spec.ts`, pas propre à ce test.
     */
    const user = await createUserWith(['leitner.view'])
    await enrollTotp(user)

    const response = await client
      .get('/login/2fa')
      .withSession({ [PENDING_2FA_KEY]: pendingChallengeFor(user.id) })
      .withInertia()

    response.assertStatus(200)
    response.assertInertiaComponent('core/auth/login_two_factor')
    // À qui on demande un code — sans rien apprendre à qui n'a pas franchi l'étape du mot
    // de passe, puisque l'écran n'est pas atteignable sans elle (test précédent).
    response.assertInertiaPropsContains({ email: user.email })
  })

  test('accepter une invitation exige aussi le second facteur', async ({ client }) => {
    /**
     * ⚠️ **Sans ce détour, la 2FA serait décorative.** Un lien d'invitation pose un mot de
     * passe **et** connecte : c'est le « mot de passe oublié » du projet. Quiconque intercepte
     * un lien entrerait sans jamais croiser le second facteur, quel que soit le soin mis à le
     * vérifier sur `/login`.
     */
    const user = await createUserWith(['leitner.view'])
    await enrollTotp(user)
    const token = await invitationService.issueFor(user)

    const response = await client
      .post(`/invitation/${token}`)
      .form({ password: 'motdepasse-long-1', password_confirmation: 'motdepasse-long-1' })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/login/2fa')
    response.assertSessionMissing(AUTH_SESSION_KEY)
  })
})

test.group('Auth / second facteur exigé des administrateurs', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(() => {
    overrideAdminTotpRequired(true)
    // ⚠️ Rendue à son défaut après **chaque** test : la laisser allumée changerait le
    // comportement des specs suivantes, et l'échec se lirait à des kilomètres d'ici.
    return () => overrideAdminTotpRequired(null)
  })

  test('un administrateur sans second facteur est renvoyé vers son écran de sécurité', async ({
    client,
  }) => {
    const admin = await createAdmin()

    const response = await client.get('/').loginAs(admin).redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/profil/securite')
  })

  test('cet écran s’ouvre — la redirection ne boucle pas', async ({ client }) => {
    // ⚠️ **L'assertion sans laquelle la précédente serait un piège.** Si l'écran de sécurité
    // était lui aussi soumis à la règle, il se redirigerait vers lui-même à l'infini : le
    // navigateur afficherait « trop de redirections » et le compte serait enfermé dehors —
    // exactement la panne que la règle est censée éviter.
    const admin = await createAdmin()

    const response = await client.get('/profil/securite').loginAs(admin)

    response.assertStatus(200)
  })

  test('les POST de l’enrôlement passent aussi', async ({ client, assert }) => {
    // Le cran suivant du même piège : laisser l'écran s'afficher mais bloquer ses formulaires
    // donnerait une page qui ne mène nulle part, ce qui ressemble à un bug de l'écran.
    const admin = await createAdmin()

    const response = await client
      .post('/profil/securite/enrolement')
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/profil/securite')

    await admin.refresh()
    assert.isNotNull(twoFactor.pendingEnrollment(admin))
  })

  test('la déconnexion reste possible sans enrôler', async ({ client }) => {
    // Personne ne doit être retenu dans une application par une règle de sécurité.
    const admin = await createAdmin()

    const response = await client.post('/logout').loginAs(admin).withCsrfToken().redirects(0)

    response.assertHeader('location', '/login')
  })

  test('un administrateur enrôlé circule normalement', async ({ client }) => {
    const admin = await createAdmin()
    await enrollTotp(admin)

    const response = await client.get('/').loginAs(admin)

    response.assertStatus(200)
  })

  test('un compte non-administrateur n’est jamais concerné', async ({ client }) => {
    // La règle ne vise que `is_admin` : pour tout le monde, le second facteur reste optionnel,
    // comme le demande le ticket.
    const user = await createUserWith(['leitner.view'])

    const response = await client.get('/revision').loginAs(user)

    response.assertStatus(200)
  })

  test('un administrateur ne peut pas se retirer le second facteur exigé', async ({
    client,
    assert,
  }) => {
    // Masquer le bouton ne ferme rien : la route répond que l'écran l'affiche ou non.
    const admin = await createAdmin()
    await enrollTotp(admin)

    const response = await client
      .post('/profil/securite/desactivation')
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(403)

    await admin.refresh()
    assert.isTrue(admin.hasTotp)
  })
})

test.group('Auth / réinitialisation par un administrateur', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('elle retire le facteur et ses codes de secours', async ({ client, assert }) => {
    // La sortie de secours ultime : téléphone perdu **et** codes perdus. Sans elle, la seule
    // réparation serait un UPDATE en SQL.
    const admin = await createAdmin()
    const user = await User.create({
      fullName: 'Compte enrôlé',
      email: 'enrole@example.com',
      password: 'secret123',
    })
    await enrollTotp(user)
    await twoFactor.regenerateRecoveryCodes(user)

    const response = await client
      .post(`/admin/users/${user.id}/2fa/reset`)
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    await user.refresh()
    assert.isFalse(user.hasTotp)
    assert.isNull(user.totpSecret)

    // ⚠️ Les codes partent avec le reste : en laisser derrière soi rendrait utilisables, après
    // un réenrôlement, des codes distribués sous l'ancien secret.
    const restants = await UserRecoveryCode.query().where('user_id', user.id)
    assert.lengthOf(restants, 0)
  })

  test('le compte se reconnecte ensuite avec son seul mot de passe', async ({ client }) => {
    const user = await createUserWith(['leitner.view'])
    await enrollTotp(user)
    await twoFactor.disable(user)

    const response = await login(client, user.email)

    response.assertHeader('location', '/revision')
    response.assertSession(AUTH_SESSION_KEY, user.id)
  })
})
