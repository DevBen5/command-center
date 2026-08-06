import { test } from '@japa/runner'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import NasRootsService from '#modules/coffre/services/nas_roots_service'
import { createUserWith } from '#tests/helpers/users'
import { createVault, createNasFile, unlockedSession, PASSPHRASE } from '#tests/helpers/coffre'
import CoffreEntry from '#modules/coffre/models/coffre_entry'
import { deriveKey } from '#modules/coffre/services/vault_crypto'

/**
 * Le proxy de streaming de médias NAS du coffre — photos et vidéos (CC-181).
 *
 * ⚠️ **`NasRootsService` est substitué par une vraie racine de fixtures**, jamais un chemin du
 * poste : la configuration par défaut est vide en test (`config/coffre_nas.ts`), donc sans ce
 * remplacement tout média rendrait 404 par construction, ce qui ne prouverait rien.
 */
const CONTENU_VIDEO = 'x'.repeat(1000) // taille connue, pour vérifier des plages précises
const CONTENU_PHOTO = 'y'.repeat(200)

test.group('Coffre / le proxy de streaming de médias NAS', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  let dossier: string
  let racine: string

  group.each.setup(async () => {
    dossier = await mkdtemp(join(tmpdir(), 'cc-nas-stream-'))
    racine = join(dossier, 'root')
    await mkdir(join(racine, 'films'), { recursive: true })
    await mkdir(join(racine, 'photos'), { recursive: true })
    await writeFile(join(racine, 'films', 'exemple.mp4'), CONTENU_VIDEO)
    await writeFile(join(racine, 'photos', 'exemple.jpg'), CONTENU_PHOTO)
    // ⚠️ Un DOSSIER dont le nom porte une extension autorisée : `realpath` y réussit et
    // l'allow-list le laisse passer. Voir le test du même nom plus bas.
    await mkdir(join(racine, 'pieges', 'album.jpg'), { recursive: true })

    app.container.swap(NasRootsService, () => new NasRootsService([racine]))

    return async () => {
      app.container.restore(NasRootsService)
      await rm(dossier, { recursive: true, force: true })
    }
  })

  test('une vidéo sans en-tête `Range` est servie entière avec les bons en-têtes', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const entree = await CoffreEntry.create({
      ownerId: user.id,
      type: 'note',
      titleCipher: 'x',
      contentCipher: 'x',
    })
    const key = deriveKey(PASSPHRASE, vault.kdfSalt)
    const video = await createNasFile(entree.id, user.id, key, 'films/exemple.mp4')

    const response = await client
      .get(`/coffre/nas/${video.id}/stream`)
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(200)
    response.assertHeader('content-type', 'video/mp4')
    response.assertHeader('cache-control', 'no-store')
    response.assertHeader('pragma', 'no-cache')
    response.assertHeader('accept-ranges', 'bytes')
    response.assertHeader('content-length', String(CONTENU_VIDEO.length))
    assert.equal(response.body().toString(), CONTENU_VIDEO)
  })

  test('avec un `Range` valide, seul le segment vidéo demandé est servi en 206', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const entree = await CoffreEntry.create({
      ownerId: user.id,
      type: 'note',
      titleCipher: 'x',
      contentCipher: 'x',
    })
    const key = deriveKey(PASSPHRASE, vault.kdfSalt)
    const video = await createNasFile(entree.id, user.id, key, 'films/exemple.mp4')

    const response = await client
      .get(`/coffre/nas/${video.id}/stream`)
      .header('range', 'bytes=0-9')
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(206)
    response.assertHeader('content-range', `bytes 0-9/${CONTENU_VIDEO.length}`)
    response.assertHeader('content-length', '10')
    assert.equal(response.body().toString(), CONTENU_VIDEO.slice(0, 10))
  })

  test('un `Range` hors bornes rend 416', async ({ client }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const entree = await CoffreEntry.create({
      ownerId: user.id,
      type: 'note',
      titleCipher: 'x',
      contentCipher: 'x',
    })
    const key = deriveKey(PASSPHRASE, vault.kdfSalt)
    const video = await createNasFile(entree.id, user.id, key, 'films/exemple.mp4')

    const response = await client
      .get(`/coffre/nas/${video.id}/stream`)
      .header('range', `bytes=${CONTENU_VIDEO.length}-${CONTENU_VIDEO.length + 10}`)
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(416)
    response.assertHeader('content-range', `bytes */${CONTENU_VIDEO.length}`)
  })

  test('une photo est servie entière, avec le bon content-type', async ({ client, assert }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const entree = await CoffreEntry.create({
      ownerId: user.id,
      type: 'note',
      titleCipher: 'x',
      contentCipher: 'x',
    })
    const key = deriveKey(PASSPHRASE, vault.kdfSalt)
    const photo = await createNasFile(entree.id, user.id, key, 'photos/exemple.jpg')

    const response = await client
      .get(`/coffre/nas/${photo.id}/stream`)
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(200)
    response.assertHeader('content-type', 'image/jpeg')
    response.assertHeader('cache-control', 'no-store')
    assert.equal(response.body().toString(), CONTENU_PHOTO)
  })

  test('un média inconnu rend 404', async ({ client }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)

    const response = await client
      .get('/coffre/nas/999999/stream')
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(404)
  })

  test('le média d’un autre compte rend 404, jamais le flux', async ({ client }) => {
    const proprietaire = await createUserWith(['coffre.view'])
    const vaultProprietaire = await createVault(proprietaire)
    const entree = await CoffreEntry.create({
      ownerId: proprietaire.id,
      type: 'note',
      titleCipher: 'x',
      contentCipher: 'x',
    })
    const key = deriveKey(PASSPHRASE, vaultProprietaire.kdfSalt)
    const video = await createNasFile(entree.id, proprietaire.id, key, 'films/exemple.mp4')

    const intrus = await createUserWith(['coffre.view'])
    const vaultIntrus = await createVault(intrus, 'autre-passphrase-de-test')

    const response = await client
      .get(`/coffre/nas/${video.id}/stream`)
      .loginAs(intrus)
      .withSession(await unlockedSession(intrus, vaultIntrus, 'autre-passphrase-de-test'))

    response.assertStatus(404)
  })

  test('un DOSSIER dont le nom porte une extension autorisée rend 404, jamais une 500', async ({
    client,
  }) => {
    // ⚠️ Le cas qui distingue une garde d'un décor : `realpath` réussit sur un dossier et
    // l'allow-list ne regarde qu'une extension, donc `pieges/album.jpg` traverse tout jusqu'au
    // `stat`. Sans la garde `isFile()`, `createReadStream` échouerait APRÈS l'envoi des en-têtes
    // et rendrait une 500 — un échec qui ne ressemblerait plus à tous les autres du module.
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const entree = await CoffreEntry.create({
      ownerId: user.id,
      type: 'note',
      titleCipher: 'x',
      contentCipher: 'x',
    })
    const key = deriveKey(PASSPHRASE, vault.kdfSalt)
    const piege = await createNasFile(entree.id, user.id, key, 'pieges/album.jpg')

    const response = await client
      .get(`/coffre/nas/${piege.id}/stream`)
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(404)
  })

  test('une référence qui ne résout sous aucune racine autorisée rend 404, jamais une erreur brute', async ({
    client,
  }) => {
    // ⚠️ Le fichier référencé n'existe pas sous la fixture — simule un chemin déplacé/supprimé
    // du NAS depuis la référence, ou une racine mal configurée. Le proxy doit absorber ça en
    // 404, pas laisser passer une 500.
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const entree = await CoffreEntry.create({
      ownerId: user.id,
      type: 'note',
      titleCipher: 'x',
      contentCipher: 'x',
    })
    const key = deriveKey(PASSPHRASE, vault.kdfSalt)
    const video = await createNasFile(entree.id, user.id, key, 'films/disparu.mp4')

    const response = await client
      .get(`/coffre/nas/${video.id}/stream`)
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(404)
  })
})
