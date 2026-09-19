import { test } from '@japa/runner'
import LeitnerTaxonomyDuplicatesService, {
  parseTaxonomyDuplicateGroups,
  taxonomyDuplicateMessages,
} from '#modules/leitner/services/leitner_taxonomy_duplicates_service'
import { LlmUnavailableError } from '#modules/leitner/services/llm_client'
import FakeLlmClient from '#tests/fakes/fake_llm_client'

const TAXONOMY = [
  { name: 'IA', themes: ['Modèles'] },
  { name: 'Réseau', themes: ['TLS'] },
]

function makeService(
  responder: string[] | ((messages: any, call: number) => string | Promise<string>)
) {
  const llm = new FakeLlmClient(responder)
  const catalog = {
    visibleTaxonomy: async () => TAXONOMY,
    categoryTree: async () => ({
      categories: TAXONOMY.map((category) => ({
        ...category,
        id: 1,
        cardCount: 0,
        themes: category.themes.map((name, index) => ({ id: index + 1, name, cardCount: 0 })),
      })),
      unclassifiedCount: 0,
    }),
  } as any
  return { llm, service: new LeitnerTaxonomyDuplicatesService(llm, catalog) }
}

test.group('Leitner / doublons sémantiques de taxonomie', () => {
  test('parse les groupes et canonise les noms visibles', ({ assert }) => {
    const groups = parseTaxonomyDuplicateGroups(
      JSON.stringify({
        groups: [
          {
            entries: [
              { category: ' ia ', theme: 'modèles' },
              { category: 'RÉSEAU', theme: 'tls' },
              { category: 'Inventée', theme: null },
            ],
            reason: 'Même domaine',
          },
        ],
      }),
      TAXONOMY
    )

    assert.deepEqual(groups, [
      {
        entries: [
          { category: 'IA', theme: 'Modèles' },
          { category: 'Réseau', theme: 'TLS' },
        ],
        reason: 'Même domaine',
      },
    ])
  })

  test('accepte une catégorie entière et rejette un groupe trop petit', ({ assert }) => {
    const groups = parseTaxonomyDuplicateGroups(
      '```json {"groups":[{"entries":[{"category":"IA","theme":null},{"category":"Réseau","theme":null}]},{"entries":[{"category":"IA","theme":"Modèles"}]}]} ```',
      TAXONOMY
    )

    assert.deepEqual(groups, [
      {
        entries: [
          { category: 'IA', theme: null },
          { category: 'Réseau', theme: null },
        ],
        reason: '',
      },
    ])
  })

  test('retourne null pour une sortie illisible', ({ assert }) => {
    assert.isNull(parseTaxonomyDuplicateGroups('pas du JSON', TAXONOMY))
  })

  test('envoie la taxonomie complète en un seul appel', async ({ assert }) => {
    const { llm, service } = makeService([
      '{"groups":[{"entries":[{"category":"IA","theme":null},{"category":"Réseau","theme":null}]}]}',
    ])

    const result = await service.find(42)

    assert.lengthOf(llm.calls, 1)
    assert.deepEqual(JSON.parse(llm.calls[0][1].content), {
      taxonomy: TAXONOMY,
      sparseThemes: [
        { category: 'IA', theme: 'Modèles', cardCount: 0 },
        { category: 'Réseau', theme: 'TLS', cardCount: 0 },
      ],
    })
    assert.lengthOf(result.groups, 1)
    assert.lengthOf(result.sparseThemes, 2)
    assert.equal(llm.options[0].json, true)
  })

  test('retombe silencieusement sur une liste vide si le LLM est indisponible', async ({
    assert,
  }) => {
    const { service } = makeService(() => {
      throw new LlmUnavailableError('serveur arrêté')
    })

    assert.deepEqual(await service.find(42), {
      groups: [],
      sparseThemes: [
        { category: 'IA', theme: 'Modèles', cardCount: 0 },
        { category: 'Réseau', theme: 'TLS', cardCount: 0 },
      ],
    })
  })

  test('décrit le contrat JSON dans le prompt', ({ assert }) => {
    const messages = taxonomyDuplicateMessages(TAXONOMY)
    assert.include(messages[0].content, 'groups')
    assert.include(messages[0].content, 'Ne crée aucun nom')
  })
})
