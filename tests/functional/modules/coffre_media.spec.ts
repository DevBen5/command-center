import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import ImmichClient from '#core/shared/services/immich_client'
import FakeImmichClient from '#tests/fakes/fake_immich_client'
import { createUserWith } from '#tests/helpers/users'
import { createVault, createMedia, unlockedSession, PASSPHRASE } from '#tests/helpers/coffre'
import CoffreEntry from '#modules/coffre/models/coffre_entry'
import { deriveKey } from '#modules/coffre/services/vault_crypto'

/**
 * Le proxy de vignette du coffre (CC-180).
 *
 * ⚠️ **Le refus des `content-type` en repli HTML d'Immich n'est PAS re-testé ici.** C'est
 * `ImmichClient.thumbnail()` — partagé avec la veille, `tests/unit/veille_immich_client.spec.ts`
 * — qui le prouve contre un `fetch` mocké. `FakeImmichClient` remplace la couche API tout entière,
 * comme pour la veille : ce qui se prouve ici, c'est ce que le CONTRÔLEUR du coffre fait d'un
 * succès et d'un échec de cette couche, pas le transport lui-même.
 */
const ASSET_ID = '11111111-2222-4333-8444-555555555555'

test.group('Coffre / le proxy de vignette Immich', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.teardown(() => app.container.restore(ImmichClient))

  test('une vignette connue rend l’image, sans cache, avec le bon content-type', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const entry = await CoffreEntry.create({
      ownerId: user.id,
      type: 'note',
      titleCipher: 'x',
      contentCipher: 'x',
    })
    const key = deriveKey(PASSPHRASE, vault.kdfSalt)
    const media = await createMedia(entry.id, user.id, key, ASSET_ID)

    app.container.swap(
      ImmichClient,
      () =>
        new FakeImmichClient([
          {
            id: ASSET_ID,
            type: 'image',
            fileName: 'photo.jpg',
            takenAt: null,
            durationSeconds: null,
            network: null,
          },
        ])
    )

    const response = await client
      .get(`/coffre/media/${media.id}/thumbnail`)
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(200)
    response.assertHeader('content-type', 'image/webp')
    response.assertHeader('cache-control', 'no-store')
    response.assertHeader('pragma', 'no-cache')
    assert.equal(response.body().toString(), 'faux-webp')
  })

  test('un média inconnu rend 404', async ({ client }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)

    const response = await client
      .get('/coffre/media/999999/thumbnail')
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(404)
  })

  test('le média d’un autre compte rend 404, jamais la vignette', async ({ client }) => {
    const proprietaire = await createUserWith(['coffre.view'])
    const vaultProprietaire = await createVault(proprietaire)
    const entry = await CoffreEntry.create({
      ownerId: proprietaire.id,
      type: 'note',
      titleCipher: 'x',
      contentCipher: 'x',
    })
    const key = deriveKey(PASSPHRASE, vaultProprietaire.kdfSalt)
    const media = await createMedia(entry.id, proprietaire.id, key, ASSET_ID)

    const intrus = await createUserWith(['coffre.view'])
    const vaultIntrus = await createVault(intrus, 'autre-passphrase-de-test')

    const response = await client
      .get(`/coffre/media/${media.id}/thumbnail`)
      .loginAs(intrus)
      .withSession(await unlockedSession(intrus, vaultIntrus, 'autre-passphrase-de-test'))

    response.assertStatus(404)
  })

  test('une panne Immich rend 404, jamais une erreur brute', async ({ client }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const entry = await CoffreEntry.create({
      ownerId: user.id,
      type: 'note',
      titleCipher: 'x',
      contentCipher: 'x',
    })
    const key = deriveKey(PASSPHRASE, vault.kdfSalt)
    // ⚠️ Aucun asset scripté : `FakeImmichClient.thumbnail` lève, comme un asset supprimé ou une
    // instance éteinte — le proxy doit absorber ça en 404, pas laisser passer une 500.
    const media = await createMedia(entry.id, user.id, key, ASSET_ID)

    app.container.swap(ImmichClient, () => new FakeImmichClient([]))

    const response = await client
      .get(`/coffre/media/${media.id}/thumbnail`)
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(404)
  })
})
