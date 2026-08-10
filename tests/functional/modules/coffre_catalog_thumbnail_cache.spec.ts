import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { createUserWith } from '#tests/helpers/users'
import { createVault, createCatalogItem, PASSPHRASE } from '#tests/helpers/coffre'
import { deriveKey } from '#modules/coffre/services/vault_crypto'
import catalogThumbnailCache from '#modules/coffre/services/catalog_thumbnail_cache'

/**
 * Le cache de vignettes du catalogue NAS (CC-228) — chiffré par la clé du coffre. Contre une vraie
 * base, comme `coffre_storage.spec.ts` : ce que la base porte vraiment ne se prouve pas en
 * mockant Lucid.
 */
const OCTETS = Buffer.from('contenu-de-vignette-jpeg-simule')

test.group('Coffre / le cache de vignettes du catalogue NAS', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('un aller-retour rend exactement les mêmes octets et le bon content-type', async ({
    assert,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const key = deriveKey(PASSPHRASE, vault.kdfSalt)
    const item = await createCatalogItem(user.id)

    await catalogThumbnailCache.put(item.id, user.id, key, {
      bytes: OCTETS,
      contentType: 'image/jpeg',
    })

    const cached = await catalogThumbnailCache.get(item.id, user.id, key)

    assert.isNotNull(cached)
    assert.isTrue(OCTETS.equals(cached!.bytes))
    assert.equal(cached!.contentType, 'image/jpeg')
  })

  test('la colonne brute ne porte ni le clair ni le clair en base64 — assertion sur les octets', async ({
    assert,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const key = deriveKey(PASSPHRASE, vault.kdfSalt)
    const item = await createCatalogItem(user.id)

    await catalogThumbnailCache.put(item.id, user.id, key, {
      bytes: OCTETS,
      contentType: 'image/jpeg',
    })

    const ligne = await db.rawQuery(
      'select content_cipher from coffre_catalog_thumbnails where catalog_item_id = ?',
      [item.id]
    )

    const brut = ligne.rows[0].content_cipher as string
    assert.notInclude(brut, OCTETS.toString('utf8'))
    assert.notInclude(brut, OCTETS.toString('base64'))
  })

  test('un second appel après cache régénère si le chiffré est illisible — traité comme une absence, pas un refus', async ({
    assert,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const key = deriveKey(PASSPHRASE, vault.kdfSalt)
    const item = await createCatalogItem(user.id)

    await catalogThumbnailCache.put(item.id, user.id, key, {
      bytes: OCTETS,
      contentType: 'image/jpeg',
    })

    // Une autre clé — simule un chiffré illisible (mauvaise clé, ligne altérée).
    const autreClef = deriveKey('autre-passphrase-de-test', vault.kdfSalt)
    const cached = await catalogThumbnailCache.get(item.id, user.id, autreClef)

    assert.isNull(cached)
  })

  test('regénérer pour le même élément REMPLACE la ligne, n’en ajoute pas une seconde', async ({
    assert,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const key = deriveKey(PASSPHRASE, vault.kdfSalt)
    const item = await createCatalogItem(user.id)

    await catalogThumbnailCache.put(item.id, user.id, key, {
      bytes: OCTETS,
      contentType: 'image/jpeg',
    })
    const nouveauxOctets = Buffer.from('contenu-different')
    await catalogThumbnailCache.put(item.id, user.id, key, {
      bytes: nouveauxOctets,
      contentType: 'image/jpeg',
    })

    const lignes = await db.rawQuery(
      'select id from coffre_catalog_thumbnails where catalog_item_id = ?',
      [item.id]
    )
    assert.lengthOf(lignes.rows, 1)

    const cached = await catalogThumbnailCache.get(item.id, user.id, key)
    assert.isTrue(nouveauxOctets.equals(cached!.bytes))
  })

  test('aucune ligne en cache rend null, jamais une exception', async ({ assert }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const key = deriveKey(PASSPHRASE, vault.kdfSalt)
    const item = await createCatalogItem(user.id)

    const cached = await catalogThumbnailCache.get(item.id, user.id, key)

    assert.isNull(cached)
  })
})
