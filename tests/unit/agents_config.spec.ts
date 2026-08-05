import { test } from '@japa/runner'
import {
  AGENTS_CONFIG_DEFAULT_PATH,
  agentsConfigPathFrom,
  parseAgentsDeclarations,
} from '#config/agents'

/**
 * Validation pure du fichier de déclaration des agents (CC-141) — aucun fs, aucune base : ce
 * que `agents_file_service.ts` délègue une fois le JSON désérialisé.
 */
test.group('Agents / config — chemin', () => {
  test('défaut quand la variable est absente ou vide', ({ assert }) => {
    assert.equal(agentsConfigPathFrom(undefined), AGENTS_CONFIG_DEFAULT_PATH)
    assert.equal(agentsConfigPathFrom(''), AGENTS_CONFIG_DEFAULT_PATH)
  })

  test('reprend la valeur fournie telle quelle', ({ assert }) => {
    assert.equal(agentsConfigPathFrom('/data/agents.json'), '/data/agents.json')
  })
})

test.group('Agents / config — parseAgentsDeclarations', () => {
  test('accepte un fichier valide, config par défaut vide', ({ assert }) => {
    const declarations = parseAgentsDeclarations({
      agents: [
        { name: 'Veille', framework: 'Hermes', config: { command: 'echo ok' } },
        { name: 'Sans config', framework: 'Hermes' },
      ],
    })

    assert.deepEqual(declarations, [
      { name: 'Veille', framework: 'Hermes', config: { command: 'echo ok' } },
      { name: 'Sans config', framework: 'Hermes', config: {} },
    ])
  })

  test('un fichier vide de tout agent est valide', ({ assert }) => {
    assert.deepEqual(parseAgentsDeclarations({ agents: [] }), [])
  })

  test('rejette une racine qui n’est pas un objet', ({ assert }) => {
    assert.throws(() => parseAgentsDeclarations([]), /objet JSON/)
    assert.throws(() => parseAgentsDeclarations('agents'), /objet JSON/)
    assert.throws(() => parseAgentsDeclarations(null), /objet JSON/)
  })

  test('rejette "agents" absent ou non tableau', ({ assert }) => {
    assert.throws(() => parseAgentsDeclarations({}), /tableau/)
    assert.throws(() => parseAgentsDeclarations({ agents: 'x' }), /tableau/)
  })

  test('rejette une entrée sans name ou sans framework', ({ assert }) => {
    assert.throws(() => parseAgentsDeclarations({ agents: [{ framework: 'Hermes' }] }), /name/)
    assert.throws(() => parseAgentsDeclarations({ agents: [{ name: 'Veille' }] }), /framework/)
    assert.throws(
      () => parseAgentsDeclarations({ agents: [{ name: '  ', framework: 'Hermes' }] }),
      /name/
    )
  })

  test('rejette un config qui n’est pas un objet', ({ assert }) => {
    assert.throws(
      () =>
        parseAgentsDeclarations({ agents: [{ name: 'Veille', framework: 'Hermes', config: [] }] }),
      /config/
    )
    assert.throws(
      () =>
        parseAgentsDeclarations({ agents: [{ name: 'Veille', framework: 'Hermes', config: 'x' }] }),
      /config/
    )
  })

  test('rejette un nom en double', ({ assert }) => {
    assert.throws(
      () =>
        parseAgentsDeclarations({
          agents: [
            { name: 'Veille', framework: 'Hermes' },
            { name: 'Veille', framework: 'Autre' },
          ],
        }),
      /double/
    )
  })
})
