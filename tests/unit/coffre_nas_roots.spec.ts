import { test } from '@japa/runner'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import NasRootsService from '#modules/coffre/services/nas_roots_service'

/**
 * Le résolveur de racines de médias NAS du coffre (CC-181) — la garde qui compte du ticket,
 * prouvée contre un VRAI filesystem, lien symbolique compris. Rien n'est mocké : c'est le
 * comportement réel de `realpath()` face à un lien qui sort d'une racine qu'on veut prouver, pas
 * une hypothèse dessus. Ne connaît rien de la nature du fichier (photo, vidéo) : un seul
 * mécanisme couvre les deux, c'est le point de l'amendement du ticket (2026-08-06).
 *
 * Disposition des fixtures, un dossier temporaire par test :
 *
 *   <tmp>/root/films/exemple.mp4     — un fichier légitime, dans la racine autorisée
 *   <tmp>/root/echappe.mp4           — un LIEN SYMBOLIQUE posé DANS la racine, pointant DEHORS
 *   <tmp>/dehors/secret.mp4          — la cible du lien, et la cible de la traversée
 */
test.group('Coffre / le résolveur de racines de médias NAS', (group) => {
  let dossier: string
  let racine: string

  group.each.setup(async () => {
    dossier = await mkdtemp(join(tmpdir(), 'cc-nas-roots-'))
    racine = join(dossier, 'root')

    await mkdir(join(racine, 'films'), { recursive: true })
    await writeFile(join(racine, 'films', 'exemple.mp4'), 'contenu-legitime')

    const dehors = join(dossier, 'dehors')
    await mkdir(dehors, { recursive: true })
    await writeFile(join(dehors, 'secret.mp4'), 'contenu-hors-racine')

    await symlink(join(dehors, 'secret.mp4'), join(racine, 'echappe.mp4'), 'file')

    return () => rm(dossier, { recursive: true, force: true })
  })

  test('un chemin légitime, dans la racine, se résout', async ({ assert }) => {
    const roots = new NasRootsService([{ name: 'root', path: racine }])

    const resolu = await roots.resolve('films/exemple.mp4')

    assert.isNotNull(resolu)
    assert.match(resolu ?? '', /exemple\.mp4$/)
  })

  test('⚠️ une traversée (`../`) est refusée', async ({ assert }) => {
    const roots = new NasRootsService([{ name: 'root', path: racine }])

    assert.isNull(await roots.resolve('../dehors/secret.mp4'))
  })

  test('⚠️ un lien symbolique posé DANS la racine et pointant DEHORS est refusé — le cas qui compte', async ({
    assert,
  }) => {
    const roots = new NasRootsService([{ name: 'root', path: racine }])

    // Le chemin demandé PARAÎT légitime : il est bien sous la racine, une comparaison de
    // chaînes avant résolution le laisserait passer. Seul `realpath()` révèle sa vraie cible.
    assert.isNull(await roots.resolve('echappe.mp4'))
  })

  test('⚠️ un chemin absolu est refusé, jamais concaténé à la racine', async ({ assert }) => {
    const roots = new NasRootsService([{ name: 'root', path: racine }])

    assert.isNull(await roots.resolve(join(dossier, 'dehors', 'secret.mp4')))
  })

  test('un fichier inexistant sous une racine valide rend null, sans lever', async ({ assert }) => {
    const roots = new NasRootsService([{ name: 'root', path: racine }])

    assert.isNull(await roots.resolve('films/absent.mp4'))
  })

  test('une racine non montée est ignorée, la suivante est essayée', async ({ assert }) => {
    const roots = new NasRootsService([
      { name: 'absente', path: join(dossier, 'jamais-monte') },
      { name: 'root', path: racine },
    ])

    const resolu = await roots.resolve('films/exemple.mp4')

    assert.isNotNull(resolu)
  })

  test('aucune racine configurée : tout rend null', async ({ assert }) => {
    const roots = new NasRootsService([])

    assert.isNull(await roots.resolve('films/exemple.mp4'))
  })
})
