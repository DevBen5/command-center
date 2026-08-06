import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import navigation from '#core/shared/navigation/registry'
import capabilities from '#core/auth/capabilities/registry'
import enabledModules, { migrationPathsFor } from '#config/modules'
import { createUserWith } from '#tests/helpers/users'
import { createVault, unlockedSession } from '#tests/helpers/coffre'

/**
 * Le rideau (CC-178) : le module existe, il est **activé** dans cette suite, et il n'apparaît
 * nulle part dans l'interface.
 *
 * ⚠️ **C'est bien parce qu'il est activé que ce fichier prouve quelque chose.** Sur un module
 * éteint, l'absence de destination serait une conséquence de `MODULES`, pas du rideau — et
 * l'assertion passerait au vert même si `start/navigation.ts` enregistrait une entrée `/coffre`.
 * `.env.test` active tous les modules connus (`modules_config.spec.ts` le tient), c'est donc bien
 * la décision de ne rien enregistrer qui est mesurée ici.
 *
 * ⚠️ **Suite `functional`, jamais `unit`** — même raison que `navigation_registry.spec.ts` : le
 * registre n'est peuplé que par le preload `#start/navigation`, au démarrage du serveur HTTP. En
 * unit il serait vide et tout passerait au vert sans rien avoir comparé.
 */
test.group('Coffre / le rideau', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('le module est bien activé dans cette suite — sinon rien de ce qui suit ne prouve rien', ({
    assert,
  }) => {
    // Le plancher de ce fichier, sur le modèle de `tests_index.spec.ts` : une garde qui peut
    // réussir à vide n'en est pas une.
    assert.isTrue(enabledModules.has('coffre'))
    assert.include(migrationPathsFor(enabledModules), 'app/modules/coffre/migrations')
  })

  test('aucune destination /coffre n’est enregistrée', ({ assert }) => {
    const coffres = navigation.all().filter((destination) => destination.href.startsWith('/coffre'))

    assert.deepEqual(
      coffres,
      [],
      'Une destination « coffre » est apparue : le module redeviendrait visible dans la barre ' +
        'latérale, le fil d’Ariane ET la palette ⌘K, qui dérivent tous les trois de ce registre.'
    )
  })

  test('la barre latérale d’un compte au coffre ouvert ne montre rien du coffre', async ({
    client,
    assert,
  }) => {
    // ⚠️ La preuve vue depuis le navigateur, et pas seulement depuis le registre : `destinations`
    // est une prop partagée (`config/inertia.ts`), c'est elle que `AppLayout` affiche et que la
    // palette ⌘K filtre. Un compte **dans** son coffre ne doit pas voir apparaître d'entrée.
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)

    const response = await client
      .get('/coffre')
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))
      .withInertia()

    response.assertStatus(200)

    const props = response.inertiaProps as { destinations: Array<{ key: string; href: string }> }

    assert.isArray(props.destinations, 'la prop partagée « destinations » a disparu')
    assert.notInclude(
      props.destinations.map((destination) => destination.href),
      '/coffre'
    )
  })

  test('les capacités, elles, SONT au registre — le rideau ne concerne que la navigation', ({
    assert,
  }) => {
    // ⚠️ La confusion à ne pas faire : `start/capabilities.ts` enregistre bien le coffre. Sans
    // ça, ses routes citeraient des capacités inconnues — donc fermées à tout non-admin, sans
    // que `is_admin` s'en aperçoive. `capabilities_routes.spec.ts` l'attrape aussi ; ici on le
    // dit à côté du rideau, là où le raccourci « invisible = non enregistré » se prendrait.
    assert.isTrue(capabilities.has('coffre.view'))
    assert.isTrue(capabilities.has('coffre.write'))
  })
})
