import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Agent from '#modules/agents/models/agent'
import AgentRunnerService from '#modules/agents/services/agent_runner_service'

/**
 * Preuve que `run()`/`stop()` écrivent réellement dans `logs` (CC-141) — le critère de
 * validation du ticket exige que les agents « montrent des logs », ce qu'aucun test
 * n'exerçait avant ce lot (`logs` n'était jamais alimenté). `echo` est exécuté pour de vrai,
 * pas simulé : c'est la même commande que celle de `agents.json.example`, cross-plateforme via
 * le shell par défaut de `child_process.exec`.
 */
test.group('Agents / logs réels', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('run() capture la sortie réelle de la commande', async ({ assert }) => {
    const agent = await Agent.create({
      name: 'Veille',
      framework: 'Hermes',
      config: { command: 'echo agent-lance' },
    })

    await new AgentRunnerService().run(agent)

    assert.equal(agent.status, 'active')
    assert.isAbove(agent.logs.length, 0)
    assert.isTrue(agent.logs.some((ligne) => ligne.includes('agent-lance')))
  })

  test('run() sans commande configurée journalise le repli', async ({ assert }) => {
    const agent = await Agent.create({ name: 'Sans commande', framework: 'Hermes', config: {} })

    await new AgentRunnerService().run(agent)

    assert.equal(agent.status, 'running')
    assert.isAbove(agent.logs.length, 0)
    assert.isTrue(agent.logs.some((ligne) => ligne.includes('simulé')))
  })

  test('stop() journalise l’arrêt', async ({ assert }) => {
    const agent = await Agent.create({
      name: 'Veille',
      framework: 'Hermes',
      config: {},
      status: 'running',
    })

    await new AgentRunnerService().stop(agent)

    assert.equal(agent.status, 'idle')
    assert.isTrue(agent.logs.some((ligne) => ligne.includes('Arrêté')))
  })

  test('logs plafonnés à 200 entrées', async ({ assert }) => {
    const agent = await Agent.create({
      name: 'Veille',
      framework: 'Hermes',
      config: { command: 'echo x' },
      logs: Array.from({ length: 199 }, (_, i) => `ligne ${i}`),
    })

    await new AgentRunnerService().run(agent)

    assert.lengthOf(agent.logs, 200)
  })
})
