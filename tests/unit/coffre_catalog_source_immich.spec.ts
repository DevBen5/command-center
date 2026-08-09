import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import ImmichLockedCatalogSource from '#modules/coffre/services/immich_locked_catalog_source'
import FakeImmichSessionClient from '#tests/fakes/fake_immich_session_client'

/**
 * L'implémentation Immich de l'abstraction `CatalogSource` (CC-225) — **pure côté mapping** :
 * substitue `ImmichSessionClient` par le faux du dossier verrouillé (CC-205), déjà utilisé par
 * `coffre_immich_folder.spec.ts` et `coffre_media.spec.ts`. Rien ici ne touche le réseau ; la
 * session/auth/pagination réelles se prouvent dans `coffre_immich_session_client.spec.ts`.
 */
test.group('Coffre / la source de catalogue Immich', () => {
  test('key vaut "immich_locked"', ({ assert }) => {
    const source = new ImmichLockedCatalogSource(new FakeImmichSessionClient())
    assert.equal(source.key, 'immich_locked')
  })

  test('enumerate() traduit les assets Immich vers CatalogSourceItem', async ({ assert }) => {
    const capturedAt = DateTime.fromISO('2026-06-01T10:00:00.000Z')
    const fake = new FakeImmichSessionClient()
    fake.setCatalog({
      assets: [
        {
          assetId: '11111111-2222-4333-8444-555555555555',
          nature: 'photo',
          displayName: 'plage.jpg',
          capturedAt,
          sizeBytes: 2048,
        },
      ],
      truncated: false,
    })

    const { items, truncated } = await new ImmichLockedCatalogSource(fake).enumerate()

    assert.isFalse(truncated)
    assert.deepEqual(items, [
      {
        reference: '11111111-2222-4333-8444-555555555555',
        nature: 'photo',
        displayName: 'plage.jpg',
        capturedAt,
        sizeBytes: 2048,
      },
    ])
  })

  test('enumerate() propage `truncated`', async ({ assert }) => {
    const fake = new FakeImmichSessionClient()
    fake.setCatalog({ assets: [], truncated: true })

    const { truncated } = await new ImmichLockedCatalogSource(fake).enumerate()

    assert.isTrue(truncated)
  })

  test('enumerate() ne rattrape pas une panne : elle remonte telle quelle', async ({ assert }) => {
    const fake = new FakeImmichSessionClient()
    fake.setCatalog(new Error('session Immich expirée'))

    await assert.rejects(
      () => new ImmichLockedCatalogSource(fake).enumerate(),
      /session Immich expirée/
    )
  })

  test('thumbnailFor() délègue au client de session', async ({ assert }) => {
    const assetId = '11111111-2222-4333-8444-555555555555'
    const fake = new FakeImmichSessionClient({
      photos: [{ assetId }],
      truncated: false,
    })

    const thumbnail = await new ImmichLockedCatalogSource(fake).thumbnailFor(assetId)

    assert.equal(thumbnail.contentType, 'image/webp')
    assert.deepEqual(fake.thumbnailed, [assetId])
  })
})
