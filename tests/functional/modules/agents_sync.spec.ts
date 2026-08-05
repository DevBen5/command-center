import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Agent from '#modules/agents/models/agent'
import {
  syncAgentsFromDeclarations,
  syncAgentsFromFile,
} from '#modules/agents/services/agents_sync_service'

/**
 * La synchronisation déclarative en base (CC-141) — contre une vraie base Postgres de test, pas
 * une hypothèse sur ce que ferait Lucid. `app/modules/agents/CLAUDE.md` documente le contrat :
 * crée les agents déclarés absents, met à jour ceux qui existent (statut/logs préservés), et
 * SUPPRIME ceux qui ne sont plus déclarés.
 */
test.group('Agents / synchronisation depuis le fichier', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('crée les agents déclarés absents de la base', async ({ assert }) => {
    const resultat = await syncAgentsFromDeclarations([
      { name: 'Veille', framework: 'Hermes', config: { command: 'echo ok' } },
    ])

    assert.deepEqual(resultat, { created: 1, updated: 0, deleted: 0 })

    const agent = await Agent.findByOrFail('name', 'Veille')
    assert.equal(agent.framework, 'Hermes')
    assert.deepEqual(agent.config, { command: 'echo ok' })
    assert.equal(agent.status, 'idle')
    assert.deepEqual(agent.logs, [])
  })

  test('met à jour un agent existant sans toucher status/logs', async ({ assert }) => {
    const existant = await Agent.create({
      name: 'Veille',
      framework: 'Ancien',
      config: { command: 'ancien' },
      status: 'running',
      logs: ['ligne précédente'],
    })

    await syncAgentsFromDeclarations([
      { name: 'Veille', framework: 'Hermes', config: { command: 'nouveau' } },
    ])

    await existant.refresh()
    assert.equal(existant.framework, 'Hermes')
    assert.deepEqual(existant.config, { command: 'nouveau' })
    assert.equal(
      existant.status,
      'running',
      'le statut ne doit pas être réinitialisé par la synchro'
    )
    assert.deepEqual(
      existant.logs,
      ['ligne précédente'],
      'les logs doivent survivre à une mise à jour'
    )
  })

  test('supprime un agent qui n’est plus déclaré', async ({ assert }) => {
    await Agent.create({ name: 'À retirer', framework: 'Hermes', config: {} })
    await Agent.create({ name: 'Conservé', framework: 'Hermes', config: {} })

    const resultat = await syncAgentsFromDeclarations([
      { name: 'Conservé', framework: 'Hermes', config: {} },
    ])

    assert.equal(resultat.deleted, 1)
    assert.isNull(await Agent.findBy('name', 'À retirer'))
    assert.isNotNull(await Agent.findBy('name', 'Conservé'))
  })

  test('une liste vide supprime tous les agents existants', async ({ assert }) => {
    await Agent.create({ name: 'Seul', framework: 'Hermes', config: {} })

    const resultat = await syncAgentsFromDeclarations([])

    assert.equal(resultat.deleted, 1)
    assert.lengthOf(await Agent.all(), 0)
  })

  /**
   * La distinction « fichier absent » / « fichier qui déclare zéro agent » — les deux produisent
   * la même liste vide, et c'est précisément pour ça qu'elle doit être prouvée : en production la
   * ligne de volume est commentée par défaut, donc « absent » est le cas standard, pas un cas
   * limite. S'il supprimait, un volume non monté effacerait les agents au premier redémarrage.
   */
  test('un fichier ABSENT ne supprime rien quand la base porte des agents', async ({ assert }) => {
    await Agent.create({ name: 'Survivant', framework: 'Hermes', config: { command: 'echo ok' } })

    const issue = await syncAgentsFromFile({ present: false, declarations: [] })

    assert.deepEqual(issue, { applied: false, existing: 1 })
    assert.isNotNull(
      await Agent.findBy('name', 'Survivant'),
      'un fichier absent ne doit jamais supprimer un agent existant'
    )
  })

  test('un fichier absent sur une base vide reste une synchro silencieuse', async ({ assert }) => {
    const issue = await syncAgentsFromFile({ present: false, declarations: [] })

    assert.isTrue(issue.applied, "l'installation neuve n'a rien à préserver — pas d'avertissement")
    assert.deepEqual(
      issue.applied && issue.result,
      { created: 0, updated: 0, deleted: 0 },
      'aucun mouvement à signaler'
    )
  })

  test('un fichier PRÉSENT qui déclare zéro agent supprime, lui', async ({ assert }) => {
    await Agent.create({ name: 'Retiré explicitement', framework: 'Hermes', config: {} })

    const issue = await syncAgentsFromFile({ present: true, declarations: [] })

    assert.deepEqual(issue, { applied: true, result: { created: 0, updated: 0, deleted: 1 } })
    assert.lengthOf(
      await Agent.all(),
      0,
      'vider par un fichier écrit reste un geste explicite, il doit fonctionner'
    )
  })

  test('un fichier présent et non vide synchronise normalement', async ({ assert }) => {
    await Agent.create({ name: 'Obsolète', framework: 'Hermes', config: {} })

    const issue = await syncAgentsFromFile({
      present: true,
      declarations: [{ name: 'Déclaré', framework: 'Hermes', config: { command: 'echo ok' } }],
    })

    assert.deepEqual(issue, { applied: true, result: { created: 1, updated: 0, deleted: 1 } })
  })
})
