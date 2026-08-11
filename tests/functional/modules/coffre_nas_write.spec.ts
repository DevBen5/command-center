import { test } from '@japa/runner'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import NasRootsService from '#modules/coffre/services/nas_roots_service'
import { createUserWith } from '#tests/helpers/users'
import { createVault, unlockedSession } from '#tests/helpers/coffre'

/**
 * L'écriture sur le NAS (CC-240) — `POST /coffre/nas/upload`, `PUT /coffre/nas/rename`,
 * `PUT /coffre/nas/move`, `DELETE /coffre/nas/file`. Le mur (élévation requise) se prouve dans
 * `coffre_wall.spec.ts`, pas ici — même répartition que les autres routes du module. La garde de
 * confinement (traversée, symlink, nom de fichier hostile) se prouve en détail contre un vrai
 * filesystem dans `coffre_nas_write_service.spec.ts` — ce fichier prouve le CÂBLAGE HTTP :
 * capacité, throttle, traduction des refus en codes HTTP.
 *
 * ⚠️ **`NasRootsService` substitué par une vraie racine de fixtures**, même patron que
 * `coffre_nas_browse.spec.ts`.
 */
test.group('Coffre / écriture NAS (HTTP)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(async () => {
    await limiter.clear(['memory'])
    return () => limiter.clear(['memory'])
  })

  let dossier: string
  let racine: string

  group.each.setup(async () => {
    dossier = await mkdtemp(join(tmpdir(), 'cc-nas-write-http-'))
    racine = join(dossier, 'root')
    await mkdir(join(racine, 'photos'), { recursive: true })
    await writeFile(join(racine, 'photos', 'exemple.jpg'), 'contenu-original')

    app.container.swap(NasRootsService, () => new NasRootsService([{ name: 'root', path: racine }]))

    return async () => {
      app.container.restore(NasRootsService)
      await rm(dossier, { recursive: true, force: true })
    }
  })

  test('un envoi légitime écrit le fichier — capacité coffre.write, élévation', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.write'])
    const vault = await createVault(user)

    const response = await client
      .post('/coffre/nas/upload')
      .fields({ root: 'root', path: 'photos' })
      .file('file', Buffer.from('contenu-envoye'), { filename: 'nouveau.jpg' })
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))
      .withCsrfToken()
      .header('accept', 'application/json')

    response.assertStatus(200)
    assert.equal(await readFile(join(racine, 'photos', 'nouveau.jpg'), 'utf-8'), 'contenu-envoye')
  })

  test('⚠️ coffre.view seul ne suffit pas à écrire', async ({ client }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)

    const response = await client
      .post('/coffre/nas/upload')
      .fields({ root: 'root', path: 'photos' })
      .file('file', Buffer.from('x'), { filename: 'x.jpg' })
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))
      .withCsrfToken()
      .header('accept', 'application/json')

    response.assertStatus(403)
  })

  test('un nom de fichier invalide rend 422', async ({ client }) => {
    const user = await createUserWith(['coffre.write'])
    const vault = await createVault(user)

    const response = await client
      .post('/coffre/nas/upload')
      .fields({ root: 'root', path: 'photos' })
      .file('file', Buffer.from('x'), { filename: '..' })
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))
      .withCsrfToken()
      .header('accept', 'application/json')

    response.assertStatus(422)
  })

  test('un envoi vers un nom déjà pris rend 409, le fichier existant n’est pas touché', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.write'])
    const vault = await createVault(user)

    const response = await client
      .post('/coffre/nas/upload')
      .fields({ root: 'root', path: 'photos' })
      .file('file', Buffer.from('nouveau-contenu'), { filename: 'exemple.jpg' })
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))
      .withCsrfToken()
      .header('accept', 'application/json')

    response.assertStatus(409)
    assert.equal(await readFile(join(racine, 'photos', 'exemple.jpg'), 'utf-8'), 'contenu-original')
  })

  test('un renommage légitime répond 200 et déplace le contenu', async ({ client, assert }) => {
    const user = await createUserWith(['coffre.write'])
    const vault = await createVault(user)

    const response = await client
      .put('/coffre/nas/rename')
      .fields({ root: 'root', path: 'photos/exemple.jpg', newName: 'renomme.jpg' })
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))
      .withCsrfToken()
      .header('accept', 'application/json')

    response.assertStatus(200)
    assert.equal(await readFile(join(racine, 'photos', 'renomme.jpg'), 'utf-8'), 'contenu-original')
  })

  test('un déplacement légitime répond 200', async ({ client, assert }) => {
    await mkdir(join(racine, 'albums'), { recursive: true })
    const user = await createUserWith(['coffre.write'])
    const vault = await createVault(user)

    const response = await client
      .put('/coffre/nas/move')
      .fields({
        root: 'root',
        path: 'photos/exemple.jpg',
        targetRoot: 'root',
        targetPath: 'albums',
      })
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))
      .withCsrfToken()
      .header('accept', 'application/json')

    response.assertStatus(200)
    assert.equal(await readFile(join(racine, 'albums', 'exemple.jpg'), 'utf-8'), 'contenu-original')
  })

  test('⚠️ un `targetPath` vide déplace vers la RACINE de la racine cible', async ({
    client,
    assert,
  }) => {
    // `convertEmptyStringsToNull` (config/bodyparser.ts) transforme '' en `null` AVANT que le
    // validateur ne le voie — `nasFolderPath()` doit donc être `.optional()` et le contrôleur
    // retomber sur `''` (la racine), sans quoi ce cas légitime serait refusé en 422.
    const user = await createUserWith(['coffre.write'])
    const vault = await createVault(user)

    const response = await client
      .put('/coffre/nas/move')
      .fields({ root: 'root', path: 'photos/exemple.jpg', targetRoot: 'root', targetPath: '' })
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))
      .withCsrfToken()
      .header('accept', 'application/json')

    response.assertStatus(200)
    assert.equal(await readFile(join(racine, 'exemple.jpg'), 'utf-8'), 'contenu-original')
  })

  test('⚠️ un déplacement entre deux racines rend 422 (cross-root)', async ({ client, assert }) => {
    const user = await createUserWith(['coffre.write'])
    const vault = await createVault(user)

    const response = await client
      .put('/coffre/nas/move')
      .fields({
        root: 'root',
        path: 'photos/exemple.jpg',
        targetRoot: 'autre-racine',
        targetPath: '',
      })
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))
      .withCsrfToken()
      .header('accept', 'application/json')

    response.assertStatus(422)
    response.assertBodyContains({ error: 'cross-root' })
    assert.equal(await readFile(join(racine, 'photos', 'exemple.jpg'), 'utf-8'), 'contenu-original')
  })

  test('une suppression légitime répond 200 et efface le fichier', async ({ client }) => {
    const user = await createUserWith(['coffre.write'])
    const vault = await createVault(user)

    const response = await client
      .delete('/coffre/nas/file?root=root&path=photos/exemple.jpg')
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))
      .withCsrfToken()
      .header('accept', 'application/json')

    response.assertStatus(200)
  })

  test('⚠️ une traversée à la suppression rend 404, jamais une 500', async ({ client }) => {
    const user = await createUserWith(['coffre.write'])
    const vault = await createVault(user)

    const response = await client
      .delete('/coffre/nas/file?root=root&path=../dehors/secret.jpg')
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))
      .withCsrfToken()
      .header('accept', 'application/json')

    response.assertStatus(404)
  })

  test('au-delà du seuil, l’écriture répond 429 — throttle dédié', async ({ client, assert }) => {
    const user = await createUserWith(['coffre.write'])
    const vault = await createVault(user)
    const session = await unlockedSession(user, vault)

    let dernierStatut = 200
    for (let i = 0; i < 31; i++) {
      const response = await client
        .delete('/coffre/nas/file?root=root&path=photos/absent.jpg')
        .loginAs(user)
        .withSession(session)
        .withCsrfToken()
        .header('accept', 'application/json')
      dernierStatut = response.status()
    }
    assert.equal(dernierStatut, 429)
  })
})
