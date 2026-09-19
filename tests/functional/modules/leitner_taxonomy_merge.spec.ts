import db from '@adonisjs/lucid/services/db'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'
import LeitnerTaxonomyMergeService from '#modules/leitner/services/leitner_taxonomy_merge_service'
import { createUserWith } from '#tests/helpers/users'

test.group('Leitner / fusion de taxonomie', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('fusionne une catégorie et ses thèmes homonymes en réattachant les cartes', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['leitner.view', 'leitner.taxonomy.write'])
    const source = await LeitnerCategory.create({ name: 'IA courte', ownerId: user.id })
    const target = await LeitnerCategory.create({ name: 'IA longue', ownerId: user.id })
    const sourceTheme = await LeitnerTheme.create({
      name: 'Modèles',
      leitnerCategoryId: source.id,
      ownerId: user.id,
    })
    const targetTheme = await LeitnerTheme.create({
      name: 'modèles',
      leitnerCategoryId: target.id,
      ownerId: user.id,
    })
    const otherTheme = await LeitnerTheme.create({
      name: 'Réseaux',
      leitnerCategoryId: source.id,
      ownerId: user.id,
    })
    await LeitnerCard.create({
      front: 'Carte collision',
      back: 'Verso',
      leitnerThemeId: sourceTheme.id,
      ownerId: user.id,
    })
    await LeitnerCard.create({
      front: 'Carte déplacée',
      back: 'Verso',
      leitnerThemeId: otherTheme.id,
      ownerId: user.id,
    })

    const preview = await client
      .post('/revision/settings/taxonomy/merge/preview')
      .json({ kind: 'category', sourceId: source.id, targetId: target.id })
      .loginAs(user)
      .withCsrfToken()
    preview.assertStatus(200)
    preview.assertBodyContains({ collisionCount: 1, cardsToMove: 2 })

    const response = await client
      .post('/revision/settings/taxonomy/merge')
      .json({ kind: 'category', sourceId: source.id, targetId: target.id })
      .loginAs(user)
      .withCsrfToken()
    response.assertStatus(200)

    assert.isNull(await LeitnerCategory.find(source.id))
    assert.isNull(await LeitnerTheme.find(sourceTheme.id))
    const survivingTheme = await LeitnerTheme.findOrFail(targetTheme.id)
    const movedTheme = await LeitnerTheme.findOrFail(otherTheme.id)
    assert.equal(survivingTheme.leitnerCategoryId, target.id)
    assert.equal(movedTheme.leitnerCategoryId, target.id)
    assert.lengthOf(await LeitnerCard.query().where('leitner_theme_id', targetTheme.id), 1)
  })

  test('fusionne deux thèmes dans le sens demandé', async ({ assert }) => {
    const user = await createUserWith(['leitner.view', 'leitner.taxonomy.write'])
    const category = await LeitnerCategory.create({ name: 'Réseau', ownerId: user.id })
    const source = await LeitnerTheme.create({
      name: 'TLS ancien',
      leitnerCategoryId: category.id,
      ownerId: user.id,
    })
    const target = await LeitnerTheme.create({
      name: 'TLS',
      leitnerCategoryId: category.id,
      ownerId: user.id,
    })
    await LeitnerCard.create({
      front: 'Handshake',
      back: 'Clés',
      leitnerThemeId: source.id,
      ownerId: user.id,
    })

    await new LeitnerTaxonomyMergeService().merge(
      { kind: 'theme', sourceId: source.id, targetId: target.id },
      user.id
    )

    assert.isNull(await LeitnerTheme.find(source.id))
    assert.lengthOf(await LeitnerCard.query().where('leitner_theme_id', target.id), 1)
  })

  test('refuse une source étrangère avant toute écriture', async ({ client, assert }) => {
    const owner = await createUserWith(['leitner.view', 'leitner.taxonomy.write'])
    const stranger = await createUserWith(['leitner.view', 'leitner.taxonomy.write'])
    const source = await LeitnerCategory.create({ name: 'Privée', ownerId: owner.id })
    const target = await LeitnerCategory.create({ name: 'Mienne', ownerId: stranger.id })

    const response = await client
      .post('/revision/settings/taxonomy/merge')
      .json({ kind: 'category', sourceId: source.id, targetId: target.id })
      .loginAs(stranger)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(403)
    assert.isNotNull(await LeitnerCategory.find(source.id))
  })

  test('ferme les deux routes sans la capacité de taxonomie', async ({ client }) => {
    const user = await createUserWith(['leitner.view'])
    const response = await client
      .post('/revision/settings/taxonomy/merge/preview')
      .json({ kind: 'category', sourceId: 1, targetId: 2 })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(403)
  })

  test('rollbacke le réattachement si la suppression finale échoue', async ({ assert }) => {
    const user = await createUserWith(['leitner.view', 'leitner.taxonomy.write'])
    const source = await LeitnerCategory.create({ name: 'Source', ownerId: user.id })
    const target = await LeitnerCategory.create({ name: 'Cible', ownerId: user.id })
    const theme = await LeitnerTheme.create({
      name: 'Thème',
      leitnerCategoryId: source.id,
      ownerId: user.id,
    })
    const card = await LeitnerCard.create({
      front: 'Rollback',
      back: 'Verso',
      leitnerThemeId: theme.id,
      ownerId: user.id,
    })

    await db.rawQuery(`
      CREATE OR REPLACE FUNCTION cc214_fail_category_delete() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'CC-214 rollback'; END;
      $$ LANGUAGE plpgsql
    `)
    await db.rawQuery(`
      CREATE TRIGGER cc214_fail_category_delete
      BEFORE DELETE ON leitner_categories
      FOR EACH ROW EXECUTE FUNCTION cc214_fail_category_delete()
    `)

    try {
      await assert.rejects(
        () =>
          new LeitnerTaxonomyMergeService().merge(
            { kind: 'category', sourceId: source.id, targetId: target.id },
            user.id
          ),
        /CC-214 rollback/
      )
    } finally {
      await db.rawQuery('DROP TRIGGER IF EXISTS cc214_fail_category_delete ON leitner_categories')
      await db.rawQuery('DROP FUNCTION IF EXISTS cc214_fail_category_delete()')
    }

    const restoredCard = await LeitnerCard.findOrFail(card.id)
    assert.equal(restoredCard.leitnerThemeId, theme.id)
    assert.isNotNull(await LeitnerCategory.find(source.id))
    assert.isNotNull(await LeitnerTheme.find(theme.id))
  })
})
