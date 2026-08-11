import { test } from '@japa/runner'
import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import NasRootsService from '#modules/coffre/services/nas_roots_service'
import { createUserWith } from '#tests/helpers/users'
import { createVault, unlockedSession } from '#tests/helpers/coffre'

/**
 * La navigation par dossier NAS (CC-239) — `GET /coffre/nas/browse` et `GET /coffre/nas/thumbnail`.
 * Le mur (élévation requise) se prouve dans `coffre_wall.spec.ts`, pas ici — même répartition que
 * les autres proxies du module.
 *
 * ⚠️ **`NasRootsService` est substitué par une vraie racine de fixtures**, même doctrine que
 * `coffre_nas.spec.ts` : la configuration par défaut est vide en test.
 */
const FIXTURES = fileURLToPath(new URL('../../fixtures/', import.meta.url))

async function runMagick(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile('magick', args, (error) => (error ? reject(error) : resolve()))
  })
}

test.group('Coffre / la navigation par dossier NAS', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(async () => {
    await limiter.clear(['memory'])
    return () => limiter.clear(['memory'])
  })

  let dossier: string
  let racine: string

  group.each.setup(async () => {
    dossier = await mkdtemp(join(tmpdir(), 'cc-nas-browse-http-'))
    racine = join(dossier, 'root')
    await mkdir(join(racine, 'photos'), { recursive: true })
    await writeFile(join(racine, 'photos', 'exemple.jpg'), 'contenu-photo')

    const dehors = join(dossier, 'dehors')
    await mkdir(dehors, { recursive: true })
    await writeFile(join(dehors, 'secret.jpg'), 'contenu-hors-racine')
    await symlink(join(dehors, 'secret.jpg'), join(racine, 'echappe.jpg'), 'file')

    app.container.swap(NasRootsService, () => new NasRootsService([{ name: 'root', path: racine }]))

    return async () => {
      app.container.restore(NasRootsService)
      await rm(dossier, { recursive: true, force: true })
    }
  })

  test('la page-coquille se rend, sans donnée en prop', async ({ client }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)

    const response = await client
      .get('/coffre/nas')
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))
      .withInertia()

    response.assertStatus(200)
    response.assertInertiaComponent('modules/coffre/nas')
  })

  test('sans `root`, la liste des racines déclarées est rendue', async ({ client, assert }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)

    const response = await client
      .get('/coffre/nas/browse')
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(200)
    assert.deepEqual(response.body(), { level: 'roots', roots: [{ name: 'root' }] })
  })

  test('avec `root`, le contenu du dossier est rendu — dossiers puis fichiers', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)

    const response = await client
      .get('/coffre/nas/browse?root=root')
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(200)
    const body = response.body() as { level: string; entries: { name: string; kind: string }[] }
    assert.equal(body.level, 'folder')
    const photos = body.entries.find((entry) => entry.name === 'photos')
    assert.equal(photos?.kind, 'dir')
  })

  test('naviguer dans un sous-dossier rend son contenu', async ({ client, assert }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)

    const response = await client
      .get('/coffre/nas/browse?root=root&path=photos')
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(200)
    const body = response.body() as { entries: { name: string; kind: string; path: string }[] }
    assert.deepEqual(
      body.entries.map((entry) => [entry.name, entry.kind, entry.path]),
      [['exemple.jpg', 'photo', 'photos/exemple.jpg']]
    )
  })

  test('⚠️ une traversée (`../`) rend 404', async ({ client }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)

    const response = await client
      .get('/coffre/nas/browse?root=root&path=../dehors')
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(404)
  })

  test('⚠️ un chemin absolu rend 404', async ({ client }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)

    const response = await client
      .get(`/coffre/nas/browse?root=root&path=${encodeURIComponent(join(dossier, 'dehors'))}`)
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(404)
  })

  test('⚠️ un lien symbolique posé DANS la racine et pointant DEHORS n’apparaît jamais, et son chemin propre rend 404', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const session = await unlockedSession(user, vault)

    const listing = await client
      .get('/coffre/nas/browse?root=root')
      .loginAs(user)
      .withSession(session)
    const body = listing.body() as { entries: { name: string }[] }
    assert.notInclude(
      body.entries.map((entry) => entry.name),
      'echappe.jpg'
    )

    const direct = await client
      .get('/coffre/nas/browse?root=root&path=echappe.jpg')
      .loginAs(user)
      .withSession(session)
    direct.assertStatus(404)
  })

  test('⚠️ un identifiant de racine inconnu rend 404', async ({ client }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)

    const response = await client
      .get('/coffre/nas/browse?root=inconnue')
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(404)
  })

  test('⚠️ un dossier ajouté sur le disque apparaît SANS resynchronisation — preuve de la lecture directe', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const session = await unlockedSession(user, vault)

    const avant = await client
      .get('/coffre/nas/browse?root=root')
      .loginAs(user)
      .withSession(session)
    const nomsAvant = (avant.body() as { entries: { name: string }[] }).entries.map((e) => e.name)
    assert.notInclude(nomsAvant, 'videos')

    await mkdir(join(racine, 'videos'), { recursive: true })

    const apres = await client
      .get('/coffre/nas/browse?root=root')
      .loginAs(user)
      .withSession(session)
    const nomsApres = (apres.body() as { entries: { name: string }[] }).entries.map((e) => e.name)
    assert.include(nomsApres, 'videos')
  })

  test('⚠️ un fichier ABSENT du catalogue apparaît quand même en navigation — aucune ligne créée dans ce test', async ({
    client,
    assert,
  }) => {
    // ⚠️ Ce test ne crée AUCUNE ligne `coffre_catalog_items` : si la navigation lisait la table
    // plutôt que le disque, `photos/exemple.jpg` (posé par le décor, jamais synchronisé) serait
    // invisible. C'est ce qui distingue cette route d'une lecture SQL.
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)

    const response = await client
      .get('/coffre/nas/browse?root=root&path=photos')
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    const body = response.body() as { entries: { name: string }[] }
    assert.include(
      body.entries.map((entry) => entry.name),
      'exemple.jpg'
    )
  })

  test('au-delà du seuil, la navigation répond 429 — throttle dédié, jamais celui du catalogue', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const session = await unlockedSession(user, vault)

    let dernierStatut = 200
    for (let i = 0; i < 61; i++) {
      const response = await client
        .get('/coffre/nas/browse?root=root')
        .loginAs(user)
        .withSession(session)
      dernierStatut = response.status()
    }
    assert.equal(dernierStatut, 429)

    // ⚠️ La grille du catalogue, elle, n'est PAS affectée : compteur séparé (`nas_browse_<id>`
    // contre `catalog_browse_<id>`) — sans ce préfixe distinct, les deux écrans se bloqueraient
    // mutuellement.
    const catalogue = await client
      .get('/coffre/catalog/items')
      .loginAs(user)
      .withSession(session)
      .header('accept', 'application/json')
    catalogue.assertStatus(200)
  })

  test('une photo réelle rend une vignette JPEG, sans en-tête de cache', async ({
    client,
    assert,
  }) => {
    await runMagick(['-size', '64x64', 'xc:blue', `JPEG:${join(racine, 'photos', 'reelle.jpg')}`])

    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)

    const response = await client
      .get('/coffre/nas/thumbnail?root=root&path=photos/reelle.jpg')
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(200)
    response.assertHeader('content-type', 'image/jpeg')
    response.assertHeader('cache-control', 'no-store')
    const corps = response.body() as Buffer
    assert.equal(corps[0], 0xff)
    assert.equal(corps[1], 0xd8)
  })

  test('un HEIC réel (fixture commitée) rend aussi une vignette JPEG', async ({
    client,
    assert,
  }) => {
    await copyFile(
      join(FIXTURES, 'coffre_nas_thumbnail.heic'),
      join(racine, 'photos', 'photo.heic')
    )

    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)

    const response = await client
      .get('/coffre/nas/thumbnail?root=root&path=photos/photo.heic')
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(200)
    response.assertHeader('content-type', 'image/jpeg')
    const corps = response.body() as Buffer
    assert.equal(corps[0], 0xff)
    assert.equal(corps[1], 0xd8)
  })

  test('un chemin qui ne résout sous aucune racine rend 404, jamais une 500', async ({
    client,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)

    const response = await client
      .get('/coffre/nas/thumbnail?root=root&path=photos/absent.jpg')
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(404)
  })

  test('un fichier corrompu rend 404, jamais une 500', async ({ client }) => {
    await writeFile(join(racine, 'photos', 'corrompu.jpg'), 'ceci ne décode pas comme un JPEG')

    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)

    const response = await client
      .get('/coffre/nas/thumbnail?root=root&path=photos/corrompu.jpg')
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(404)
  })

  test('un chemin de vignette hostile (traversée) rend 404', async ({ client }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)

    const response = await client
      .get('/coffre/nas/thumbnail?root=root&path=../dehors/secret.jpg')
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(404)
  })
})
