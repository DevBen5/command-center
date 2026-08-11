import { test } from '@japa/runner'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import app from '@adonisjs/core/services/app'
import ace from '@adonisjs/core/services/ace'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import { createUserWith } from '#tests/helpers/users'
import { createVault } from '#tests/helpers/coffre'
import CoffreCatalogItem from '#modules/coffre/models/coffre_catalog_item'
import ImmichSessionClient from '#modules/coffre/services/immich_session_client'
import FakeImmichSessionClient, {
  type LockedCatalogScript,
} from '#tests/fakes/fake_immich_session_client'
import NasRootsService from '#modules/coffre/services/nas_roots_service'
import CoffreSyncCatalog from '#commands/coffre_sync_catalog'
import catalogSync from '#modules/coffre/services/catalog_sync_service'
import type { CatalogSourceItem } from '#modules/coffre/services/catalog_source'

/**
 * Le catalogue des sources (CC-225, lot 1 de l'épique CC-224) : la contrainte d'unicité en base,
 * et la commande `coffre:sync-catalog` bout-en-bout avec `FakeImmichSessionClient`.
 *
 * ⚠️ **Le test le plus important du lot** : une énumération qui échoue ne marque RIEN absent et
 * n'écrit RIEN — c'est la règle qui protège le catalogue d'un NAS démonté ou d'une session Immich
 * expirée pris pour « plus rien dans la source ».
 *
 * ⚠️ **Depuis CC-226, `NasRootsService` est AUSSI substitué** (racine de fixtures réelle mais
 * vide), pour la raison inverse de `coffre_catalog_sync_nas.spec.ts` : la commande énumère
 * maintenant deux sources, et sans ce faux la source « nas » — non configurée par défaut en
 * test — échouerait à chaque appel et ferait sortir `assertSucceeded()` en erreur pour des
 * raisons étrangères à ce que ce fichier prouve (le comportement générique et la source Immich).
 */
async function catalogRowsFor(ownerId: number) {
  return CoffreCatalogItem.query().where('owner_id', ownerId).orderBy('reference', 'asc')
}

async function runSync(catalog: LockedCatalogScript) {
  app.container.swap(ImmichSessionClient, () => new FakeImmichSessionClient(undefined, catalog))

  const command = await ace.create(CoffreSyncCatalog, [])
  await command.exec()
  return command
}

test.group('Coffre / le catalogue — contrainte unique', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('un second (owner, source, référence) identique échoue', async ({ assert }) => {
    const user = await createUserWith([])
    const now = DateTime.now()

    await CoffreCatalogItem.create({
      ownerId: user.id,
      source: 'immich_locked',
      reference: 'abc',
      nature: 'photo',
      displayName: null,
      capturedAt: null,
      sizeBytes: null,
      discoveredAt: now,
      lastSeenAt: now,
      missingSince: null,
    })

    await assert.rejects(() =>
      CoffreCatalogItem.create({
        ownerId: user.id,
        source: 'immich_locked',
        reference: 'abc',
        nature: 'photo',
        displayName: null,
        capturedAt: null,
        sizeBytes: null,
        discoveredAt: now,
        lastSeenAt: now,
        missingSince: null,
      })
    )
  })

  test('le même (owner, source, référence) est permis sur DEUX comptes différents', async ({
    assert,
  }) => {
    const first = await createUserWith([])
    const second = await createUserWith([])
    const now = DateTime.now()

    await CoffreCatalogItem.create({
      ownerId: first.id,
      source: 'immich_locked',
      reference: 'abc',
      nature: 'photo',
      displayName: null,
      capturedAt: null,
      sizeBytes: null,
      discoveredAt: now,
      lastSeenAt: now,
      missingSince: null,
    })

    await CoffreCatalogItem.create({
      ownerId: second.id,
      source: 'immich_locked',
      reference: 'abc',
      nature: 'photo',
      displayName: null,
      capturedAt: null,
      sizeBytes: null,
      discoveredAt: now,
      lastSeenAt: now,
      missingSince: null,
    })

    assert.lengthOf(await catalogRowsFor(first.id), 1)
    assert.lengthOf(await catalogRowsFor(second.id), 1)
  })
})

test.group('Coffre / la commande coffre:sync-catalog', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.teardown(() => app.container.restore(ImmichSessionClient))
  group.each.teardown(() => app.container.restore(NasRootsService))

  group.each.setup(() => {
    // Sans ce mode, les messages de la commande partent à l'écran et rien ne permet de les lire.
    ace.ui.switchMode('raw')
    return () => ace.ui.switchMode('normal')
  })

  group.each.setup(async () => {
    const dossier = await mkdtemp(join(tmpdir(), 'cc-nas-catalog-immich-only-'))
    const racine = join(dossier, 'root')
    await mkdir(racine, { recursive: true })
    app.container.swap(NasRootsService, () => new NasRootsService([{ name: 'root', path: racine }]))

    return () => rm(dossier, { recursive: true, force: true })
  })

  test('aucun coffre sur l’installation : rien ne se passe, aucune erreur', async ({ assert }) => {
    const command = await runSync({ assets: [], truncated: false })

    command.assertSucceeded()
    const messages = command.logger.getLogs().map((log) => log.message)
    assert.include(messages.join('\n'), 'Aucun coffre')
  })

  test('découvre les assets, une copie DES LIGNES par compte', async ({ assert }) => {
    const first = await createUserWith([])
    const second = await createUserWith([])
    await createVault(first)
    await createVault(second)

    const command = await runSync({
      assets: [
        {
          assetId: '11111111-2222-4333-8444-555555555555',
          nature: 'photo',
          displayName: 'plage.jpg',
          capturedAt: DateTime.fromISO('2026-06-01T10:00:00.000Z'),
          sizeBytes: 2048,
        },
        {
          assetId: 'c1d2e3f4-5a6b-4c8d-9e0f-1a2b3c4d5e6f',
          nature: 'video',
          displayName: null,
          capturedAt: null,
          sizeBytes: null,
        },
      ],
      truncated: false,
    })

    command.assertSucceeded()

    const rowsFirst = await catalogRowsFor(first.id)
    const rowsSecond = await catalogRowsFor(second.id)

    assert.lengthOf(rowsFirst, 2, 'le premier compte reçoit sa propre copie')
    assert.lengthOf(
      rowsSecond,
      2,
      'le second compte reçoit AUSSI sa propre copie — CC-225 : par compte'
    )
    assert.equal(rowsFirst[0].displayName, 'plage.jpg')
    assert.equal(rowsFirst[0].nature, 'photo')
    assert.equal(rowsFirst[0].sizeBytes, 2048)
    assert.isNull(rowsFirst[0].missingSince)
  })

  test('une seconde synchronisation identique n’insère aucun doublon et ne perd aucune ligne', async ({
    assert,
  }) => {
    const user = await createUserWith([])
    await createVault(user)

    const script: LockedCatalogScript = {
      assets: [
        {
          assetId: '11111111-2222-4333-8444-555555555555',
          nature: 'photo',
          displayName: 'plage.jpg',
          capturedAt: null,
          sizeBytes: null,
        },
      ],
      truncated: false,
    }

    await runSync(script)
    const command = await runSync(script)

    command.assertSucceeded()
    assert.lengthOf(await catalogRowsFor(user.id), 1)
  })

  test('un élément disparu est marqué absent, puis réapparu redevient présent', async ({
    assert,
  }) => {
    const user = await createUserWith([])
    await createVault(user)

    const asset1 = {
      assetId: '11111111-2222-4333-8444-555555555555',
      nature: 'photo' as const,
      displayName: null,
      capturedAt: null,
      sizeBytes: null,
    }
    const asset2 = {
      assetId: 'c1d2e3f4-5a6b-4c8d-9e0f-1a2b3c4d5e6f',
      nature: 'video' as const,
      displayName: null,
      capturedAt: null,
      sizeBytes: null,
    }

    await runSync({ assets: [asset1, asset2], truncated: false })

    // asset2 a disparu du listing suivant — énumération réussie, non tronquée.
    await runSync({ assets: [asset1], truncated: false })

    const rows = await catalogRowsFor(user.id)
    const row1 = rows.find((r) => r.reference === asset1.assetId)!
    const row2 = rows.find((r) => r.reference === asset2.assetId)!

    assert.isNull(row1.missingSince, 'toujours vu : pas absent')
    assert.isNotNull(row2.missingSince, 'disparu d’un listing complet et réussi : marqué absent')

    // asset2 réapparaît.
    await runSync({ assets: [asset1, asset2], truncated: false })

    const rowsAfter = await catalogRowsFor(user.id)
    const row2After = rowsAfter.find((r) => r.reference === asset2.assetId)!
    assert.isNull(row2After.missingSince, 'réapparu : redevenu présent')
  })

  test('une énumération TRONQUÉE ne marque rien absent', async ({ assert }) => {
    const user = await createUserWith([])
    await createVault(user)

    const asset1 = {
      assetId: '11111111-2222-4333-8444-555555555555',
      nature: 'photo' as const,
      displayName: null,
      capturedAt: null,
      sizeBytes: null,
    }
    const asset2 = {
      assetId: 'c1d2e3f4-5a6b-4c8d-9e0f-1a2b3c4d5e6f',
      nature: 'video' as const,
      displayName: null,
      capturedAt: null,
      sizeBytes: null,
    }

    await runSync({ assets: [asset1, asset2], truncated: false })

    // asset2 n'est pas vu, mais le listing est TRONQUÉ : ce qui n'a pas été vu ne doit pas être
    // pris pour disparu.
    await runSync({ assets: [asset1], truncated: true })

    const rows = await catalogRowsFor(user.id)
    for (const row of rows) {
      assert.isNull(row.missingSince, `${row.reference} : un listing tronqué ne marque rien absent`)
    }
  })

  test('une énumération qui ÉCHOUE ne touche à rien — ni écriture, ni marquage', async ({
    assert,
  }) => {
    const user = await createUserWith([])
    await createVault(user)

    const asset1 = {
      assetId: '11111111-2222-4333-8444-555555555555',
      nature: 'photo' as const,
      displayName: null,
      capturedAt: null,
      sizeBytes: null,
    }

    await runSync({ assets: [asset1], truncated: false })
    const before = await catalogRowsFor(user.id)

    const command = await runSync(new Error('session Immich expirée'))

    command.assertFailed()
    const after = await catalogRowsFor(user.id)

    assert.lengthOf(after, before.length, 'aucune ligne perdue ni ajoutée')
    assert.isNull(after[0].missingSince, 'aucun marquage sur une énumération qui a échoué')
  })

  /**
   * ⚠️ **Point d'attention du ticket CC-243, déjà correct — ce test le PROUVE plutôt que de le
   * laisser implicite.** L'échec d'`applyEnumeration` pour UN compte (ici une violation de
   * contrainte `CHECK` sur `nature`, plutôt que le débordement de paramètres — n'importe quelle
   * erreur applicative suffit à exercer ce chemin) est déjà catché par `#syncSource`
   * (`commands/coffre_sync_catalog.ts`), qui pose `this.exitCode = 1`. Rien à corriger ici ; ce
   * test fige le comportement pour qu'une régression future rougisse.
   */
  test("l'échec d'application pour UN compte fait sortir la commande en erreur, pas en code 0", async ({
    assert,
  }) => {
    const user = await createUserWith([])
    await createVault(user)

    const command = await runSync({
      assets: [
        {
          assetId: '11111111-2222-4333-8444-555555555555',
          nature: 'nature-invalide' as never,
          displayName: null,
          capturedAt: null,
          sizeBytes: null,
        },
      ],
      truncated: false,
    })

    command.assertFailed()
    assert.equal(command.exitCode, 1)
    assert.lengthOf(await catalogRowsFor(user.id), 0, 'rien écrit pour le compte en échec')
  })
})

test.group('Coffre / le catalogue — au-delà du plafond de paramètres SQL (CC-243)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  /**
   * ⚠️ **Le cœur du lot CC-243.** Le protocole étendu de PostgreSQL plafonne le nombre de
   * paramètres liés d'une requête à 65 535 (compteur 16 bits) — au-delà, il déborde en SILENCE
   * plutôt que de refuser proprement. `#markAbsent` liait une référence par paramètre
   * (`whereNotIn`) : ce test dépasse volontairement le seuil (65 600 références, la requête porte
   * en plus `owner_id`/`source`) contre une VRAIE base, pour prouver que la synchronisation ne
   * s'effondre plus à cette échelle — le volume réel constaté sur le NAS du propriétaire (~126 000
   * fichiers).
   *
   * Une référence PRÉEXISTANTE, absente du nouveau listing, est glissée dans le lot : elle doit
   * ressortir marquée absente malgré la taille du tableau exclu — la preuve que le remplacement de
   * `whereNotIn`/`whereIn` par `<> all(?::text[])`/`= any(?::int[])` reste sémantiquement
   * équivalent, pas seulement qu'il ne plante plus.
   */
  test('une énumération de plus de 65 535 références ne fait plus déborder le protocole, et marque toujours correctement ce qui a disparu', async ({
    assert,
  }) => {
    const user = await createUserWith([])
    const now = DateTime.now()

    const stale = await CoffreCatalogItem.create({
      ownerId: user.id,
      source: 'nas',
      reference: 'racine/disparu.jpg',
      nature: 'photo',
      displayName: null,
      capturedAt: null,
      sizeBytes: null,
      discoveredAt: now,
      lastSeenAt: now,
      missingSince: null,
    })

    const REFERENCE_COUNT = 65_600 // > 65 535 - 2 (owner_id, source) : franchit le seuil.
    const items: CatalogSourceItem[] = Array.from({ length: REFERENCE_COUNT }, (_, i) => ({
      reference: `racine/fichier-${i}.jpg`,
      nature: 'photo',
      displayName: null,
      capturedAt: null,
      sizeBytes: null,
    }))

    const outcome = await catalogSync.applyEnumeration(user.id, 'nas', {
      items,
      truncated: false,
    })

    assert.equal(outcome.discovered, REFERENCE_COUNT)
    assert.equal(outcome.markedAbsent, 1, 'seule la référence préexistante et non revue')

    await stale.refresh()
    assert.isNotNull(stale.missingSince, 'marquée absente malgré un tableau exclu géant')

    const total = await CoffreCatalogItem.query().where('owner_id', user.id).count('* as total')
    assert.equal(Number(total[0].$extras.total), REFERENCE_COUNT + 1)
  }).timeout(0)
})
