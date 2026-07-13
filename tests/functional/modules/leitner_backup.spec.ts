import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#core/auth/models/user'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import LeitnerReview from '#modules/leitner/models/leitner_review'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'

/**
 * Les cartes n'existent qu'ici : l'export est le seul filet de sécurité du module.
 * Le fichier doit être autoportant (taxonomie par nom, aucun id) et se télécharger
 * hors Inertia — d'où l'assertion sur `content-disposition`.
 */
test.group('Leitner / export JSON', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function login() {
    return User.create({
      fullName: 'Utilisateur Test',
      email: 'test@example.com',
      password: 'secret123',
    })
  }

  /** Une carte révisée, classée sous DevOps · Docker. */
  async function seedCard() {
    const category = await LeitnerCategory.create({ name: 'DevOps' })
    const theme = await LeitnerTheme.create({ leitnerCategoryId: category.id, name: 'Docker' })
    await LeitnerTheme.create({ leitnerCategoryId: category.id, name: 'Kubernetes' })

    const card = await LeitnerCard.create({
      front: 'Rôle du handshake TLS ?',
      back: 'Négocier clés et algorithmes.',
      box: 3,
      leitnerThemeId: theme.id,
      nextReview: DateTime.fromISO('2026-07-20'),
    })
    await LeitnerReview.create({
      leitnerCardId: card.id,
      grade: 'good',
      reviewedAt: DateTime.fromISO('2026-07-13T09:02:00.000Z'),
    })

    return card
  }

  test('se télécharge en pièce jointe, avec un JSON parsable', async ({ client, assert }) => {
    const user = await login()
    await seedCard()

    const response = await client.get('/revision/export').loginAs(user)

    response.assertStatus(200)
    assert.include(response.header('content-type') ?? '', 'application/json')
    assert.include(response.header('content-disposition') ?? '', 'attachment')
    // Le corps est bien du JSON brut, pas une réponse Inertia.
    assert.doesNotThrow(() => JSON.parse(response.text()))
  })

  test('porte la carte, sa boîte, son échéance, son classement et son historique', async ({
    client,
    assert,
  }) => {
    const user = await login()
    await seedCard()

    const response = await client.get('/revision/export').loginAs(user)
    const backup = JSON.parse(response.text())

    assert.equal(backup.version, 1)
    assert.deepEqual(backup.categories, [{ name: 'DevOps', themes: ['Docker', 'Kubernetes'] }])

    assert.lengthOf(backup.cards, 1)
    const [card] = backup.cards
    assert.equal(card.front, 'Rôle du handshake TLS ?')
    assert.equal(card.back, 'Négocier clés et algorithmes.')
    assert.equal(card.box, 3)
    // Colonne `date` : jour calendaire, sans heure.
    assert.equal(card.nextReview, '2026-07-20')
    assert.equal(card.category, 'DevOps')
    assert.equal(card.theme, 'Docker')
    assert.deepEqual(
      card.reviews.map((review: { grade: string }) => review.grade),
      ['good']
    )
    // Sans les horodatages, l'ordre de la file de révision serait perdu à la restauration.
    assert.isString(card.createdAt)
    assert.isString(card.updatedAt)
  })

  test("une carte non classée n'emporte ni catégorie ni thème", async ({ client, assert }) => {
    const user = await login()
    await LeitnerCard.create({
      front: 'Orpheline',
      back: 'Sans thème.',
      box: 1,
      nextReview: DateTime.now(),
    })

    const response = await client.get('/revision/export').loginAs(user)
    const [card] = JSON.parse(response.text()).cards

    assert.notProperty(card, 'category')
    assert.notProperty(card, 'theme')
  })

  test('ne contient aucun id : la taxonomie est désignée par son nom', async ({
    client,
    assert,
  }) => {
    const user = await login()
    await seedCard()

    const response = await client.get('/revision/export').loginAs(user)

    // Réinjecter un id casserait les séquences Postgres au prochain ajout depuis l'UI.
    assert.notInclude(response.text(), '"id"')
    assert.notInclude(response.text(), 'leitnerThemeId')
    assert.notInclude(response.text(), 'leitner_theme_id')
  })
})
