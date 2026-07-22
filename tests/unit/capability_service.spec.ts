import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import capabilityService from '#core/auth/services/capability_service'
import registry from '#core/auth/capabilities/registry'
import UserCapability from '#core/auth/models/user_capability'
import { createAdmin, createUserWith, createUserWithoutAccess } from '#tests/helpers/users'

test.group('Core / résolution des capacités', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  /**
   * ⚠️ **LE test de l'invariant, et il faut le lire comme tel.**
   *
   * On donne à un compte **toutes** les capacités qui existent au moment où son rôle est
   * créé — la situation d'un utilisateur à qui on a « tout ouvert ». Puis un module arrive,
   * comme il en arrivera dans six mois, et déclare les siennes.
   *
   * Ses capacités sont refusées, et **aucune ligne de ce test ne les a interdites**. C'est
   * la propriété entière du modèle : l'oubli va vers le refus. Un modèle par exclusion
   * aurait l'inverse — chaque module ajouté ouvrirait une porte à ce compte, et il faudrait
   * penser à la refermer à chaque fois.
   */
  test('un module apparu plus tard est refusé sans que rien ne l’ait interdit', async ({
    assert,
    cleanup,
  }) => {
    const toutCeQuiExiste = registry.all()
    const utilisateur = await createUserWith(toutCeQuiExiste)

    // Le registre est un singleton partagé par toute la campagne : sans cette remise en
    // état, le module fictif survivrait à ce test et apparaîtrait dans le catalogue de
    // l'écran d'administration des suites suivantes.
    const reel = registry.byModule()
    cleanup(() => {
      registry.reset()
      for (const { module, capabilities } of reel) registry.register(module, capabilities)
    })

    // Le module fictif n'existait pas quand le rôle a été composé.
    registry.register('fictif', ['fictif.lire', 'fictif.ecrire'])

    assert.isFalse(await capabilityService.allows(utilisateur, 'fictif.lire'))
    assert.isFalse(await capabilityService.allows(utilisateur, 'fictif.ecrire'))

    // Et ce qu'il avait déjà n'a pas bougé : le refus est ciblé, pas un effondrement.
    for (const capability of toutCeQuiExiste) {
      assert.isTrue(await capabilityService.allows(utilisateur, capability))
    }
  })

  test('une capacité qui n’existe nulle part est refusée', async ({ assert }) => {
    const utilisateur = await createUserWith(registry.all())

    assert.isFalse(await capabilityService.allows(utilisateur, 'inexistant.action'))
  })

  test('is_admin passe, y compris sur une capacité qu’aucun rôle ne porte', async ({ assert }) => {
    const admin = await createAdmin()

    assert.isTrue(await capabilityService.allows(admin, 'leitner.settings'))
    assert.isTrue(await capabilityService.allows(admin, 'jamais.declaree'))

    // ⚠️ Mais un admin n'a pas « toutes les capacités » : il passe outre la vérification.
    // La distinction compte — sinon il faudrait matérialiser la liste de tout quelque part,
    // et la tenir à jour à chaque ajout.
    assert.isEmpty([...(await capabilityService.capabilitiesOf(admin))])
  })

  test('un compte sans rôle ni surcharge n’a rien', async ({ assert }) => {
    const utilisateur = await createUserWithoutAccess()

    assert.isEmpty([...(await capabilityService.capabilitiesOf(utilisateur))])
    assert.isFalse(await capabilityService.allows(utilisateur, 'dashboard.view'))
  })

  test('la surcharge l’emporte sur le rôle, dans les deux sens', async ({ assert }) => {
    const utilisateur = await createUserWith(['leitner.view'])

    await UserCapability.create({
      userId: utilisateur.id,
      capability: 'leitner.view',
      granted: false,
    })
    await UserCapability.create({
      userId: utilisateur.id,
      capability: 'veille.view',
      granted: true,
    })

    assert.isFalse(await capabilityService.allows(utilisateur, 'leitner.view'))
    assert.isTrue(await capabilityService.allows(utilisateur, 'veille.view'))
  })

  test('un compte désactivé perd tout, même ce que son rôle porte', async ({ assert }) => {
    const utilisateur = await createUserWith(['leitner.view'])
    utilisateur.isActive = false
    await utilisateur.save()

    assert.isFalse(await capabilityService.allows(utilisateur, 'leitner.view'))
  })

  test('un administrateur désactivé perd tout aussi', async ({ assert }) => {
    // L'ordre compte : la désactivation est vérifiée **avant** `is_admin`, sinon désactiver
    // un administrateur ne ferait rien du tout.
    const admin = await createAdmin()
    admin.isActive = false
    await admin.save()

    assert.isFalse(await capabilityService.allows(admin, 'leitner.view'))
  })
})

test.group('Core / registre des capacités', () => {
  test('refuse une capacité hors du module qui la déclare', ({ assert }) => {
    assert.throws(() => registry.register('leitner', ['services.restart']))
  })

  test('refuse un joker : l’accès total passe par is_admin, pas par une capacité', ({ assert }) => {
    assert.throws(() => registry.register('leitner', ['*']))
    assert.throws(() => registry.register('leitner', ['leitner.*']))
  })

  test('refuse une capacité sans module', ({ assert }) => {
    assert.throws(() => registry.register('leitner', ['leitner']))
  })
})
