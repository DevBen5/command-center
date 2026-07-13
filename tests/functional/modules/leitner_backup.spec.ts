import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#core/auth/models/user'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import LeitnerReview from '#modules/leitner/models/leitner_review'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'
import type { ImportReport } from '#modules/leitner/services/leitner_backup_service'

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

test.group('Leitner / import JSON', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function login() {
    return User.create({
      fullName: 'Utilisateur Test',
      email: 'test@example.com',
      password: 'secret123',
    })
  }

  /** Poste un fichier JSON comme le ferait le formulaire de `/revision/settings`. */
  function upload(
    client: ApiClient,
    user: User,
    content: string | object,
    mode: 'merge' | 'replace' = 'merge'
  ) {
    const body = typeof content === 'string' ? content : JSON.stringify(content)

    return client
      .post('/revision/import')
      .file('file', Buffer.from(body, 'utf-8'), { filename: 'sauvegarde.json' })
      .field('mode', mode)
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)
  }

  /** L'état complet de la base, tel qu'une restauration doit le rendre à l'identique. */
  async function snapshot() {
    const cards = await LeitnerCard.query()
      .preload('theme', (theme) => theme.preload('category'))
      .preload('reviews', (reviews) => reviews.orderBy('reviewed_at', 'asc'))
      .orderBy('front', 'asc')

    const categories = await LeitnerCategory.query().preload('themes').orderBy('name')

    return {
      categories: categories.map((category) => ({
        name: category.name,
        themes: category.themes.map((theme) => theme.name).sort(),
      })),
      cards: cards.map((card) => ({
        front: card.front,
        back: card.back,
        box: card.box,
        nextReview: card.nextReview.toISODate(),
        createdAt: card.createdAt.toISO(),
        updatedAt: card.updatedAt.toISO(),
        category: card.theme?.category.name ?? null,
        theme: card.theme?.name ?? null,
        reviews: card.reviews.map((review) => ({
          grade: review.grade,
          reviewedAt: review.reviewedAt.toISO(),
        })),
      })),
    }
  }

  /**
   * LE test : c'est lui qui valide la promesse d'assurance. Tout le reste est du détail.
   * Export → base vidée → import en remplacement → la base est identique.
   */
  test('aller-retour : une base vidée puis restaurée est identique à elle-même', async ({
    client,
    assert,
  }) => {
    const user = await login()

    const devops = await LeitnerCategory.create({ name: 'DevOps' })
    const docker = await LeitnerTheme.create({ leitnerCategoryId: devops.id, name: 'Docker' })
    await LeitnerTheme.create({ leitnerCategoryId: devops.id, name: 'Kubernetes' })
    // Une catégorie sans thème : un classement vide est légitime, il doit survivre.
    await LeitnerCategory.create({ name: 'Réseau' })

    const revisee = await LeitnerCard.create({
      front: 'Rôle du handshake TLS ?',
      back: 'Négocier clés et algorithmes.',
      box: 3,
      leitnerThemeId: docker.id,
      nextReview: DateTime.fromISO('2026-07-20'),
      createdAt: DateTime.fromISO('2026-07-01T08:00:00.000Z'),
      updatedAt: DateTime.fromISO('2026-07-10T09:30:00.000Z'),
    })
    await LeitnerReview.create({
      leitnerCardId: revisee.id,
      grade: 'good',
      reviewedAt: DateTime.fromISO('2026-07-05T09:02:00.000Z'),
    })
    await LeitnerReview.create({
      leitnerCardId: revisee.id,
      grade: 'hard',
      reviewedAt: DateTime.fromISO('2026-07-10T09:30:00.000Z'),
    })
    await LeitnerCard.create({
      front: 'Carte non classée',
      back: 'Sans thème.',
      box: 1,
      nextReview: DateTime.fromISO('2026-07-13'),
    })

    const avant = await snapshot()
    const exported = await client.get('/revision/export').loginAs(user)
    const backup = JSON.parse(exported.text())

    // `docker compose down -v` du pauvre.
    await LeitnerCard.query().delete()
    await LeitnerCategory.query().delete()
    assert.lengthOf(await LeitnerCard.all(), 0)

    const response = await upload(client, user, backup, 'replace')
    response.assertStatus(302)

    assert.deepEqual(await snapshot(), avant)
  })

  test('un fichier écrit à la main : recto, verso et thème suffisent', async ({
    client,
    assert,
  }) => {
    const user = await login()

    const response = await upload(client, user, {
      cards: [
        {
          front: 'Que fait `docker compose down -v` ?',
          back: 'Il supprime les volumes — donc vos cartes.',
          category: 'DevOps',
          theme: 'Docker',
        },
      ],
    })

    response.assertStatus(302)

    const card = await LeitnerCard.query()
      .preload('theme', (t) => t.preload('category'))
      .firstOrFail()
    // Valeurs d'une carte créée depuis l'UI : boîte 1, due aujourd'hui.
    assert.equal(card.box, 1)
    assert.equal(card.nextReview.toISODate(), DateTime.now().toISODate())
    // La taxonomie absente est créée à la volée.
    assert.equal(card.theme.name, 'Docker')
    assert.equal(card.theme.category.name, 'DevOps')
  })

  test('fusion : le contenu existant survit et la catégorie déjà présente est réutilisée', async ({
    client,
    assert,
  }) => {
    const user = await login()
    const devops = await LeitnerCategory.create({ name: 'DevOps' })
    const docker = await LeitnerTheme.create({ leitnerCategoryId: devops.id, name: 'Docker' })
    await LeitnerCard.create({
      front: 'Carte déjà là',
      back: 'Elle doit survivre.',
      box: 4,
      leitnerThemeId: docker.id,
      nextReview: DateTime.fromISO('2026-08-01'),
    })

    await upload(client, user, {
      categories: [{ name: 'DevOps', themes: ['Docker', 'Kubernetes'] }],
      cards: [{ front: 'Nouvelle carte', back: 'Ajoutée.', category: 'DevOps', theme: 'Docker' }],
    })

    // Une seule catégorie « DevOps » : elle est réutilisée, jamais dupliquée
    // (leitner_categories.name est unique).
    assert.lengthOf(await LeitnerCategory.all(), 1)
    assert.lengthOf(await LeitnerTheme.all(), 2)

    const ancienne = await LeitnerCard.findByOrFail('front', 'Carte déjà là')
    assert.equal(ancienne.box, 4)
    assert.equal(ancienne.nextReview.toISODate(), '2026-08-01')
    assert.lengthOf(await LeitnerCard.all(), 2)
  })

  test('fusion : un recto déjà présent sous le même thème est ignoré, ici comme dans le fichier', async ({
    client,
    assert,
  }) => {
    const user = await login()
    const devops = await LeitnerCategory.create({ name: 'DevOps' })
    const docker = await LeitnerTheme.create({ leitnerCategoryId: devops.id, name: 'Docker' })
    await LeitnerCard.create({
      front: 'Image ou conteneur ?',
      back: 'Déjà en base.',
      box: 2,
      leitnerThemeId: docker.id,
      nextReview: DateTime.fromISO('2026-07-20'),
    })

    const response = await upload(client, user, {
      cards: [
        // Doublon de l'existant.
        {
          front: 'Image ou conteneur ?',
          back: 'Autre verso.',
          category: 'DevOps',
          theme: 'Docker',
        },
        // Doublon interne au fichier.
        { front: 'Nouvelle', back: 'A.', category: 'DevOps', theme: 'Docker' },
        { front: 'Nouvelle', back: 'B.', category: 'DevOps', theme: 'Docker' },
        // Même recto, mais sous un autre thème : ce n'est pas la même carte.
        {
          front: 'Image ou conteneur ?',
          back: 'Sous Kubernetes.',
          category: 'DevOps',
          theme: 'Kubernetes',
        },
      ],
    })

    const report = response.flashMessages().importReport as ImportReport
    assert.equal(report.cardsCreated, 2)
    assert.equal(report.cardsSkipped, 2)

    // L'existante n'a pas été écrasée.
    const existante = await LeitnerCard.findByOrFail('back', 'Déjà en base.')
    assert.equal(existante.box, 2)
    assert.lengthOf(await LeitnerCard.all(), 3)
  })

  test('remplacement : le fichier est rechargé fidèlement, doublons compris', async ({
    client,
    assert,
  }) => {
    const user = await login()

    // Deux cartes réellement identiques : l'UI le permet, la restauration doit les rendre.
    await upload(
      client,
      user,
      {
        cards: [
          { front: 'Même recto', back: 'Un.', category: 'DevOps', theme: 'Docker' },
          { front: 'Même recto', back: 'Deux.', category: 'DevOps', theme: 'Docker' },
        ],
      },
      'replace'
    )

    assert.lengthOf(await LeitnerCard.all(), 2)
  })

  test('une boîte hors de 1..5 est refusée : sans ce garde-fou, la carte serait éternellement due', async ({
    client,
    assert,
  }) => {
    const user = await login()

    const response = await upload(client, user, {
      cards: [{ front: 'Recto', back: 'Verso', box: 12 }],
    })

    response.assertStatus(302)
    assert.lengthOf(await LeitnerCard.all(), 0)
    assert.isNotEmpty(response.flashMessages().importErrors)
  })

  test('rien n’est écrit quand le fichier est invalide', async ({ client, assert }) => {
    const user = await login()

    const invalides: [string, string | object][] = [
      ['JSON cassé', '{ "cards": [ '],
      [
        'note inconnue',
        {
          cards: [
            {
              front: 'A',
              back: 'B',
              reviews: [{ grade: 'parfait', reviewedAt: '2026-07-13T09:00:00Z' }],
            },
          ],
        },
      ],
      ['date bidon', { cards: [{ front: 'A', back: 'B', nextReview: '2026-02-31' }] }],
      ['horodatage bidon', { cards: [{ front: 'A', back: 'B', createdAt: 'hier matin' }] }],
      ['recto vide', { cards: [{ front: '   ', back: 'B' }] }],
      ['thème sans catégorie', { cards: [{ front: 'A', back: 'B', theme: 'Docker' }] }],
      ['version inconnue', { version: 2, cards: [{ front: 'A', back: 'B' }] }],
    ]

    for (const [libelle, contenu] of invalides) {
      const response = await upload(client, user, contenu)

      response.assertStatus(302)
      assert.isNotEmpty(response.flashMessages().importErrors, `${libelle} : erreur attendue`)
      assert.lengthOf(await LeitnerCard.all(), 0, `${libelle} : la base doit rester vide`)
      assert.lengthOf(
        await LeitnerCategory.all(),
        0,
        `${libelle} : aucune catégorie ne doit rester`
      )
    }
  })

  test("un fichier à moitié valide n'écrit rien : l'import est transactionnel", async ({
    client,
    assert,
  }) => {
    const user = await login()

    // La 3ᵉ carte casse. Sans transaction, les deux premières resteraient en base.
    const response = await upload(client, user, {
      cards: [
        { front: 'Une', back: 'A', category: 'DevOps', theme: 'Docker' },
        { front: 'Deux', back: 'B', category: 'DevOps', theme: 'Docker' },
        { front: 'Trois', back: 'C', theme: 'Docker' },
      ],
    })

    response.assertStatus(302)
    assert.lengthOf(await LeitnerCard.all(), 0)
    // La taxonomie créée en chemin est annulée elle aussi.
    assert.lengthOf(await LeitnerCategory.all(), 0)
    assert.isNotEmpty(response.flashMessages().importErrors)
  })
})
