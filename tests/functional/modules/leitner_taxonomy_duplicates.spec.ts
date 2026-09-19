import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import app from '@adonisjs/core/services/app'
import LlmClient, { LlmUnavailableError } from '#modules/leitner/services/llm_client'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'
import FakeLlmClient from '#tests/fakes/fake_llm_client'
import { createUserWith } from '#tests/helpers/users'

test.group('Leitner / rapport de doublons de taxonomie', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.teardown(() => app.container.restore(LlmClient))

  test('retourne les groupes suspects sans écrire', async ({ client, assert }) => {
    const user = await createUserWith(['leitner.view', 'leitner.taxonomy.write'])
    const category = await LeitnerCategory.create({ name: 'IA', ownerId: user.id })
    await LeitnerTheme.create({ name: 'Modèles', leitnerCategoryId: category.id, ownerId: user.id })
    const other = await LeitnerCategory.create({
      name: 'Intelligence Artificielle',
      ownerId: user.id,
    })
    await LeitnerTheme.create({
      name: 'LLM',
      leitnerCategoryId: other.id,
      ownerId: user.id,
    })
    app.container.swap(
      LlmClient,
      () =>
        new FakeLlmClient([
          JSON.stringify({
            groups: [
              {
                entries: [
                  { category: 'IA', theme: 'Modèles' },
                  { category: 'Intelligence Artificielle', theme: 'LLM' },
                ],
                reason: 'Même domaine',
              },
            ],
          }),
        ])
    )

    const beforeCategories = await LeitnerCategory.all()
    const beforeThemes = await LeitnerTheme.all()
    const response = await client
      .post('/revision/settings/taxonomy/duplicates')
      .loginAs(user)
      .withCsrfToken()

    response.assertStatus(200)
    response.assertBodyContains({
      groups: [
        {
          entries: [
            { category: 'IA', theme: 'Modèles' },
            { category: 'Intelligence Artificielle', theme: 'LLM' },
          ],
          reason: 'Même domaine',
        },
      ],
    })
    assert.lengthOf(await LeitnerCategory.all(), beforeCategories.length)
    assert.lengthOf(await LeitnerTheme.all(), beforeThemes.length)
  })

  test('renvoie une liste vide sans bloquer si le LLM est indisponible', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['leitner.view', 'leitner.taxonomy.write'])
    app.container.swap(
      LlmClient,
      () =>
        new FakeLlmClient(() => {
          throw new LlmUnavailableError('indisponible')
        })
    )

    const response = await client
      .post('/revision/settings/taxonomy/duplicates')
      .loginAs(user)
      .withCsrfToken()

    response.assertStatus(200)
    assert.deepEqual(response.body(), { groups: [], sparseThemes: [] })
  })

  test('ferme la route sans la capacité de taxonomie', async ({ client }) => {
    const user = await createUserWith(['leitner.view'])

    const response = await client
      .post('/revision/settings/taxonomy/duplicates')
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(403)
  })
})
