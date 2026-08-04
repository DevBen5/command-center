import { test } from '@japa/runner'
import { readFileSync } from 'node:fs'
import testUtils from '@adonisjs/core/services/test_utils'
import { createUserWith } from '#tests/helpers/users'

/**
 * L'écran `/reglages` répond désormais à « quelle version tourne ? » sans shell (CC-151).
 *
 * ⚠️ `commit` est `null` ici, et c'est le point qui compte : aucun `.env` de test ne pose
 * `APP_COMMIT` (il n'existe que sur une image construite avec `--build-arg`), donc ce test
 * prouve le repli du cas développement — pas un cas d'erreur.
 */
test.group('Core / réglages — version affichée (CC-151)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('GET /reglages porte la version de package.json et aucun commit', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith([])
    const packageJson = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf-8')
    ) as { version: string }

    const response = await client.get('/reglages').loginAs(user).withInertia()

    response.assertStatus(200)
    const props = response.inertiaProps as Record<string, any>
    assert.equal(props.version, packageJson.version)
    assert.isNull(props.commit)
  })
})
