import { test } from '@japa/runner'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadAgentsFile } from '#modules/agents/services/agents_file_service'

/**
 * Lecture réelle du disque (CC-141) — un fichier temporaire par test, jamais de mock de `fs` :
 * c'est le comportement de Node face à un ENOENT, un JSON cassé et un schéma invalide qu'on
 * veut prouver, pas une hypothèse dessus.
 */
test.group('Agents / fichier de déclaration', (group) => {
  let dossier: string

  group.each.setup(async () => {
    dossier = await mkdtemp(join(tmpdir(), 'cc-agents-'))
    return () => rm(dossier, { recursive: true, force: true })
  })

  test('fichier absent → module vide, pas une erreur', async ({ assert }) => {
    const resultat = await loadAgentsFile(join(dossier, 'inexistant.json'))

    assert.deepEqual(resultat, { ok: true, declarations: [] })
  })

  test('fichier valide → déclarations analysées', async ({ assert }) => {
    const chemin = join(dossier, 'agents.json')
    await writeFile(
      chemin,
      JSON.stringify({ agents: [{ name: 'Veille', framework: 'Hermes', config: {} }] })
    )

    const resultat = await loadAgentsFile(chemin)

    assert.isTrue(resultat.ok)
    if (resultat.ok) {
      assert.deepEqual(resultat.declarations, [{ name: 'Veille', framework: 'Hermes', config: {} }])
    }
  })

  test('JSON invalide → erreur, jamais un tableau vide silencieux', async ({ assert }) => {
    const chemin = join(dossier, 'agents.json')
    await writeFile(chemin, '{ ceci n’est pas du JSON')

    const resultat = await loadAgentsFile(chemin)

    assert.isFalse(resultat.ok)
    if (!resultat.ok) assert.match(resultat.error, /JSON valide/)
  })

  test('JSON valide mais schéma invalide → erreur', async ({ assert }) => {
    const chemin = join(dossier, 'agents.json')
    await writeFile(chemin, JSON.stringify({ agents: [{ framework: 'Hermes' }] }))

    const resultat = await loadAgentsFile(chemin)

    assert.isFalse(resultat.ok)
    if (!resultat.ok) assert.match(resultat.error, /name/)
  })
})
