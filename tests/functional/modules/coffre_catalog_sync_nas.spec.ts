import { test } from '@japa/runner'
import { mkdir, mkdtemp, rm, stat, unlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import app from '@adonisjs/core/services/app'
import ace from '@adonisjs/core/services/ace'
import testUtils from '@adonisjs/core/services/test_utils'
import { createUserWith } from '#tests/helpers/users'
import { createVault } from '#tests/helpers/coffre'
import CoffreCatalogItem from '#modules/coffre/models/coffre_catalog_item'
import NasRootsService from '#modules/coffre/services/nas_roots_service'
import { walkNasRoots } from '#modules/coffre/services/nas_directory_walker'
import catalogSync from '#modules/coffre/services/catalog_sync_service'
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
    const chemin = join(racine, 'plage.jpg')
    await writeFile(chemin, 'x'.repeat(2048))
    app.container.swap(NasRootsService, () => new NasRootsService([{ name: 'root', path: racine }]))

    const user = await createUserWith([])
    await createVault(user)

    const command = await runSync()
    command.assertSucceeded()

    const rows = await catalogRowsFor(user.id)
    assert.lengthOf(rows, 1)
    assert.equal(rows[0].reference, 'root/plage.jpg')
    assert.equal(rows[0].nature, 'photo')
    assert.equal(rows[0].sizeBytes, 2048)
    assert.isNull(rows[0].missingSince)

    // ⚠️ L'INSTANT écrit en base, pas seulement « une date est là » (CC-244). Le parcours porte
    // désormais un epoch et la conversion vit dans `catalog_sync_service.ts` : c'est ce
    // bout-en-bout qui prouve que la traduction n'a rien décalé — un `fromSeconds` à la place d'un
    // `fromMillis`, ou une zone de construction différente, passeraient tous deux « une date est
    // là » sans qu'aucun test ne rougisse.
    const { mtime } = await stat(chemin)
    assert.equal(rows[0].capturedAt?.toMillis(), mtime.getTime())
  })

  test('⚠️ un fichier dont la `mtime` est à l’epoch 0 garde sa date, il ne devient pas NULL', async ({
    assert,
  }) => {
    // Le seul mode d'échec SILENCIEUX que CC-244 a créé : l'epoch `0` est *falsy*, alors que le
    // `DateTime | null` d'avant ne pouvait pas l'être. Un `item.capturedAt ? … : null` dans
    // `catalog_sync_service.ts` écrirait `captured_at NULL` sur un fichier daté du 1ᵉʳ janvier
    // 1970 — une `mtime` cassée, ce qu'un NAS produit sans prévenir — sans erreur et sans test
    // rouge ailleurs. C'est ce test qui rougit sur cette mutation.
    const chemin = join(racine, 'sans-date.jpg')
    await writeFile(chemin, 'contenu')
    await utimes(chemin, new Date(0), new Date(0))
    app.container.swap(NasRootsService, () => new NasRootsService([{ name: 'root', path: racine }]))

    const user = await createUserWith([])
    await createVault(user)

    const command = await runSync()
    command.assertSucceeded()

    const rows = await catalogRowsFor(user.id)
    assert.lengthOf(rows, 1)
    assert.isNotNull(rows[0].capturedAt, 'l’epoch 0 est une date, pas une absence de date')
    assert.equal(rows[0].capturedAt?.toMillis(), 0)
  })

  test('⚠️ au franchissement du plafond, `truncated` reste vrai et AUCUN élément n’est marqué absent', async ({
    assert,
  }) => {
    // Les deux moitiés de cette garde étaient prouvées SÉPARÉMENT avant CC-244 : le plafond dans
    // `coffre_nas_directory_walker.spec.ts` (sans base), le non-marquage dans
    // `coffre_catalog_sync.spec.ts` (sur un `truncated` fabriqué à la main, source Immich). Ce
    // test-ci les relie sur le vrai chemin NAS : un parcours réellement tronqué, appliqué à une
    // vraie base qui porte déjà les deux fichiers. Sans le lien, relever le plafond aurait pu
    // casser la chaîne sans qu'aucune des deux moitiés ne rougisse.
    await writeFile(join(racine, 'un.jpg'), 'contenu')
    await writeFile(join(racine, 'deux.jpg'), 'contenu')
    app.container.swap(NasRootsService, () => new NasRootsService([{ name: 'root', path: racine }]))

    const user = await createUserWith([])
    await createVault(user)

    // Un premier passage COMPLET : les deux fichiers entrent au catalogue, présents.
    const premierPassage = await runSync()
    premierPassage.assertSucceeded()
    assert.lengthOf(await catalogRowsFor(user.id), 2)

    // Un second passage TRONQUÉ au premier fichier — le plafond franchi pour de vrai, par le
    // parcours réel, pas par un drapeau posé à la main.
    const enumeration = await walkNasRoots([{ name: 'root', path: racine }], { maxItems: 1 })
    assert.isTrue(enumeration.truncated, 'le plafond est bien franchi')
    assert.lengthOf(enumeration.items, 1)

    const outcome = await catalogSync.applyEnumeration(user.id, 'nas', enumeration)

    assert.isTrue(outcome.truncated)
    assert.equal(outcome.markedAbsent, 0, 'un parcours tronqué ne conclut à AUCUNE disparition')

    const rows = await catalogRowsFor(user.id)
    assert.lengthOf(rows, 2, 'les deux lignes sont toujours là')
    for (const row of rows) {
      assert.isNull(
        row.missingSince,
        `${row.reference} : ce que le plafond n’a pas vu n’est pas disparu`
      )
    }
  })

  test('⚠️ une racine absente fait échouer la commande, le catalogue reste INTACT', async ({
    assert,
  }) => {
    app.container.swap(NasRootsService, () => new NasRootsService([{ name: 'root', path: racine }]))
    const user = await createUserWith([])
    await createVault(user)

    await writeFile(join(racine, 'plage.jpg'), 'contenu')
    await runSync()
    const before = await catalogRowsFor(user.id)
    assert.lengthOf(before, 1, 'un premier passage réussi peuple le catalogue')

    // La racine « disparaît » : on substitue vers un chemin qui n'existe pas.
    app.container.swap(
      NasRootsService,
      () => new NasRootsService([{ name: 'root', path: join(dossier, 'jamais-monte') }])
    )

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
    app.container.swap(NasRootsService, () => new NasRootsService([{ name: 'root', path: racine }]))

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
    app.container.swap(NasRootsService, () => new NasRootsService([{ name: 'root', path: racine }]))

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

  test('⚠️ deux racines portant chacune un fichier de même chemin relatif écrivent DEUX lignes en base — l’écrasement silencieux que ce ticket corrige', async ({
    assert,
  }) => {
    const dossier2 = await mkdtemp(join(tmpdir(), 'cc-nas-catalog-sync-'))
    const racine2 = join(dossier2, 'root')
    await mkdir(racine2, { recursive: true })

    try {
      await writeFile(join(racine, 'photo.jpg'), 'depuis-la-premiere-racine')
      await writeFile(join(racine2, 'photo.jpg'), 'depuis-la-seconde-racine')

      app.container.swap(
        NasRootsService,
        () =>
          new NasRootsService([
            { name: 'principale', path: racine },
            { name: 'secondaire', path: racine2 },
          ])
      )

      const user = await createUserWith([])
      await createVault(user)

      const command = await runSync()
      command.assertSucceeded()

      // ⚠️ Sans l'identifiant de racine dans la référence, les deux fichiers partageraient la
      // même clé (owner_id, source, reference) : `CatalogSyncService#applyEnumeration` trouverait
      // la ligne du premier en cherchant celle du second et la mettrait à jour à sa place — une
      // seule ligne en base, sans qu'aucune contrainte ne s'y oppose. C'est ce que ce test rougit
      // sans le correctif : une seule ligne trouvée, portant la référence nue `photo.jpg`.
      const rows = await catalogRowsFor(user.id)
      assert.lengthOf(rows, 2, 'les deux fichiers doivent coexister, un par racine')
      assert.deepEqual(
        rows.map((row) => row.reference),
        ['principale/photo.jpg', 'secondaire/photo.jpg']
      )
    } finally {
      await rm(dossier2, { recursive: true, force: true })
    }
  })
})
