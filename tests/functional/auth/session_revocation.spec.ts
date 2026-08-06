import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import { DateTime } from 'luxon'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import User from '#core/auth/models/user'
import { LOGIN_STAMP_KEY } from '#core/auth/services/session_lifetime'
import { createUserWith } from '#tests/helpers/users'

/**
 * Fermer les sessions ouvertes ailleurs (CC-176).
 *
 * Le store est `cookie` : rien à invalider par session. Ce qui est vérifié ici, c'est la seule
 * mécanique qui existe — la borne `users.sessions_valid_from` comparée au tampon de connexion de
 * CC-78, à chaque requête, dans `AuthMiddleware`.
 *
 * ⚠️ **La cible des requêtes est `/aucun-acces`** : la seule page authentifiée qu'un compte nu
 * peut ouvrir, comme dans `session_expiry.spec.ts`. Ce qu'on mesure est la session, pas les
 * capacités.
 *
 * ⚠️ **Le tampon se relit dans la RÉPONSE, jamais dans la base.** C'est ce que le navigateur
 * emporte dans son cookie : le rejouer sur la requête suivante est la seule façon de reproduire
 * le geste réel — cliquer, puis recharger. Comparer des dates côté serveur passerait même si le
 * contrôleur n'écrivait rien dans la session.
 *
 * ⚠️ Le throttle de ré-authentification vit en mémoire (`.env.test`) et n'est PAS rollbacké par
 * la transaction de test : `limiter.clear` en setup et teardown, même raison que
 * `change_password.spec.ts`.
 */
const MOT_DE_PASSE = 'secret123'

/** Une requête authentifiée quelconque, avec le tampon donné — ou aucun. */
function visite(client: ApiClient, user: User, tampon?: string) {
  const requete = client.get('/aucun-acces').loginAs(user).redirects(0)

  return tampon === undefined ? requete : requete.withSession({ [LOGIN_STAMP_KEY]: tampon })
}

function revoquer(client: ApiClient, user: User, tampon: string) {
  return client
    .post('/reglages/sessions')
    .loginAs(user)
    .withSession({ [LOGIN_STAMP_KEY]: tampon })
    .header('referrer', '/reglages')
    .withCsrfToken()
    .redirects(0)
}

/** Pose la borne directement, pour les cas où le geste lui-même n'est pas ce qu'on mesure. */
async function poserLaBorne(user: User, quand: DateTime): Promise<void> {
  user.sessionsValidFrom = quand
  await user.save()
}

test.group('Auth / révocation des sessions ouvertes ailleurs', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(async () => {
    await limiter.clear(['memory'])
    return () => limiter.clear(['memory'])
  })

  test('une session connectée AVANT la révocation est expulsée', async ({ client }) => {
    const user = await createUserWith([])
    await poserLaBorne(user, DateTime.now())

    const response = await visite(client, user, DateTime.now().minus({ hours: 1 }).toISO())

    response.assertStatus(302)
    response.assertHeader('location', '/login')
  })

  test('une session connectée APRÈS la révocation passe', async ({ client }) => {
    const user = await createUserWith([])
    await poserLaBorne(user, DateTime.now().minus({ hours: 1 }))

    const response = await visite(client, user, DateTime.now().toISO())

    response.assertStatus(200)
  })

  test('la session qui déclenche le geste survit', async ({ client }) => {
    /*
    | ⚠️ **LE test du lot.** Le geste repose le tampon de sa propre session à la borne exacte :
    | une comparaison `<=` au lieu de `<`, ou deux appels à `now` séparés, feraient s'auto-expulser
    | l'utilisateur au rechargement suivant — symptôme « le bouton me déconnecte », cause
    | invisible. Vérifié en cassant la ligne : passer `isSessionRevoked` en `<=` fait rougir ce
    | test-ci, et lui seul.
    |
    | Le geste réel, pas un raccourci : on POSTe, on relit le tampon du cookie renvoyé, et on
    | rejoue une requête avec — exactement ce que fait le navigateur qui recharge la page.
    */
    const user = await createUserWith([])

    const revocation = await revoquer(client, user, DateTime.now().minus({ hours: 1 }).toISO())
    revocation.assertStatus(302)
    revocation.assertHeader('location', '/reglages')

    const suivante = await visite(client, user, revocation.session(LOGIN_STAMP_KEY))

    suivante.assertStatus(200)
  })

  test('le geste ferme bien les AUTRES sessions', async ({ client }) => {
    // Le pendant du test précédent : sans lui, une implémentation qui n'écrirait rien du tout
    // passerait le test « celui qui clique survit » à la perfection.
    const user = await createUserWith([])
    const autre = DateTime.now().minus({ hours: 1 }).toISO()

    await revoquer(client, user, autre)

    const response = await visite(client, user, autre)

    response.assertStatus(302)
    response.assertHeader('location', '/login')
  })

  test('une session SANS tampon est expulsée quand la borne est posée', async ({ client }) => {
    // Le piège n° 1 : `AuthMiddleware` *repose* le tampon quand il manque (CC-78), donc sans
    // règle explicite une session sans tampon recevrait une date postérieure à la borne et
    // survivrait — le geste paraîtrait fonctionner sans rien fermer.
    //
    // ⚠️ **Ce que ce test tient est `isSessionRevoked` révoquant un tampon illisible, PAS la
    // position du contrôle dans le middleware** : déplacer le bloc après la branche ne fait
    // rougir personne (le contrôle lit la valeur capturée en `const`), tolérer le tampon
    // illisible fait rougir ce test-ci. Mesuré, contre ce qu'affirmait le ticket.
    const user = await createUserWith([])
    await poserLaBorne(user, DateTime.now())

    const response = await visite(client, user)

    response.assertStatus(302)
    response.assertHeader('location', '/login')
  })

  test('une session SANS tampon passe tant que la borne est nulle', async ({ client }) => {
    // L'autre sens du même piège, et la non-régression de CC-78 : traiter « absent » comme
    // révoqué en dehors de ce cas déconnecterait tout le monde au déploiement.
    const user = await createUserWith([])

    const response = await visite(client, user)

    response.assertStatus(200)
    response.assertSession(LOGIN_STAMP_KEY)
  })

  test('se reconnecter après une révocation fonctionne, et la session obtenue survit', async ({
    client,
  }) => {
    // Le piège n° 3 : les deux bouts. `auth_controller.store` repose le tampon à chaque
    // connexion — sans ça, une révocation enfermerait le compte dehors pour de bon.
    const user = await createUserWith([])
    await poserLaBorne(user, DateTime.now())

    const connexion = await client
      .post('/login')
      .form({ email: user.email, password: MOT_DE_PASSE })
      .header('referrer', '/login')
      .withCsrfToken()
      .redirects(0)

    connexion.assertStatus(302)

    const suivante = await visite(client, user, connexion.session(LOGIN_STAMP_KEY))

    suivante.assertStatus(200)
  })

  test('changer son mot de passe révoque, et celui qui l’a changé survit', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith([])

    const changement = await client
      .post('/reglages/mot-de-passe')
      .form({
        currentPassword: MOT_DE_PASSE,
        password: 'nouveau-mot-de-passe-1',
        password_confirmation: 'nouveau-mot-de-passe-1',
      })
      .loginAs(user)
      .withSession({ [LOGIN_STAMP_KEY]: DateTime.now().minus({ hours: 1 }).toISO() })
      .header('referrer', '/reglages')
      .withCsrfToken()
      .redirects(0)

    changement.assertStatus(302)

    await user.refresh()
    assert.isNotNull(user.sessionsValidFrom)

    // C'est ce qui permet de SUPPRIMER l'avertissement plutôt que d'en écrire un autre : le
    // changement ferme les autres sessions, et ne dérange pas celle qui vient de le faire.
    const suivante = await visite(client, user, changement.session(LOGIN_STAMP_KEY))
    suivante.assertStatus(200)
  })

  test('la route est fermée sans session', async ({ client }) => {
    const response = await client.post('/reglages/sessions').withCsrfToken().redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/login')
  })
})
