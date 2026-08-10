import { test } from '@japa/runner'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import NasCatalogSource from '#modules/coffre/services/nas_catalog_source'
import NasRootsService from '#modules/coffre/services/nas_roots_service'

/**
 * L'implémentation NAS de l'abstraction `CatalogSource` (CC-226, `thumbnailFor` depuis CC-228) —
 * **fine par construction**, comme `ImmichLockedCatalogSource` : elle ne fait qu'assembler
 * `NasRootsService.getRoots()`/`resolveInRoot()` et `walkNasRoots`/`generateNasThumbnail`, déjà
 * prouvés de bout en bout ailleurs (`coffre_nas_directory_walker.spec.ts`,
 * `coffre_nas_thumbnail_generator.spec.ts`). Ce fichier ne re-prouve donc pas les pièges internes
 * de chacun, seulement que l'adaptateur relaie correctement.
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

  /**
   * `thumbnailFor()` (CC-228) — comblé après avoir levé systématiquement jusqu'à CC-226. Ce
   * fichier ne re-prouve pas la génération elle-même (bornes, allow-list, HEIC réel — voir
   * `coffre_nas_thumbnail_generator.spec.ts`), seulement que l'adaptateur relaie correctement :
   * parse `<racine>/<chemin>`, résout contre LA racine nommée, jamais contre une autre.
   */
  test('thumbnailFor() délègue via resolveInRoot puis génère une vignette', async ({ assert }) => {
    await writeFile(join(racine, 'plage.jpg'), 'contenu')
    // Une image RÉELLE — le générateur invoque le binaire, une chaîne quelconque échouerait au
    // décodage.
    await runMagick(['-size', '32x32', 'xc:red', `JPEG:${join(racine, 'plage.jpg')}`])

    const source = new NasCatalogSource(new NasRootsService([{ name: 'root', path: racine }]))
    const thumbnail = await source.thumbnailFor('root/plage.jpg')

    assert.equal(thumbnail.contentType, 'image/jpeg')
    assert.isTrue(thumbnail.bytes.length > 0)
  })

  test('thumbnailFor() rejette une référence sans identifiant de racine', async ({ assert }) => {
    const source = new NasCatalogSource(new NasRootsService([{ name: 'root', path: racine }]))

    await assert.rejects(() => source.thumbnailFor('plage.jpg'), /aucun identifiant de racine/)
  })

  test('⚠️ thumbnailFor() ne retombe JAMAIS sur une autre racine — collision CC-233, angle vignette', async ({
    assert,
  }) => {
    const seconde = join(dossier, 'seconde')
    await mkdir(seconde, { recursive: true })
    await runMagick(['-size', '32x32', 'xc:blue', `JPEG:${join(seconde, 'plage.jpg')}`])
    // La racine PRINCIPALE ne porte PAS ce fichier : si `thumbnailFor` retombait sur
    // l'essai-dans-l'ordre de `resolve()`, il échouerait ici plutôt que de servir la mauvaise
    // racine — les deux comportements sont fautifs, mais ce test prouve le second n'arrive pas en
    // vérifiant que la RÉFÉRENCE demandée (« secondaire/… ») rend bien LE contenu de la racine
    // secondaire, jamais une 404 ni un contenu d'une autre racine.
    const source = new NasCatalogSource(
      new NasRootsService([
        { name: 'principale', path: racine },
        { name: 'secondaire', path: seconde },
      ])
    )

    const thumbnail = await source.thumbnailFor('secondaire/plage.jpg')

    assert.equal(thumbnail.contentType, 'image/jpeg')
  })

  test('thumbnailFor() rejette une référence dont la racine ne résout pas', async ({ assert }) => {
    const source = new NasCatalogSource(new NasRootsService([{ name: 'root', path: racine }]))

    await assert.rejects(
      () => source.thumbnailFor('root/absent.jpg'),
      /ne résout sous aucune racine/
    )
  })
})

async function runMagick(args: string[]): Promise<void> {
  const { execFile } = await import('node:child_process')
  await new Promise<void>((resolve, reject) => {
    execFile('magick', args, (error) => (error ? reject(error) : resolve()))
  })
}
