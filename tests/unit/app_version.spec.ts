import { test } from '@japa/runner'
import { readAppVersion } from '#config/app_version'

/**
 * Ce que `/reglages` affiche pour répondre à « quelle version tourne ? » (CC-151), sans shell.
 */
test.group('Core / version affichée aux réglages (CC-151)', () => {
  test('lit la version depuis le JSON et transmet le commit tel quel', ({ assert }) => {
    const info = readAppVersion('{"version":"1.2.3"}', '17c9cc4')

    assert.equal(info.version, '1.2.3')
    assert.equal(info.commit, '17c9cc4')
  })

  test('un commit absent (développement, pas de build Docker) reste undefined', ({ assert }) => {
    const info = readAppVersion('{"version":"1.2.3"}', undefined)

    assert.equal(info.version, '1.2.3')
    assert.isUndefined(info.commit)
  })
})
