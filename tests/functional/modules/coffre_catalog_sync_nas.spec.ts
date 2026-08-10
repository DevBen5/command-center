import { test } from '@japa/runner'
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import app from '@adonisjs/core/services/app'
import ace from '@adonisjs/core/services/ace'
import testUtils from '@adonisjs/core/services/test_utils'
import { createUserWith } from '#tests/helpers/users'
import { createVault } from '#tests/helpers/coffre'
import CoffreCatalogItem from '#modules/coffre/models/coffre_catalog_item'
import NasRootsService from '#modules/coffre/services/nas_roots_service'
import ImmichSessionClient from '#modules/coffre/services/immich_session_client'
import FakeImmichSessionClient from '#tests/fakes/fake_immich_session_client'
import CoffreSyncCatalog from '#commands/coffre_sync_catalog'

/**
 * La source NAS du catalogue (CC-226), bout-en-bout : `NasRootsService` substitué par une vraie
 * racine de fixtures (patron `coffre_nas.spec.ts`), la commande `coffre:sync-catalog` exécutée
 * réellement contre ce filesystem.
 *
 * ⚠️ **`ImmichSessionClient` est aussi substitué, par un faux qui réussit toujours (catalogue
 * vide).** La commande énumère TOUTES les sources enregistrées ; sans ce faux, la source Immich
 * — non configurée en test — échouerait et ferait sortir la commande en erreur (`exitCode = 1`),
 * contaminant les assertions `assertSucceeded()` qui ne portent que sur la source NAS.
 *
 * ⚠️ **Le test le plus important du lot** : une racine NAS absente fait échouer la commande sans
 * toucher au catalogue — c'est la garde qui protège d'un NAS momentanément démonté pris pour
 * « plus rien sur le NAS ».
 */
async function catalogRowsFor(ownerId: number) {
  return CoffreCatalogItem.query()
    .where('owner_id', ownerId)
    .where('source', 'nas')
    .orderBy('reference', 'asc')
}

async function runSync() {
  const command = await ace.create(CoffreSyncCatalog, [])
  await command.exec()
  return command
}

test.group('Coffre / la source NAS du catalogue', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.teardown(() => app.container.restore(NasRootsService))
  group.each.teardown(() => app.container.restore(ImmichSessionClient))

  group.each.setup(() => {
    app.container.swap(
      ImmichSessionClient,
      () =>
        new FakeImmichSessionClient(
          { photos: [], truncated: false },
          { assets: [], truncated: false }
        )
    )
  })

  group.each.setup(() => {
    // Sans ce mode, les messages de la commande partent à l'écran et rien ne permet de les lire.
    ace.ui.switchMode('raw')
    return () => ace.ui.switchMode('normal')
  })

  let dossier: string
  let racine: string

  group.each.setup(async () => {
    dossier = await mkdtemp(join(tmpdir(), 'cc-nas-catalog-sync-'))
    racine = join(dossier, 'root')
    await mkdir(racine, { recursive: true })

    return () => rm(dossier, { recursive: true, force: true })
  })

  test('découvre les fichiers réels et les écrit avec leurs métadonnées', async ({ assert }) => {
    await writeFile(join(racine, 'plage.jpg'), 'x'.repeat(2048))
    app.container.swap(NasRootsService, () => new NasRootsService([racine]))

    const user = await createUserWith([])
    await createVault(user)

    const command = await runSync()
    command.assertSucceeded()

    const rows = await catalogRowsFor(user.id)
    assert.lengthOf(rows, 1)
    assert.equal(rows[0].reference, 'plage.jpg')
    assert.equal(rows[0].nature, 'photo')
    assert.equal(rows[0].sizeBytes, 2048)
    assert.isNull(rows[0].missingSince)
  })

  test('⚠️ une racine absente fait échouer la commande, le catalogue reste INTACT', async ({
    assert,
  }) => {
    app.container.swap(NasRootsService, () => new NasRootsService([racine]))
    const user = await createUserWith([])
    await createVault(user)

    await writeFile(join(racine, 'plage.jpg'), 'contenu')
    await runSync()
    const before = await catalogRowsFor(user.id)
    assert.lengthOf(before, 1, 'un premier passage réussi peuple le catalogue')

    // La racine « disparaît » : on substitue vers un chemin qui n'existe pas.
    app.container.swap(NasRootsService, () => new NasRootsService([join(dossier, 'jamais-monte')]))

    const command = await runSync()
    command.assertFailed()

    const after = await catalogRowsFor(user.id)
    assert.lengthOf(after, before.length, 'aucune ligne perdue ni ajoutée')
    assert.isNull(after[0].missingSince, 'aucun marquage sur une énumération qui a échoué')
  })

  test('un second passage identique n’insère aucun doublon et ne perd aucune ligne', async ({
    assert,
  }) => {
    await mkdir(join(racine, 'vacances'), { recursive: true })
    await writeFile(join(racine, 'vacances', 'plage.jpg'), 'contenu')
    app.container.swap(NasRootsService, () => new NasRootsService([racine]))

    const user = await createUserWith([])
    await createVault(user)

    await runSync()
    const command = await runSync()

    command.assertSucceeded()
    assert.lengthOf(await catalogRowsFor(user.id), 1)
  })

  test('un fichier supprimé du disque est marqué absent, puis réapparu redevient présent', async ({
    assert,
  }) => {
    const chemin = join(racine, 'plage.jpg')
    await writeFile(chemin, 'contenu')
    app.container.swap(NasRootsService, () => new NasRootsService([racine]))

    const user = await createUserWith([])
    await createVault(user)

    await runSync()

    await unlink(chemin)
    await runSync()

    const rows = await catalogRowsFor(user.id)
    assert.lengthOf(rows, 1)
    assert.isNotNull(rows[0].missingSince, 'disparu du disque : marqué absent')

    await writeFile(chemin, 'contenu à nouveau')
    await runSync()

    const rowsAfter = await catalogRowsFor(user.id)
    assert.isNull(rowsAfter[0].missingSince, 'réapparu : redevenu présent')
  })
})
