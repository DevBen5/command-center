import { test } from '@japa/runner'
import { normalizeCoffreNasConfig } from '#config/coffre_nas'

/**
 * Le format `nom=chemin` de `COFFRE_NAS_ROOTS` (CC-233) — la garde de démarrage qui fait porter
 * à chaque racine l'identifiant qui entre dans les références du catalogue. L'isolation en test
 * (aucun vrai dossier du poste pendant `npm test`) est prouvée à part, dans
 * `tests/unit/env_isolation.spec.ts`.
 */
test.group('Coffre / configuration des racines NAS', () => {
  test('une racine unique se parse en { name, path }', ({ assert }) => {
    const config = normalizeCoffreNasConfig({ roots: 'photos=D:\\Medias\\command-center' })

    assert.deepEqual(config.roots, [{ name: 'photos', path: 'D:\\Medias\\command-center' }])
  })

  test('plusieurs racines, dans l’ordre déclaré', ({ assert }) => {
    const config = normalizeCoffreNasConfig({
      roots: 'photos=D:\\Medias\\photos,videos=D:\\Medias\\videos',
    })

    assert.deepEqual(config.roots, [
      { name: 'photos', path: 'D:\\Medias\\photos' },
      { name: 'videos', path: 'D:\\Medias\\videos' },
    ])
  })

  test('absente ou vide : aucune racine', ({ assert }) => {
    assert.deepEqual(normalizeCoffreNasConfig({}).roots, [])
    assert.deepEqual(normalizeCoffreNasConfig({ roots: '' }).roots, [])
    assert.deepEqual(normalizeCoffreNasConfig({ roots: '   ' }).roots, [])
  })

  test('les blancs autour du nom, du chemin et entre les racines sont retirés', ({ assert }) => {
    const config = normalizeCoffreNasConfig({
      roots: '  photos = D:\\Medias\\photos  ,  videos=D:\\Medias\\videos  ',
    })

    assert.deepEqual(config.roots, [
      { name: 'photos', path: 'D:\\Medias\\photos' },
      { name: 'videos', path: 'D:\\Medias\\videos' },
    ])
  })

  test('⚠️ une racine sans `nom=` fait ÉCHOUER LE DÉMARRAGE, le message nomme le remède', ({
    assert,
  }) => {
    assert.throws(
      () => normalizeCoffreNasConfig({ roots: 'D:\\Medias\\command-center' }),
      /COFFRE_NAS_ROOTS.*identifiant.*nom=chemin/s
    )
  })

  test('⚠️ un identifiant vide (`=chemin`) échoue aussi', ({ assert }) => {
    assert.throws(
      () => normalizeCoffreNasConfig({ roots: '=D:\\Medias\\command-center' }),
      /identifiant vide/
    )
  })

  test('⚠️ un identifiant portant un `/` échoue — il entre dans une référence', ({ assert }) => {
    assert.throws(
      () => normalizeCoffreNasConfig({ roots: 'photos/nas=D:\\Medias\\command-center' }),
      /ne peut pas contenir de « \/ »/
    )
  })

  test('⚠️ deux racines de même identifiant échouent — il sert de clé', ({ assert }) => {
    assert.throws(
      () =>
        normalizeCoffreNasConfig({
          roots: 'photos=D:\\Medias\\a,photos=D:\\Medias\\b',
        }),
      /déclaré plusieurs fois/
    )
  })

  test('un chemin qui contient lui-même un `=` reste intact après le premier séparateur', ({
    assert,
  }) => {
    // ⚠️ Le séparateur est le PREMIER `=` de l'entrée — un chemin exotique portant un `=` ne
    // casse donc pas le parsing, il finit simplement dans `path`.
    const config = normalizeCoffreNasConfig({ roots: 'photos=/mnt/a=b/photos' })

    assert.deepEqual(config.roots, [{ name: 'photos', path: '/mnt/a=b/photos' }])
  })
})
