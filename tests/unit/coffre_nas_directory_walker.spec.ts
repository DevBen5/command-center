import { test } from '@japa/runner'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { walkNasRoots } from '#modules/coffre/services/nas_directory_walker'

/**
 * Le parcours récursif des racines NAS du catalogue (CC-226), contre un VRAI filesystem — même
 * doctrine que `coffre_nas_roots.spec.ts` : rien n'est mocké, c'est le comportement réel de
 * `readdir`/`realpath` face à un lien symbolique ou une racine absente qu'on veut prouver.
 */
test.group('Coffre / le parcours du catalogue NAS', (group) => {
  let dossier: string
  let racine: string

  group.each.setup(async () => {
    dossier = await mkdtemp(join(tmpdir(), 'cc-nas-walk-'))
    racine = join(dossier, 'root')
    await mkdir(racine, { recursive: true })

    return () => rm(dossier, { recursive: true, force: true })
  })

  test('une racine vide rend 0 élément, ce n’est pas une erreur', async ({ assert }) => {
    const { items, truncated } = await walkNasRoots([racine])

    assert.deepEqual(items, [])
    assert.isFalse(truncated)
  })

  test('une racine ABSENTE lève, elle ne rend pas une liste vide', async ({ assert }) => {
    const absente = join(dossier, 'jamais-monte')

    await assert.rejects(() => walkNasRoots([absente]), /n'a pas pu être résolue/)
  })

  test('aucune racine configurée : lève, jamais une liste vide silencieuse', async ({ assert }) => {
    await assert.rejects(() => walkNasRoots([]), /Aucune racine NAS configurée/)
  })

  test('un fichier de premier niveau est découvert, avec ses métadonnées', async ({ assert }) => {
    await writeFile(join(racine, 'plage.jpg'), 'x'.repeat(2048))

    const { items } = await walkNasRoots([racine])

    assert.lengthOf(items, 1)
    assert.equal(items[0].reference, 'plage.jpg')
    assert.equal(items[0].displayName, 'plage.jpg')
    assert.equal(items[0].nature, 'photo')
    assert.equal(items[0].sizeBytes, 2048)
    assert.isNotNull(items[0].capturedAt)
  })

  test('les sous-dossiers sont parcourus récursivement, le chemin relatif les porte', async ({
    assert,
  }) => {
    await mkdir(join(racine, 'vacances', '2026'), { recursive: true })
    await writeFile(join(racine, 'vacances', '2026', 'plage.mp4'), 'contenu')

    const { items } = await walkNasRoots([racine])

    assert.lengthOf(items, 1)
    assert.match(items[0].reference, /vacances.2026.plage\.mp4$/)
    assert.equal(items[0].nature, 'video')
  })

  test('une extension hors allow-list photo/vidéo est indexée en `other`', async ({ assert }) => {
    await writeFile(join(racine, 'notice.pdf'), 'contenu')

    const { items } = await walkNasRoots([racine])

    assert.lengthOf(items, 1)
    assert.equal(items[0].nature, 'other')
  })

  test('la casse du chemin est préservée, jamais normalisée', async ({ assert }) => {
    await mkdir(join(racine, 'Vacances'), { recursive: true })
    await writeFile(join(racine, 'Vacances', 'Plage.JPG'), 'contenu')

    const { items } = await walkNasRoots([racine])

    assert.lengthOf(items, 1)
    assert.match(items[0].reference, /Vacances.Plage\.JPG$/)
  })

  test('⚠️ un lien symbolique posé DANS la racine et pointant DEHORS n’est pas indexé', async ({
    assert,
  }) => {
    const dehors = join(dossier, 'dehors')
    await mkdir(dehors, { recursive: true })
    await writeFile(join(dehors, 'secret.jpg'), 'contenu-hors-racine')
    await symlink(join(dehors, 'secret.jpg'), join(racine, 'echappe.jpg'), 'file')

    const { items } = await walkNasRoots([racine])

    assert.deepEqual(items, [])
  })

  test('⚠️ un lien symbolique vers un fichier légitime classe la nature sur le fichier RÉEL, pas sur le nom du lien', async ({
    assert,
  }) => {
    await writeFile(join(racine, 'photo.jpg'), 'contenu')
    // Le lien porte une extension hors allow-list ; sa CIBLE, elle, est une photo légitime.
    await symlink(join(racine, 'photo.jpg'), join(racine, 'alias.txt'), 'file')

    const { items } = await walkNasRoots([racine])

    const alias = items.find((item) => item.reference === 'alias.txt')
    assert.isDefined(alias, 'le lien est bien indexé, sous SON propre nom')
    assert.equal(
      alias?.nature,
      'photo',
      'classé comme le fichier réel qu’il désigne, pas comme "other" d’après le nom du lien'
    )
  })

  test('⚠️ un lien symbolique DANS la racine, pointant vers un dossier légitime AUSSI dans la racine, est indexé', async ({
    assert,
  }) => {
    await mkdir(join(racine, 'vraidossier'), { recursive: true })
    await writeFile(join(racine, 'vraidossier', 'photo.jpg'), 'contenu')
    await symlink(join(racine, 'vraidossier'), join(racine, 'alias'), 'dir')

    const { items } = await walkNasRoots([racine])

    const references = items.map((item) => item.reference).sort()
    assert.lengthOf(references, 2, 'le dossier réel ET son alias sont chacun indexés')
  })

  test('⚠️ un cycle de liens symboliques ne fait pas boucler le parcours indéfiniment', async ({
    assert,
  }) => {
    // root/boucle -> root : un lien qui pointe directement sur la racine.
    await symlink(racine, join(racine, 'boucle'), 'dir')

    const { items } = await walkNasRoots([racine])

    assert.deepEqual(items, [])
  })

  test('⚠️ un cycle de liens symboliques imbriqués (a -> b -> a) ne boucle pas', async ({
    assert,
  }) => {
    await mkdir(join(racine, 'a'), { recursive: true })
    await symlink(join(racine, 'a'), join(racine, 'a', 'vers_a'), 'dir')

    const { items } = await walkNasRoots([racine])

    assert.deepEqual(items, [])
  })

  test('un second passage sans changement rend exactement les mêmes références', async ({
    assert,
  }) => {
    await mkdir(join(racine, 'vacances'), { recursive: true })
    await writeFile(join(racine, 'vacances', 'plage.jpg'), 'contenu')
    await writeFile(join(racine, 'notice.pdf'), 'contenu')

    const first = await walkNasRoots([racine])
    const second = await walkNasRoots([racine])

    assert.deepEqual(
      first.items.map((item) => item.reference).sort(),
      second.items.map((item) => item.reference).sort()
    )
  })

  test('les dossiers spéciaux Synology ne sont jamais indexés ni parcourus', async ({ assert }) => {
    await mkdir(join(racine, '@eaDir'), { recursive: true })
    await writeFile(join(racine, '@eaDir', 'SYNOPHOTO_THUMB_XL.jpg'), 'cache')
    await mkdir(join(racine, '#recycle'), { recursive: true })
    await writeFile(join(racine, '#recycle', 'supprime.jpg'), 'poubelle')
    await writeFile(join(racine, '.DS_Store'), 'macos')

    const { items } = await walkNasRoots([racine])

    assert.deepEqual(items, [])
  })

  test('le plafond anti-boucle rend `truncated: true` sans lever', async ({ assert }) => {
    await writeFile(join(racine, 'un.jpg'), 'x')
    await writeFile(join(racine, 'deux.jpg'), 'x')
    await writeFile(join(racine, 'trois.jpg'), 'x')

    const { items, truncated } = await walkNasRoots([racine], { maxItems: 2 })

    assert.lengthOf(items, 2)
    assert.isTrue(truncated)
  })
})
