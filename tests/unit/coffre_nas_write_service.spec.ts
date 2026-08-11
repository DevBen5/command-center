import { test } from '@japa/runner'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import NasRootsService from '#modules/coffre/services/nas_roots_service'
import {
  deleteNasFile,
  moveNasFile,
  renameNasFile,
  uploadNasFile,
} from '#modules/coffre/services/nas_write_service'

/**
 * L'écriture sur le NAS (CC-240), contre un VRAI filesystem — même doctrine que
 * `coffre_nas_roots.spec.ts`/`coffre_nas_folder_browser.spec.ts` : rien n'est mocké, c'est le
 * comportement réel de `link()`/`realpath()` qu'on prouve, pas une hypothèse dessus.
 *
 * Disposition des fixtures, un dossier temporaire par test :
 *
 *   <tmp>/root/photos/existant.jpg    — un fichier légitime, dans la racine
 *   <tmp>/root/albums/                — un second dossier, dans la même racine
 *   <tmp>/second/                     — une SECONDE racine autorisée
 *   <tmp>/dehors/                     — hors de toute racine
 */
test.group('Coffre / écriture NAS', (group) => {
  let dossier: string
  let racine: string
  let seconde: string

  group.each.setup(async () => {
    dossier = await mkdtemp(join(tmpdir(), 'cc-nas-write-'))
    racine = join(dossier, 'root')
    seconde = join(dossier, 'second')

    await mkdir(join(racine, 'photos'), { recursive: true })
    await mkdir(join(racine, 'albums'), { recursive: true })
    await mkdir(seconde, { recursive: true })
    await writeFile(join(racine, 'photos', 'existant.jpg'), 'contenu-existant')

    const dehors = join(dossier, 'dehors')
    await mkdir(dehors, { recursive: true })
    await writeFile(join(dehors, 'secret.jpg'), 'contenu-hors-racine')
    await symlink(dehors, join(racine, 'echappe'), 'dir')

    return () => rm(dossier, { recursive: true, force: true })
  })

  function roots(): NasRootsService {
    return new NasRootsService([
      { name: 'root', path: racine },
      { name: 'second', path: seconde },
    ])
  }

  async function tmpFile(content: string): Promise<string> {
    const path = join(dossier, `source-${Math.random().toString(16).slice(2)}.tmp`)
    await writeFile(path, content)
    return path
  }

  // ---------------------------------------------------------------------------------------
  // Envoi
  // ---------------------------------------------------------------------------------------

  test('un envoi légitime écrit le fichier avec le bon contenu', async ({ assert }) => {
    const source = await tmpFile('contenu-envoye')

    const result = await uploadNasFile(roots(), 'root', 'photos', 'nouveau.jpg', source)

    assert.deepEqual(result, { status: 'ok' })
    assert.equal(await readFile(join(racine, 'photos', 'nouveau.jpg'), 'utf-8'), 'contenu-envoye')
  })

  test('⚠️ un envoi ne laisse AUCUN fichier temporaire dans le dossier', async ({ assert }) => {
    const source = await tmpFile('contenu')
    await uploadNasFile(roots(), 'root', 'photos', 'propre.jpg', source)

    const noms = await readdir(join(racine, 'photos'))
    assert.isFalse(noms.some((nom) => nom.startsWith('.uploading-')))
  })

  test('⚠️ un nom de fichier invalide est refusé AVANT tout accès disque', async ({ assert }) => {
    const source = await tmpFile('contenu')

    const result = await uploadNasFile(roots(), 'root', 'photos', '../evasion.jpg', source)

    assert.deepEqual(result, { status: 'bad-name' })
    const noms = await readdir(join(racine, 'photos'))
    assert.deepEqual(noms.sort(), ['existant.jpg'])
  })

  test('un envoi vers un dossier inexistant est refusé', async ({ assert }) => {
    const source = await tmpFile('contenu')

    const result = await uploadNasFile(roots(), 'root', 'jamais-cree', 'x.jpg', source)

    assert.deepEqual(result, { status: 'not-found' })
  })

  test('⚠️ un envoi ne traverse pas un dossier remplacé par un lien sortant', async ({
    assert,
  }) => {
    const source = await tmpFile('contenu')

    const result = await uploadNasFile(roots(), 'root', 'echappe', 'x.jpg', source)

    assert.deepEqual(result, { status: 'not-found' })
    const dehors = await readdir(join(dossier, 'dehors'))
    assert.isFalse(dehors.includes('x.jpg'))
  })

  test('⚠️ un envoi vers un nom déjà pris ne détruit RIEN et ne laisse aucun résidu', async ({
    assert,
  }) => {
    // Le nom est déjà pris par un DOSSIER — la collision la plus dure à manquer : `link()` doit
    // échouer sans jamais toucher à ce dossier ni laisser le fichier temporaire derrière lui.
    await mkdir(join(racine, 'photos', 'piege.jpg'), { recursive: true })
    const source = await tmpFile('contenu')

    const result = await uploadNasFile(roots(), 'root', 'photos', 'piege.jpg', source)

    assert.equal(result.status, 'name-taken')
    const noms = await readdir(join(racine, 'photos'))
    assert.isFalse(noms.some((nom) => nom.startsWith('.uploading-')))
    // Le dossier-piège existe toujours, intact, en tant que dossier.
    assert.include(noms, 'piege.jpg')
  })

  test('un second envoi du même nom refuse et préserve le contenu du premier', async ({
    assert,
  }) => {
    const premier = await tmpFile('premier-contenu')
    await uploadNasFile(roots(), 'root', 'photos', 'unique.jpg', premier)

    const second = await tmpFile('second-contenu-different')
    const result = await uploadNasFile(roots(), 'root', 'photos', 'unique.jpg', second)

    assert.equal(result.status, 'name-taken')
    assert.equal(await readFile(join(racine, 'photos', 'unique.jpg'), 'utf-8'), 'premier-contenu')
  })

  test('⚠️ une source introuvable ne laisse aucun résidu', async ({ assert }) => {
    const result = await uploadNasFile(
      roots(),
      'root',
      'photos',
      'jamais-cree.jpg',
      join(dossier, 'n-existe-pas.tmp')
    )

    assert.deepEqual(result, { status: 'not-found' })
    const noms = await readdir(join(racine, 'photos'))
    assert.deepEqual(noms.sort(), ['existant.jpg'])
  })

  // ---------------------------------------------------------------------------------------
  // Renommer
  // ---------------------------------------------------------------------------------------

  test('un renommage légitime déplace le contenu sous le nouveau nom', async ({ assert }) => {
    const result = await renameNasFile(roots(), 'root', 'photos/existant.jpg', 'renomme.jpg')

    assert.deepEqual(result, { status: 'ok' })
    assert.equal(await readFile(join(racine, 'photos', 'renomme.jpg'), 'utf-8'), 'contenu-existant')
    const noms = await readdir(join(racine, 'photos'))
    assert.notInclude(noms, 'existant.jpg')
  })

  test('⚠️ renommer vers un nom déjà pris ne détruit pas le fichier existant', async ({
    assert,
  }) => {
    await writeFile(join(racine, 'photos', 'cible.jpg'), 'contenu-cible')

    const result = await renameNasFile(roots(), 'root', 'photos/existant.jpg', 'cible.jpg')

    assert.equal(result.status, 'name-taken')
    assert.equal(await readFile(join(racine, 'photos', 'cible.jpg'), 'utf-8'), 'contenu-cible')
    assert.equal(
      await readFile(join(racine, 'photos', 'existant.jpg'), 'utf-8'),
      'contenu-existant'
    )
  })

  test('renommer une entrée introuvable est refusé', async ({ assert }) => {
    const result = await renameNasFile(roots(), 'root', 'photos/absent.jpg', 'x.jpg')

    assert.deepEqual(result, { status: 'not-found' })
  })

  test('⚠️ renommer un DOSSIER est refusé — hors périmètre de ce lot', async ({ assert }) => {
    const result = await renameNasFile(roots(), 'root', 'albums', 'renomme')

    assert.deepEqual(result, { status: 'not-found' })
  })

  test('⚠️ une traversée dans le chemin source est refusée', async ({ assert }) => {
    const result = await renameNasFile(roots(), 'root', '../dehors/secret.jpg', 'x.jpg')

    assert.deepEqual(result, { status: 'not-found' })
  })

  test('⚠️ un nouveau nom invalide est refusé, le fichier source reste en place', async ({
    assert,
  }) => {
    const result = await renameNasFile(roots(), 'root', 'photos/existant.jpg', 'CON')

    assert.deepEqual(result, { status: 'bad-name' })
    const noms = await readdir(join(racine, 'photos'))
    assert.isTrue(noms.includes('existant.jpg'))
  })

  // ---------------------------------------------------------------------------------------
  // Déplacer
  // ---------------------------------------------------------------------------------------

  test('un déplacement légitime change de dossier en gardant le nom', async ({ assert }) => {
    const result = await moveNasFile(roots(), 'root', 'photos/existant.jpg', 'root', 'albums')

    assert.deepEqual(result, { status: 'ok' })
    assert.equal(
      await readFile(join(racine, 'albums', 'existant.jpg'), 'utf-8'),
      'contenu-existant'
    )
    assert.notInclude(await readdir(join(racine, 'photos')), 'existant.jpg')
  })

  test('⚠️ un déplacement ENTRE DEUX RACINES est refusé, jamais simulé', async ({ assert }) => {
    const result = await moveNasFile(roots(), 'root', 'photos/existant.jpg', 'second', '')

    assert.deepEqual(result, { status: 'cross-root' })
    // Le fichier n'a pas bougé : ni copié dans la seconde racine, ni supprimé de la première.
    assert.equal(
      await readFile(join(racine, 'photos', 'existant.jpg'), 'utf-8'),
      'contenu-existant'
    )
    assert.deepEqual(await readdir(seconde), [])
  })

  test('un déplacement vers un dossier de destination inexistant est refusé', async ({
    assert,
  }) => {
    const result = await moveNasFile(roots(), 'root', 'photos/existant.jpg', 'root', 'jamais-cree')

    assert.deepEqual(result, { status: 'not-found' })
  })

  test('⚠️ déplacer vers un nom déjà pris ne détruit rien', async ({ assert }) => {
    await writeFile(join(racine, 'albums', 'existant.jpg'), 'contenu-different')

    const result = await moveNasFile(roots(), 'root', 'photos/existant.jpg', 'root', 'albums')

    assert.equal(result.status, 'name-taken')
    assert.equal(
      await readFile(join(racine, 'albums', 'existant.jpg'), 'utf-8'),
      'contenu-different'
    )
    assert.equal(
      await readFile(join(racine, 'photos', 'existant.jpg'), 'utf-8'),
      'contenu-existant'
    )
  })

  // ---------------------------------------------------------------------------------------
  // Supprimer
  // ---------------------------------------------------------------------------------------

  test('une suppression légitime efface réellement le fichier', async ({ assert }) => {
    const result = await deleteNasFile(roots(), 'root', 'photos/existant.jpg')

    assert.deepEqual(result, { status: 'ok' })
    assert.notInclude(await readdir(join(racine, 'photos')), 'existant.jpg')
  })

  test('supprimer une entrée introuvable est refusé', async ({ assert }) => {
    const result = await deleteNasFile(roots(), 'root', 'photos/absent.jpg')

    assert.deepEqual(result, { status: 'not-found' })
  })

  test('⚠️ supprimer un DOSSIER est refusé', async ({ assert }) => {
    const result = await deleteNasFile(roots(), 'root', 'albums')

    assert.deepEqual(result, { status: 'not-found' })
    // Le dossier existe toujours.
    await readdir(join(racine, 'albums'))
  })

  test('⚠️ une traversée est refusée à la suppression', async ({ assert }) => {
    const result = await deleteNasFile(roots(), 'root', '../dehors/secret.jpg')

    assert.deepEqual(result, { status: 'not-found' })
    const dehors = await readdir(join(dossier, 'dehors'))
    assert.isTrue(dehors.includes('secret.jpg'))
  })

  test('⚠️ un chemin qui traverse un lien symbolique sortant est refusé', async ({ assert }) => {
    const result = await deleteNasFile(roots(), 'root', 'echappe/secret.jpg')

    assert.deepEqual(result, { status: 'not-found' })
    const dehors = await readdir(join(dossier, 'dehors'))
    assert.isTrue(dehors.includes('secret.jpg'))
  })
})
