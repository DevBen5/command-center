import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import UserSeeder from '#core/auth/seeders/user_seeder'
import User from '#core/auth/models/user'
import Role from '#core/auth/models/role'

/**
 * Le seeder du compte propriétaire (CC-75).
 *
 * ⚠️ **Ne jamais restaurer la variable avec `undefined`.** `env.set(clé, undefined)` écrit
 * `process.env[clé] = undefined`, que Node convertit en la **chaîne** `'undefined'` — que
 * `env.get` relirait ensuite comme un mot de passe de onze caractères. La chaîne vide, elle,
 * est bien lue comme absente (`Env.schema.string.optional()` rend `undefined` sur toute valeur
 * falsy). C'est donc `''` qui remet le seeder dans son état « variable non renseignée ».
 */
const ABSENTE = ''
const OWNER_EMAIL = 'admin@bstenger.fr'

async function seed() {
  await new UserSeeder(db.connection()).run()
}

test.group('Core / seeder du compte propriétaire', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.teardown(() => env.set('ADMIN_PASSWORD', ABSENTE))

  test('sans ADMIN_PASSWORD, ne crée aucun compte', async ({ assert }) => {
    env.set('ADMIN_PASSWORD', ABSENTE)

    await seed()

    // Le cœur du ticket : une base neuve seedée ne donne accès à rien.
    assert.isNull(await User.findBy('email', OWNER_EMAIL))

    // ⚠️ Et le reste du seeder tourne quand même. Sans cette assertion, le test passerait
    // aussi bien sur un seeder qui ne ferait plus rien du tout — il ne prouverait alors pas
    // que l'absence de compte vient de la garde plutôt que d'un fichier cassé.
    assert.isNotNull(await Role.findBy('name', 'Lecteur'))
  })

  test('avec ADMIN_PASSWORD, crée un compte connectable avec ce mot de passe', async ({
    assert,
  }) => {
    env.set('ADMIN_PASSWORD', 'motdepasse-long-1')

    await seed()

    const owner = await User.findByOrFail('email', OWNER_EMAIL)
    assert.isTrue(owner.isAdmin)
    assert.isTrue(owner.isActive)

    // ⚠️ On va jusqu'à `verifyCredentials` : vérifier que la ligne existe ne dirait pas si le
    // mot de passe posé est bien celui de la variable. C'est la seule assertion qui distingue
    // « le compte est créé » de « le compte est utilisable par son propriétaire ».
    const connecte = await User.verifyCredentials(OWNER_EMAIL, 'motdepasse-long-1')
    assert.equal(connecte.id, owner.id)
  })

  test('un ADMIN_PASSWORD trop court arrête le seed sans créer de compte', async ({ assert }) => {
    env.set('ADMIN_PASSWORD', 'court')

    // Présente mais invalide : le seed échoue au lieu de poser un mot de passe que le
    // formulaire d'invitation (`minLength(12)`) aurait refusé.
    await assert.rejects(() => seed())

    assert.isNull(await User.findBy('email', OWNER_EMAIL))
  })

  test('relancé avec un nouveau mot de passe, il remplace l’ancien', async ({ assert }) => {
    // ⚠️ **La rotation, et c'est ce qui rend CC-75 vrai sur une base existante.** Une base
    // seedée avant le ticket porte encore le mot de passe publié dans le dépôt ; changer le
    // seeder ne l'en débarrasse pas. Seul un second passage le remplace.
    env.set('ADMIN_PASSWORD', 'motdepasse-long-1')
    await seed()

    env.set('ADMIN_PASSWORD', 'motdepasse-long-2')
    await seed()

    await assert.rejects(() => User.verifyCredentials(OWNER_EMAIL, 'motdepasse-long-1'))
    const connecte = await User.verifyCredentials(OWNER_EMAIL, 'motdepasse-long-2')
    assert.equal(connecte.email, OWNER_EMAIL)
  })
})
