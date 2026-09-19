import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'
import { createUserWith } from '#tests/helpers/users'

test.group('Leitner / organisation des cartes', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('rend l’arbre visible avec les compteurs de cartes', async ({ client, assert }) => {
    const user = await createUserWith(['leitner.view'])
    const category = await LeitnerCategory.create({ name: 'DevOps', ownerId: user.id })
    const theme = await LeitnerTheme.create({
      name: 'Docker',
      leitnerCategoryId: category.id,
      ownerId: user.id,
    })
    await LeitnerCard.create({
      front: 'Conteneur',
      back: 'Image',
      leitnerThemeId: theme.id,
      ownerId: user.id,
    })

    const response = await client.get('/revision/organisation').loginAs(user).withInertia()

    response.assertStatus(200)
    response.assertInertiaComponent('modules/leitner/organisation')
    const props = response.inertiaProps as { categories: Array<any> }
    assert.deepEqual(props.categories, [
      {
        id: category.id,
        name: 'DevOps',
        cardCount: 1,
        themes: [{ id: theme.id, name: 'Docker', cardCount: 1 }],
      },
    ])
  })

  test('retourne un état vide sans inventer de catégorie', async ({ client, assert }) => {
    const user = await createUserWith(['leitner.view'])
    const response = await client.get('/revision/organisation').loginAs(user).withInertia()

    response.assertStatus(200)
    assert.deepEqual((response.inertiaProps as { categories: unknown[] }).categories, [])
  })

  test('ne révèle pas la taxonomie privée d’un autre compte', async ({ client, assert }) => {
    const owner = await createUserWith(['leitner.view'])
    const viewer = await createUserWith(['leitner.view'])
    await LeitnerCategory.create({ name: 'Privée', ownerId: owner.id, isShared: false })

    const response = await client.get('/revision/organisation').loginAs(viewer).withInertia()

    response.assertStatus(200)
    assert.deepEqual((response.inertiaProps as { categories: unknown[] }).categories, [])
  })
})
