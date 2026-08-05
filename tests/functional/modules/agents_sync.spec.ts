import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Agent from '#modules/agents/models/agent'
import { syncAgentsFromDeclarations } from '#modules/agents/services/agents_sync_service'

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
})
