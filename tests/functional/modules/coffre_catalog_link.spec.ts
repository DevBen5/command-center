import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import testUtils from '@adonisjs/core/services/test_utils'
import app from '@adonisjs/core/services/app'
import { createUserWith } from '#tests/helpers/users'
import {
  createVault,
  createCatalogItem,
  createMedia,
  createNasFile,
  unlockedSession,
  PASSPHRASE,
} from '#tests/helpers/coffre'
import CoffreEntry from '#modules/coffre/models/coffre_entry'
import NasRootsService from '#modules/coffre/services/nas_roots_service'
import { deriveKey, encrypt } from '#modules/coffre/services/vault_crypto'

const RACINE = [{ name: 'root', path: '/inutilisee-aucun-acces-disque' }]

/**
 * Le lien catalogue ↔ entrée (CC-227) — dans les DEUX sens, calculé à la volée par
 * `CatalogLinkService`. ⚠️ **`entry_id` n'est JAMAIS écrit par ce lot** : ces tests le prouvent en
 * creux — aucune des deux directions ne passe par une colonne, seulement par un déchiffrement et
 * une comparaison de chaînes. Aucun accès disque n'est nécessaire : le matching ne resout jamais
 * un chemin réel, seule `NasRootsService.getRoots()` (une liste statique) est consultée.
 */
test.group('Coffre / le lien catalogue ↔ entrée', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(() => {
    app.container.swap(NasRootsService, () => new NasRootsService(RACINE))
    return () => app.container.restore(NasRootsService)
  })

  test('catalogue → entrée : un élément NAS rattaché porte le titre déchiffré de son entrée', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const key = deriveKey(PASSPHRASE, vault.kdfSalt)

    const entree = await CoffreEntry.create({
      ownerId: user.id,
      type: 'note',
      titleCipher: encrypt('Vacances 2026', key),
      contentCipher: encrypt('Un contenu', key),
    })
    await createNasFile(entree.id, user.id, key, 'photos/plage.jpg')

    // La référence de catalogue porte l'identifiant de racine (CC-233) — la pièce jointe, elle,
    // ne porte que le chemin nu (`path_cipher`). C'est ce raccord que `CatalogLinkService` fait.
    const rattache = await createCatalogItem(user.id, {
      reference: 'root/photos/plage.jpg',
      displayName: 'plage',
    })
    const nonRattache = await createCatalogItem(user.id, {
      reference: 'root/photos/foret.jpg',
      displayName: 'foret',
    })

    const response = await client
      .get('/coffre/catalog/items?sort=displayName')
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))
      .header('accept', 'application/json')

    response.assertStatus(200)
    const corps = response.body() as {
      items: Array<{
        id: number
        displayName: string
        linkedEntry: { id: number; type: string; title: string } | null
      }>
    }

    const item = corps.items.find((row) => row.id === rattache.id)
    assert.deepEqual(item?.linkedEntry, { id: entree.id, type: 'note', title: 'Vacances 2026' })

    const autre = corps.items.find((row) => row.id === nonRattache.id)
    assert.isNull(autre?.linkedEntry)
  })

  test('catalogue → entrée : un élément Immich rattaché fonctionne de la même façon', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const key = deriveKey(PASSPHRASE, vault.kdfSalt)

    const entree = await CoffreEntry.create({
      ownerId: user.id,
      type: 'note',
      titleCipher: encrypt('Anniversaire', key),
      contentCipher: encrypt('Un contenu', key),
    })
    const assetId = '11111111-2222-4333-8444-555555555555'
    await createMedia(entree.id, user.id, key, assetId)
    const item = await createCatalogItem(user.id, { source: 'immich_locked', reference: assetId })

    const response = await client
      .get('/coffre/catalog/items')
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))
      .header('accept', 'application/json')

    response.assertStatus(200)
    const corps = response.body() as {
      items: Array<{ id: number; linkedEntry: { id: number; title: string } | null }>
    }
    const ligne = corps.items.find((row) => row.id === item.id)
    assert.equal(ligne?.linkedEntry?.id, entree.id)
    assert.equal(ligne?.linkedEntry?.title, 'Anniversaire')
  })

  test('entrée → catalogue : la présence est annotée sur les chips déjà rendues, dans les deux états', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const key = deriveKey(PASSPHRASE, vault.kdfSalt)

    const entree = await CoffreEntry.create({
      ownerId: user.id,
      type: 'note',
      titleCipher: encrypt('Album photo', key),
      contentCipher: encrypt('Un contenu', key),
    })
    const present = await createNasFile(entree.id, user.id, key, 'photos/present.jpg')
    const absent = await createNasFile(entree.id, user.id, key, 'photos/inconnu.jpg')

    await createCatalogItem(user.id, {
      reference: 'root/photos/present.jpg',
      missingSince: DateTime.fromISO('2026-05-01'),
    })

    const response = await client
      .get('/coffre/photos')
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))
      .withInertia()

    response.assertStatus(200)
    const props = response.inertiaProps as {
      entries: Array<{
        id: number
        nasFiles: Array<{ id: number; inCatalog: boolean; missingSince: string | null }>
      }>
    }
    const ligne = props.entries.find((entry) => entry.id === entree.id)
    const fichierPresent = ligne?.nasFiles.find((file) => file.id === present.id)
    const fichierAbsent = ligne?.nasFiles.find((file) => file.id === absent.id)

    assert.isTrue(fichierPresent?.inCatalog)
    assert.isNotNull(fichierPresent?.missingSince)
    assert.isFalse(fichierAbsent?.inCatalog)
    assert.isNull(fichierAbsent?.missingSince ?? null)
  })
})
