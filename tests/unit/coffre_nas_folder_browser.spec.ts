import { test } from '@japa/runner'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import NasRootsService from '#modules/coffre/services/nas_roots_service'
import { browseNasFolder, browseNasRoots } from '#modules/coffre/services/nas_folder_browser'

/**
 * La navigation par dossier du coffre (CC-239) — contre un VRAI filesystem, comme
 * `coffre_nas_roots.spec.ts` et `coffre_nas_directory_walker.spec.ts` : un vrai lien symbolique, pas
 * mocké. Ne reprouve pas ce que `NasRootsService` prouve déjà (confinement de base) — vérifie
 * seulement le BRANCHEMENT et ce qui est propre à un listing d'UN dossier (tri, symlinks locaux,
 * dossiers spéciaux, chemin-fichier refusé).
 *
 * Disposition des fixtures, un dossier temporaire par test :
 *
 *   <tmp>/root/dossier_b/                — un sous-dossier, avant "dossier_a" alphabétiquement
 *   <tmp>/root/dossier_a/                — un sous-dossier
 *   <tmp>/root/photo.jpg                 — un fichier photo
 *   <tmp>/root/film.mp4                  — un fichier vidéo
 *   <tmp>/root/notice.pdf                — un fichier hors allow-list (nature `other`)
 *   <tmp>/root/@eaDir/                   — dossier spécial Synology, jamais listé
 *   <tmp>/root/.cache                    — dotfile, jamais listé
 *   <tmp>/root/alias.jpg -> dossier_a/cible.jpg   — lien symbolique LÉGITIME (dans la racine)
 *   <tmp>/root/echappe.jpg -> dehors/secret.jpg   — lien symbolique posé DANS la racine, DEHORS
 */
test.group('Coffre / la navigation par dossier NAS', (group) => {
  let dossier: string
  let racine: string

  group.each.setup(async () => {
    dossier = await mkdtemp(join(tmpdir(), 'cc-nas-browse-'))
    racine = join(dossier, 'root')

    await mkdir(join(racine, 'dossier_b'), { recursive: true })
    await mkdir(join(racine, 'dossier_a'), { recursive: true })
    await writeFile(join(racine, 'dossier_a', 'cible.jpg'), 'cible-legitime')
    await writeFile(join(racine, 'photo.jpg'), 'contenu-photo')
    await writeFile(join(racine, 'film.mp4'), 'contenu-film')
    await writeFile(join(racine, 'notice.pdf'), 'contenu-pdf')
    await mkdir(join(racine, '@eaDir'), { recursive: true })
    await writeFile(join(racine, '.cache'), 'invisible')

    await symlink(join(racine, 'dossier_a', 'cible.jpg'), join(racine, 'alias.jpg'), 'file')

    const dehors = join(dossier, 'dehors')
    await mkdir(dehors, { recursive: true })
    await writeFile(join(dehors, 'secret.jpg'), 'contenu-hors-racine')
    await symlink(join(dehors, 'secret.jpg'), join(racine, 'echappe.jpg'), 'file')

    return () => rm(dossier, { recursive: true, force: true })
  })

  test('browseNasRoots() rend les racines déclarées, sans toucher au disque', ({ assert }) => {
    const roots = new NasRootsService([
      { name: 'photos', path: racine },
      { name: 'jamais-monte', path: join(dossier, 'absent') },
    ])

    const listing = browseNasRoots(roots)

    assert.deepEqual(listing, {
      level: 'roots',
      roots: [{ name: 'photos' }, { name: 'jamais-monte' }],
    })
  })

  test('un dossier légitime rend ses entrées, dossiers d’abord puis ordre alphabétique', async ({
    assert,
  }) => {
    const roots = new NasRootsService([{ name: 'root', path: racine }])

    const listing = await browseNasFolder(roots, 'root', '')

    assert.isNotNull(listing)
    if (listing === null || listing.level !== 'folder') return

    // ⚠️ Ni `@eaDir` (dossier spécial Synology) ni `.cache` (dotfile) : jamais listés.
    const noms = listing.entries.map((entry) => entry.name)
    assert.notInclude(noms, '@eaDir')
    assert.notInclude(noms, '.cache')

    // Dossiers d'abord (dossier_a avant dossier_b, alphabétique), puis fichiers/liens.
    assert.deepEqual(noms.slice(0, 2), ['dossier_a', 'dossier_b'])

    const photo = listing.entries.find((entry) => entry.name === 'photo.jpg')
    assert.equal(photo?.kind, 'photo')
    assert.isNumber(photo?.sizeBytes)
    assert.isString(photo?.capturedAt)

    const film = listing.entries.find((entry) => entry.name === 'film.mp4')
    assert.equal(film?.kind, 'video')

    const pdf = listing.entries.find((entry) => entry.name === 'notice.pdf')
    assert.equal(pdf?.kind, 'other')
  })

  test('un sous-dossier se navigue, `path` porte le chemin relatif', async ({ assert }) => {
    const roots = new NasRootsService([{ name: 'root', path: racine }])

    const listing = await browseNasFolder(roots, 'root', 'dossier_a')

    assert.isNotNull(listing)
    if (listing === null || listing.level !== 'folder') return

    assert.equal(listing.path, 'dossier_a')
    assert.deepEqual(
      listing.entries.map((entry) => entry.path),
      ['dossier_a/cible.jpg']
    )
  })

  test('un lien symbolique LÉGITIME (cible dans la racine) est listé, classé sur la cible réelle', async ({
    assert,
  }) => {
    const roots = new NasRootsService([{ name: 'root', path: racine }])

    const listing = await browseNasFolder(roots, 'root', '')
    if (listing === null || listing.level !== 'folder') {
      assert.fail('listing attendu')
      return
    }

    const alias = listing.entries.find((entry) => entry.name === 'alias.jpg')
    assert.isDefined(alias)
    assert.equal(alias?.kind, 'photo')
  })

  test('⚠️ un lien symbolique posé DANS la racine et pointant DEHORS n’apparaît jamais dans le listing', async ({
    assert,
  }) => {
    const roots = new NasRootsService([{ name: 'root', path: racine }])

    const listing = await browseNasFolder(roots, 'root', '')
    if (listing === null || listing.level !== 'folder') {
      assert.fail('listing attendu')
      return
    }

    // Le chemin PARAÎT légitime (il est sous la racine) : seul `realpath()` + `isWithinRoot`
    // révèle sa vraie cible, hors racine — même mécanisme que `NasRootsService.resolve`.
    assert.notInclude(
      listing.entries.map((entry) => entry.name),
      'echappe.jpg'
    )
  })

  test('⚠️ une traversée (`../`) rend null, jamais un listing', async ({ assert }) => {
    const roots = new NasRootsService([{ name: 'root', path: racine }])

    assert.isNull(await browseNasFolder(roots, 'root', '../dehors'))
  })

  test('⚠️ un chemin absolu rend null', async ({ assert }) => {
    const roots = new NasRootsService([{ name: 'root', path: racine }])

    assert.isNull(await browseNasFolder(roots, 'root', join(dossier, 'dehors')))
  })

  test('⚠️ un identifiant de racine inconnu rend null', async ({ assert }) => {
    const roots = new NasRootsService([{ name: 'root', path: racine }])

    assert.isNull(await browseNasFolder(roots, 'inconnue', ''))
  })

  test('⚠️ un chemin qui désigne un FICHIER, pas un dossier, rend null', async ({ assert }) => {
    const roots = new NasRootsService([{ name: 'root', path: racine }])

    assert.isNull(await browseNasFolder(roots, 'root', 'photo.jpg'))
  })

  test('une racine configurée mais non montée rend null, jamais une exception', async ({
    assert,
  }) => {
    const roots = new NasRootsService([{ name: 'absente', path: join(dossier, 'jamais-monte') }])

    assert.isNull(await browseNasFolder(roots, 'absente', ''))
  })

  test('⚠️ un dossier créé APRÈS le premier appel apparaît sans resynchronisation — preuve de la lecture directe', async ({
    assert,
  }) => {
    const roots = new NasRootsService([{ name: 'root', path: racine }])

    const avant = await browseNasFolder(roots, 'root', '')
    if (avant === null || avant.level !== 'folder') {
      assert.fail('listing attendu')
      return
    }
    assert.notInclude(
      avant.entries.map((entry) => entry.name),
      'nouveau_dossier'
    )

    await mkdir(join(racine, 'nouveau_dossier'), { recursive: true })

    const apres = await browseNasFolder(roots, 'root', '')
    if (apres === null || apres.level !== 'folder') {
      assert.fail('listing attendu')
      return
    }
    assert.include(
      apres.entries.map((entry) => entry.name),
      'nouveau_dossier'
    )
  })
})
