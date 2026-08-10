import { test } from '@japa/runner'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import NasCatalogSource from '#modules/coffre/services/nas_catalog_source'
import NasRootsService from '#modules/coffre/services/nas_roots_service'

/**
 * L'implémentation NAS de l'abstraction `CatalogSource` (CC-226) — **fine par construction**,
 * comme `ImmichLockedCatalogSource` : elle ne fait qu'assembler `NasRootsService.getRoots()` et
 * `walkNasRoots`, déjà prouvé de bout en bout par `coffre_nas_directory_walker.spec.ts`. Ce
 * fichier ne re-prouve donc pas les pièges du parcours (symlinks, cycles…), seulement que
 * l'adaptateur relaie correctement.
 */
test.group('Coffre / la source de catalogue NAS', (group) => {
  let dossier: string
  let racine: string

  group.each.setup(async () => {
    dossier = await mkdtemp(join(tmpdir(), 'cc-nas-catalog-source-'))
    racine = join(dossier, 'root')
    await mkdir(racine, { recursive: true })

    return () => rm(dossier, { recursive: true, force: true })
  })

  test('key vaut "nas"', ({ assert }) => {
    const source = new NasCatalogSource(new NasRootsService([{ name: 'root', path: racine }]))
    assert.equal(source.key, 'nas')
  })

  test('enumerate() délègue au parcours et rend les fichiers trouvés', async ({ assert }) => {
    await writeFile(join(racine, 'plage.jpg'), 'contenu')

    const source = new NasCatalogSource(new NasRootsService([{ name: 'root', path: racine }]))
    const { items, truncated } = await source.enumerate()

    assert.isFalse(truncated)
    assert.lengthOf(items, 1)
    assert.equal(items[0].reference, 'root/plage.jpg')
  })

  test('enumerate() ne rattrape pas une racine absente : elle remonte telle quelle', async ({
    assert,
  }) => {
    const source = new NasCatalogSource(
      new NasRootsService([{ name: 'root', path: join(dossier, 'jamais-monte') }])
    )

    await assert.rejects(() => source.enumerate(), /n'a pas pu être résolue/)
  })

  test('thumbnailFor() lève — non pris en charge pour le NAS dans ce lot', async ({ assert }) => {
    const source = new NasCatalogSource(new NasRootsService([{ name: 'root', path: racine }]))

    await assert.rejects(() => source.thumbnailFor('plage.jpg'), /pas prises en charge/)
  })
})
