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
 *
 * ⚠️ **Le statut de la réponse est asserté, et ce n'est pas décoratif.** Sans lui, une route
 * renommée, retirée ou fermée par un middleware ferait passer ces tests **exactement de la même
 * façon** : la base est évidemment inchangée quand la requête n'atteint jamais le contrôleur. On
 * prouverait « rien ne s'est écrit » sans avoir prouvé « la route a tourné », ce qui est le
 * faux-négatif silencieux décrit dans le `CLAUDE.md` racine — un test au vert qui n'a rien comparé.
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

    const response = await client
      .post(`/agents/${agent.id}/run`)
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)
      .json({ config: { command: 'echo pirate' } })

    response.assertStatus(302)

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

    const response = await client
      .post(`/agents/${agent.id}/stop`)
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)
      .json({ config: { command: 'echo pirate' } })

    response.assertStatus(302)

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

    const response = await client
      .get('/agents')
      .loginAs(admin)
      .qs({ id: agent.id, config: { command: 'pirate' } })

    response.assertStatus(200)

    await agent.refresh()
    assert.deepEqual(agent.config, { command: 'echo legitime' })
  })
})
