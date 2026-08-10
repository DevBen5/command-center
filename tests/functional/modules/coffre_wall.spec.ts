import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import testUtils from '@adonisjs/core/services/test_utils'
import router from '@adonisjs/core/services/router'
import { LOGIN_STAMP_KEY } from '#core/auth/services/session_lifetime'
import { revokeSessions } from '#core/auth/services/session_revocation'
import {
  VAULT_UNLOCK_KEY,
  unlockMarkerFor,
  VAULT_UNLOCK_MINUTES,
} from '#modules/coffre/services/vault_session'
import keyring from '#modules/coffre/services/vault_keyring'
import { deriveKey } from '#modules/coffre/services/vault_crypto'
import { createUserWith } from '#tests/helpers/users'
import { createVault, lockedSession, unlockedSession, PASSPHRASE } from '#tests/helpers/coffre'

/**
 * Le mur du coffre (CC-178) : **la capacité ne suffit pas, il faut l'élévation**.
 *
 * ⚠️ **Le compte de ces tests porte réellement `coffre.view` et `coffre.write`, et sa session est
 * réellement valide.** C'est tout le sujet : un 403 sur un compte sans droit ne prouverait rien —
 * `can_middleware` l'aurait fermé de toute façon, et le mur pourrait avoir disparu sans que ce
 * fichier rougisse.
 *
 * ⚠️ **Chaque requête du client Japa est indépendante** (aucun cookie partagé) : l'état « coffre
 * ouvert » est donc forgé par `withSession()`, comme `two_factor.spec.ts` forge son demi-tour de
 * connexion. Ce que ça ne prouve pas : l'enchaînement de deux requêtes dans un vrai navigateur.
 * Ce que ça prouve, et qui est le nerf : le mur ne se contente **que** de ce marqueur-là, et la
 * porte l'écrit — `coffre_unlock.spec.ts` tient l'autre moitié.
 */
const ROUTES_MUREES = [
  { methode: 'get' as const, url: '/coffre' },
  // Une page par section (CC-208) : représentative du groupe `/coffre/:section`, un seul slug
  // suffit — même doctrine que les autres routes paramétrées de cette liste.
  { methode: 'get' as const, url: '/coffre/notes' },
  { methode: 'post' as const, url: '/coffre' },
  { methode: 'put' as const, url: '/coffre/1' },
  { methode: 'delete' as const, url: '/coffre/1' },
  // La révélation d'un mot de passe (CC-179) : la route la plus sensible du module, et la seule
  // dont une réponse porte un secret en clair.
  { methode: 'get' as const, url: '/coffre/1/secret' },
  // Le proxy de vignette Immich (CC-180) : l'image EST le contenu du coffre.
  { methode: 'get' as const, url: '/coffre/media/1/thumbnail' },
  // Le proxy de streaming de médias NAS (CC-181) : même raison, le média EST le contenu.
  { methode: 'get' as const, url: '/coffre/nas/1/stream' },
  // La vignette d'un élément du catalogue NAS (CC-228) : même raison, route SÉPARÉE du streaming.
  { methode: 'get' as const, url: '/coffre/catalog/nas/1/thumbnail' },
  // Le dossier verrouillé d'Immich (CC-205) : le listing comme la vignette sont du contenu.
  { methode: 'get' as const, url: '/coffre/immich/dossier' },
  {
    methode: 'get' as const,
    url: '/coffre/immich/dossier/11111111-2222-4333-8444-555555555555/thumbnail',
  },
  // La grille du catalogue (CC-227) : la page ET son endpoint de listing sont du contenu.
  { methode: 'get' as const, url: '/coffre/catalog' },
  { methode: 'get' as const, url: '/coffre/catalog/items' },
]

test.group('Coffre / le mur', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('⚠️ le middleware d’élévation est réellement branché sur les routes du contenu', ({
    assert,
  }) => {
    /**
     * ⚠️ **Ce test existe parce que les 403 ci-dessous ne le prouvaient PAS — mesuré, pas
     * supposé.** En retirant `middleware.coffreOuvert()` de `start/routes.ts`, les dix autres
     * tests de ce fichier restaient **verts** : `CoffreController.#key` lève lui aussi quand la
     * clé manque, et c'est ce garde-là qui rendait le 403. Deux mécanismes indépendants tiennent
     * donc le mur, ce qui est une bonne chose — mais aucun des deux n'était vérifié à l'unité, et
     * le middleware pouvait disparaître sans que rien ne rougisse.
     *
     * On lit ici le routeur, comme `capabilities_routes.spec.ts` lit `declarationOf` : c'est la
     * seule façon de dire *quel* mécanisme est en place, plutôt que *qu'un* refus arrive.
     */
    router.commit()
    const routes = router.toJSON().root ?? []

    const nomsSur = (pattern: string, methode: string) =>
      [
        ...(routes
          .find((route) => route.pattern === pattern && route.methods.includes(methode))
          ?.middleware.all() ?? []),
      ]
        .filter((one) => typeof one !== 'function' && 'name' in one && one.name)
        .map((one) => (one as { name: string }).name)

    assert.include(nomsSur('/coffre', 'GET'), 'coffreOuvert')
    // ⚠️ CC-208 : mesuré à l'identique aux autres — retirer cette route du mur ne fait rougir
    // QUE cette assertion-là, le contrôleur levant lui aussi sans clé de session.
    assert.include(nomsSur('/coffre/:section', 'GET'), 'coffreOuvert')
    assert.include(nomsSur('/coffre', 'POST'), 'coffreOuvert')
    // ⚠️ CC-186 : une édition rechiffre, elle n'a pas le droit d'être une exception au mur.
    assert.include(nomsSur('/coffre/:id', 'PUT'), 'coffreOuvert')
    assert.include(nomsSur('/coffre/:id', 'DELETE'), 'coffreOuvert')
    // ⚠️ CC-179 : celle-ci rend un mot de passe en clair. Le 403 du contrôleur la couvrirait de
    // toute façon — raison de plus pour asserter le middleware ici, où c'est le mécanisme qui se
    // lit, et pas seulement le refus qui s'observe.
    assert.include(nomsSur('/coffre/:id/secret', 'GET'), 'coffreOuvert')
    // ⚠️ CC-180 : mesuré à l'identique — retirer cette route du mur ne fait rougir QUE cette
    // assertion-là, le contrôleur rendant lui aussi un 403 sans clé de session.
    assert.include(nomsSur('/coffre/media/:id/thumbnail', 'GET'), 'coffreOuvert')
    // ⚠️ CC-181 : même mesure — le contrôleur lève lui aussi sans clé de session.
    assert.include(nomsSur('/coffre/nas/:id/stream', 'GET'), 'coffreOuvert')
    // ⚠️ CC-228 : même mesure — le contrôleur lève lui aussi sans clé de session.
    assert.include(nomsSur('/coffre/catalog/nas/:id/thumbnail', 'GET'), 'coffreOuvert')
    // ⚠️ CC-205 : même mesure — le contrôleur du dossier lève lui aussi sans clé de session.
    assert.include(nomsSur('/coffre/immich/dossier', 'GET'), 'coffreOuvert')
    assert.include(nomsSur('/coffre/immich/dossier/:assetId/thumbnail', 'GET'), 'coffreOuvert')
    // ⚠️ CC-227 : même mesure — le contrôleur lève lui aussi sans clé de session.
    assert.include(nomsSur('/coffre/catalog', 'GET'), 'coffreOuvert')
    assert.include(nomsSur('/coffre/catalog/items', 'GET'), 'coffreOuvert')

    // ⚠️ Et la porte ne doit PAS le porter : sinon il faudrait avoir ouvert le coffre pour
    // atteindre l'écran qui l'ouvre. Sans cette moitié, poser le middleware partout passerait
    // au vert tout en rendant le module inaccessible.
    assert.notInclude(nomsSur('/coffre/ouvrir', 'GET'), 'coffreOuvert')
    assert.notInclude(nomsSur('/coffre/ouvrir', 'POST'), 'coffreOuvert')
    assert.notInclude(nomsSur('/coffre/creation', 'POST'), 'coffreOuvert')
  })

  for (const { methode, url } of ROUTES_MUREES) {
    test(`${methode.toUpperCase()} ${url} répond 403 sans élévation, cookie valide compris`, async ({
      client,
    }) => {
      const user = await createUserWith(['coffre.view', 'coffre.write'])
      await createVault(user)

      const response = await client[methode](url)
        .loginAs(user)
        .withSession(lockedSession())
        .withCsrfToken()
        .redirects(0)

      response.assertStatus(403)
    })
  }

  test('avec l’élévation, la même session lit le coffre', async ({ client }) => {
    // ⚠️ Le pendant obligatoire des trois refus ci-dessus : sans lui, un mur qui refuserait
    // **tout le monde, toujours** passerait au vert en n'ayant rien prouvé.
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)

    const response = await client
      .get('/coffre')
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))
      .withInertia()

    response.assertStatus(200)
    response.assertInertiaComponent('modules/coffre/index')
  })

  test('l’élévation expire : la même route repasse à 403', async ({ client }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)

    // Le marqueur est daté au-delà de la borne — le trousseau, lui, porte encore la clé. C'est
    // donc bien l'expiration du marqueur qui ferme, et non une clé purgée par ailleurs.
    const keyId = keyring.open(user.id, deriveKey(PASSPHRASE, vault.kdfSalt))
    const perime = unlockMarkerFor(
      user.id,
      keyId,
      DateTime.now().minus({ minutes: VAULT_UNLOCK_MINUTES + 1 })
    )

    const response = await client
      .get('/coffre')
      .loginAs(user)
      .withSession({
        [LOGIN_STAMP_KEY]: DateTime.now().minus({ hours: 1 }).toISO(),
        [VAULT_UNLOCK_KEY]: perime,
      })
      .redirects(0)

    response.assertStatus(403)
  })

  test('le marqueur d’un autre compte n’ouvre rien', async ({ client }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const autre = await createUserWith(['coffre.view'])

    // La session d'`autre`, portant le marqueur de `user`.
    const response = await client
      .get('/coffre')
      .loginAs(autre)
      .withSession(await unlockedSession(user, vault))
      .redirects(0)

    response.assertStatus(403)
  })

  test('⚠️ une session révoquée n’atteint jamais le coffre — elle est expulsée avant', async ({
    client,
  }) => {
    // Le piège que ce lot devait mesurer plutôt que supposer (CC-176) : `AuthMiddleware` tranche
    // **avant** le middleware du coffre, donc une session révoquée n'arrive pas jusqu'au mur.
    // Ce qui suit prouve la redirection vers `/login`, pas un 403 — les deux sont des refus,
    // mais seul le premier dit que la session est morte en amont.
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const session = await unlockedSession(user, vault)

    await revokeSessions(user)

    const response = await client.get('/coffre').loginAs(user).withSession(session).redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/login')
  })

  test('la porte, elle, reste atteignable sans élévation', async ({ client }) => {
    // Sinon le coffre serait un cercle : il faudrait l'avoir ouvert pour atteindre l'écran
    // qui l'ouvre. C'est la raison qui met `/reglages` sous `openRoute()` (CC-114).
    const user = await createUserWith(['coffre.view'])
    await createVault(user)

    const response = await client
      .get('/coffre/ouvrir')
      .loginAs(user)
      .withSession(lockedSession())
      .withInertia()

    response.assertStatus(200)
    response.assertInertiaComponent('modules/coffre/ouvrir')
  })

  test('un compte sans capacité est fermé par l’autre étage, même coffre ouvert', async ({
    client,
  }) => {
    // ⚠️ Les deux étages, jamais l'un sans l'autre : l'élévation prouve *qui vient de le prouver*,
    // pas *qui a le droit*. Un coffre ouvert ne doit rien ouvrir à qui n'a pas la capacité.
    const proprietaire = await createUserWith(['coffre.view'])
    const vault = await createVault(proprietaire)
    const sansDroit = await createUserWith([])

    const response = await client
      .get('/coffre')
      .loginAs(sansDroit)
      .withSession(await unlockedSession(proprietaire, vault))
      .redirects(0)

    response.assertStatus(403)
  })

  test('coffre.view ne suffit pas à écrire', async ({ client }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)

    const response = await client
      .post('/coffre')
      .form({ type: 'note', title: 'Test', content: 'Contenu' })
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(403)
  })
})
