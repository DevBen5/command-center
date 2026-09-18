import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Agent from '#modules/agents/models/agent'
import AgentRunnerService from '#modules/agents/services/agent_runner_service'

type CommandRunner = (command: string) => Promise<{ stdout: string; stderr: string }>

function lanceurFactice(
  appels: string[],
  resultat: { stdout: string; stderr: string } = { stdout: '', stderr: '' }
): CommandRunner {
  return async (command) => {
    appels.push(command)
    return resultat
  }
}

function lanceurEnEchec(appels: string[], erreur: Error): CommandRunner {
  return async (command) => {
    appels.push(command)
    throw erreur
  }
}

test.group('Agents / AgentRunnerService', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('run() journalise le lancement et les sorties du lanceur injecté', async ({ assert }) => {
    const agent = await Agent.create({
      name: 'Veille',
      framework: 'Hermes',
      config: { command: 'agent --run' },
    })
    const appels: string[] = []

    await new AgentRunnerService(
      lanceurFactice(appels, { stdout: 'sortie\n', stderr: 'alerte\n' })
    ).run(agent)

    assert.deepEqual(appels, ['agent --run'])
    assert.equal(agent.status, 'active')
    assert.isTrue(agent.logs.some((ligne) => ligne.includes('$ agent --run')))
    assert.include(agent.logs, 'sortie')
    assert.include(agent.logs, 'alerte')
  })

  test('run() en échec garde volontairement l’agent running', async ({ assert }) => {
    const agent = await Agent.create({
      name: 'Commande absente',
      framework: 'Hermes',
      config: { command: 'agent --run' },
    })
    const appels: string[] = []

    await new AgentRunnerService(lanceurEnEchec(appels, new Error('agent introuvable'))).run(agent)

    assert.deepEqual(appels, ['agent --run'])
    // Un échec simule un lancement en cours sur le poste de développement : ne pas le « corriger ».
    assert.equal(agent.status, 'running')
    assert.isTrue(
      agent.logs.some((ligne) => ligne.includes('Lancement simulé : agent introuvable'))
    )
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
      config: { command: 'agent --run' },
      logs: Array.from({ length: 199 }, (_, i) => `ligne ${i}`),
    })

    await new AgentRunnerService(lanceurFactice([])).run(agent)

    assert.lengthOf(agent.logs, 200)
  })

  test('recentLogs() rend les 100 dernières lignes par défaut et respecte la limite demandée', async ({
    assert,
  }) => {
    const logs = Array.from({ length: 105 }, (_, i) => `ligne ${i + 1}`)
    const agent = await Agent.create({
      name: 'Historique',
      framework: 'Hermes',
      config: {},
      logs,
    })
    const service = new AgentRunnerService(lanceurFactice([]))

    assert.deepEqual(service.recentLogs(agent), logs.slice(-100))
    assert.deepEqual(service.recentLogs(agent, 3), ['ligne 103', 'ligne 104', 'ligne 105'])
  })
})
