import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import ImmichSessionClient from '#modules/coffre/services/immich_session_client'
import FakeImmichSessionClient from '#tests/fakes/fake_immich_session_client'
import { createUserWith } from '#tests/helpers/users'
import { createVault, unlockedSession } from '#tests/helpers/coffre'

/**
 * Le dossier verrouillé d'Immich (CC-205) : listing et vignette.
 *
 * ⚠️ **Le mur (élévation requise) se prouve dans `coffre_wall.spec.ts`**, pas ici — même
 * répartition que les deux autres proxies du module. Ce qui se prouve ici : ce que le contrôleur
 * fait d'un succès et d'un échec de `ImmichSessionClient`, jamais le transport lui-même (couvert
 * par `tests/unit/coffre_immich_session_client.spec.ts`).
 */
const ASSET_ID = '11111111-2222-4333-8444-555555555555'
const OTHER_ASSET_ID = 'c1d2e3f4-5a6b-4c8d-9e0f-1a2b3c4d5e6f'

test.group('Coffre / le dossier verrouillé Immich', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.teardown(() => app.container.restore(ImmichSessionClient))

  test('liste les photos du dossier verrouillé, sans cache', async ({ client }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)

    app.container.swap(
      ImmichSessionClient,
      () =>
        new FakeImmichSessionClient({
          photos: [{ assetId: ASSET_ID }, { assetId: OTHER_ASSET_ID }],
          truncated: false,
        })
    )

    const response = await client
      .get('/coffre/immich/dossier')
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(200)
    response.assertHeader('cache-control', 'no-store')
    response.assertBodyContains({
      available: true,
      truncated: false,
      photos: [{ assetId: ASSET_ID }, { assetId: OTHER_ASSET_ID }],
    })
  })

  test('une panne de la session rend `available: false`, jamais une erreur brute', async ({
    client,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)

    app.container.swap(
      ImmichSessionClient,
      () => new FakeImmichSessionClient(new Error('Immich (session) est injoignable.'))
    )

    const response = await client
      .get('/coffre/immich/dossier')
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(200)
    response.assertBodyContains({ available: false, truncated: false, photos: [] })
  })

  test('sert la vignette d’une photo connue', async ({ client, assert }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)

    app.container.swap(
      ImmichSessionClient,
      () => new FakeImmichSessionClient({ photos: [{ assetId: ASSET_ID }], truncated: false })
    )

    const response = await client
      .get(`/coffre/immich/dossier/${ASSET_ID}/thumbnail`)
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(200)
    response.assertHeader('content-type', 'image/webp')
    response.assertHeader('cache-control', 'no-store')
    assert.equal(response.body().toString(), 'faux-webp-session')
  })

  test('un identifiant qui n’est pas un UUID Immich rend 404 sans appeler le client', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)

    const fake = new FakeImmichSessionClient({ photos: [], truncated: false })
    app.container.swap(ImmichSessionClient, () => fake)

    const response = await client
      .get('/coffre/immich/dossier/pas-un-uuid/thumbnail')
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(404)
    assert.lengthOf(fake.thumbnailed, 0)
  })

  test('une vignette inconnue du client rend 404, jamais une erreur brute', async ({ client }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)

    app.container.swap(
      ImmichSessionClient,
      () => new FakeImmichSessionClient({ photos: [], truncated: false })
    )

    const response = await client
      .get(`/coffre/immich/dossier/${ASSET_ID}/thumbnail`)
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(404)
  })
})
