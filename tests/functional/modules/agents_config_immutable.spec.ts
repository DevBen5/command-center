import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Agent from '#modules/agents/models/agent'
import { createAdmin } from '#tests/helpers/users'

/**
 * L'exigence explicite du ticket CC-141 : aucun chemin de l'application ne doit pouvoir écrire
 * dans `agent.config` depuis une requête HTTP — seul le fichier de déclaration le peut (voir
 * `app/modules/agents/CLAUDE.md`, « Frontière de confiance »). Les trois routes existantes
 * (`index`, `run`, `stop`) ne lisent aucun champ `config` du corps de requête ; ce test le prouve
 * plutôt que de le supposer, y compris face à une tentative explicite de l'écraser.
 */
test.group('Agents / config — frontière de confiance', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('POST /agents/:id/run avec un payload de config n’écrit rien', async ({
    client,
    assert,
  }) => {
    const admin = await createAdmin()
    const agent = await Agent.create({
      name: 'Veille',
      framework: 'Hermes',
      config: { command: 'echo legitime' },
    })

    await client
      .post(`/agents/${agent.id}/run`)
      .loginAs(admin)
      .withCsrfToken()
      .json({ config: { command: 'echo pirate' } })

    await agent.refresh()
    assert.deepEqual(agent.config, { command: 'echo legitime' })
  })

  test('POST /agents/:id/stop avec un payload de config n’écrit rien', async ({
    client,
    assert,
  }) => {
    const admin = await createAdmin()
    const agent = await Agent.create({
      name: 'Veille',
      framework: 'Hermes',
      config: { command: 'echo legitime' },
      status: 'running',
    })

    await client
      .post(`/agents/${agent.id}/stop`)
      .loginAs(admin)
      .withCsrfToken()
      .json({ config: { command: 'echo pirate' } })

    await agent.refresh()
    assert.deepEqual(agent.config, { command: 'echo legitime' })
  })

  test('GET /agents ne touche à aucune config même avec un id forgé', async ({
    client,
    assert,
  }) => {
    const admin = await createAdmin()
    const agent = await Agent.create({
      name: 'Veille',
      framework: 'Hermes',
      config: { command: 'echo legitime' },
    })

    await client
      .get('/agents')
      .loginAs(admin)
      .qs({ id: agent.id, config: { command: 'pirate' } })

    await agent.refresh()
    assert.deepEqual(agent.config, { command: 'echo legitime' })
  })
})
