import { test } from '@japa/runner'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import NasRootsService from '#modules/coffre/services/nas_roots_service'
import NasCatalogSource from '#modules/coffre/services/nas_catalog_source'
import type {
  CatalogEnumeration,
  CatalogSource,
  CatalogThumbnail,
} from '#modules/coffre/services/catalog_source'
import { createUserWith } from '#tests/helpers/users'
import { createVault, createCatalogItem, unlockedSession } from '#tests/helpers/coffre'

/**
 * La route de vignette du catalogue NAS (CC-228) — `GET /coffre/catalog/nas/:id/thumbnail`. Le
 * mur (élévation requise) se prouve dans `coffre_wall.spec.ts`, pas ici — même répartition que les
 * deux autres proxies du module.
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

/** Un `CatalogSource` factice, pour prouver le cache SANS dépendre du binaire réel. */
class CountingCatalogSource implements CatalogSource {
  readonly key = 'nas' as const
  callCount = 0

  async enumerate(): Promise<CatalogEnumeration> {
    return { items: [], truncated: false }
  }

  async thumbnailFor(): Promise<CatalogThumbnail> {
    this.callCount++
    return { bytes: Buffer.from('vignette-simulee'), contentType: 'image/jpeg' }
  }
}

test.group('Coffre / la vignette du catalogue NAS', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  let dossier: string
  let racine: string

  group.each.setup(async () => {
    dossier = await mkdtemp(join(tmpdir(), 'cc-nas-catalog-thumb-'))
    racine = join(dossier, 'root')
    await mkdir(racine, { recursive: true })
    await runMagick(['-size', '64x64', 'xc:red', `JPEG:${join(racine, 'photo.jpg')}`])
    await writeFile(join(racine, 'corrompu.jpg'), 'ceci ne décode pas comme un JPEG')

    app.container.swap(NasRootsService, () => new NasRootsService([{ name: 'root', path: racine }]))

    return async () => {
      app.container.restore(NasRootsService)
      await rm(dossier, { recursive: true, force: true })
    }
  })

  test('une photo réelle rend une vignette JPEG avec le bon content-type', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const item = await createCatalogItem(user.id, { reference: 'root/photo.jpg' })

    const response = await client
      .get(`/coffre/catalog/nas/${item.id}/thumbnail`)
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(200)
    response.assertHeader('content-type', 'image/jpeg')
    response.assertHeader('cache-control', 'no-store')
    response.assertHeader('pragma', 'no-cache')
    const corps = response.body() as Buffer
    assert.equal(corps[0], 0xff)
    assert.equal(corps[1], 0xd8)
  })

  test('un HEIC réel (fixture commitée) rend aussi une vignette JPEG', async ({
    client,
    assert,
  }) => {
    await copyFile(join(FIXTURES, 'coffre_nas_thumbnail.heic'), join(racine, 'photo.heic'))

    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const item = await createCatalogItem(user.id, { reference: 'root/photo.heic' })

    const response = await client
      .get(`/coffre/catalog/nas/${item.id}/thumbnail`)
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(200)
    response.assertHeader('content-type', 'image/jpeg')
    const corps = response.body() as Buffer
    assert.equal(corps[0], 0xff)
    assert.equal(corps[1], 0xd8)
  })

  test('un second appel sert le cache, sans régénérer', async ({ client, assert }) => {
    const fake = new CountingCatalogSource()
    app.container.swap(NasCatalogSource, () => fake as unknown as NasCatalogSource)

    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const item = await createCatalogItem(user.id, { reference: 'root/photo.jpg' })
    const session = await unlockedSession(user, vault)

    const premier = await client
      .get(`/coffre/catalog/nas/${item.id}/thumbnail`)
      .loginAs(user)
      .withSession(session)
    const second = await client
      .get(`/coffre/catalog/nas/${item.id}/thumbnail`)
      .loginAs(user)
      .withSession(session)

    premier.assertStatus(200)
    second.assertStatus(200)
    assert.equal(fake.callCount, 1)

    app.container.restore(NasCatalogSource)
  })

  test('un élément de catalogue inconnu rend 404', async ({ client }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)

    const response = await client
      .get('/coffre/catalog/nas/999999/thumbnail')
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(404)
  })

  test('l’élément d’un autre compte rend 404, jamais la vignette', async ({ client }) => {
    const proprietaire = await createUserWith(['coffre.view'])
    const item = await createCatalogItem(proprietaire.id, { reference: 'root/photo.jpg' })

    const intrus = await createUserWith(['coffre.view'])
    const vaultIntrus = await createVault(intrus, 'autre-passphrase-de-test')

    const response = await client
      .get(`/coffre/catalog/nas/${item.id}/thumbnail`)
      .loginAs(intrus)
      .withSession(await unlockedSession(intrus, vaultIntrus, 'autre-passphrase-de-test'))

    response.assertStatus(404)
  })

  test('un élément dont la source n’est PAS le NAS (immich_locked) rend 404 sur cette route', async ({
    client,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const item = await createCatalogItem(user.id, {
      source: 'immich_locked',
      reference: '11111111-2222-4333-8444-555555555555',
    })

    const response = await client
      .get(`/coffre/catalog/nas/${item.id}/thumbnail`)
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(404)
  })

  test('un fichier corrompu rend 404, jamais une 500', async ({ client }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const item = await createCatalogItem(user.id, { reference: 'root/corrompu.jpg' })

    const response = await client
      .get(`/coffre/catalog/nas/${item.id}/thumbnail`)
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(404)
  })

  test('une référence qui ne résout sous aucune racine autorisée rend 404', async ({ client }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const item = await createCatalogItem(user.id, { reference: 'root/disparu.jpg' })

    const response = await client
      .get(`/coffre/catalog/nas/${item.id}/thumbnail`)
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(404)
  })
})
