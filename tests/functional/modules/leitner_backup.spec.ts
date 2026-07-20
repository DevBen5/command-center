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
      answer: 'Négocier les clés de session.',
      verdict: 'partiel',
      latencyMs: 4_200,
      thinkingMs: 8_500,
      totalMs: 31_000,
    })
    // Juge éteint, mesure inexploitable : tout ce qui accompagne la note est `null`.
    await LeitnerReview.create({
      leitnerCardId: card.id,
      grade: 'hard',
      reviewedAt: DateTime.fromISO('2026-07-14T09:02:00.000Z'),
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
      ['good', 'hard']
    )
    // Sans les horodatages, l'ordre de la file de révision serait perdu à la restauration.
    assert.isString(card.createdAt)
    assert.isString(card.updatedAt)
  })

  /**
   * Les cinq colonnes de trace de `leitner_reviews`. `thinking_ms` n'est pas de
   * l'historique décoratif : c'est la référence à laquelle une nouvelle mesure se
   * compare pour proposer `easy`, `good` ou `hard`. Sans elle dans le fichier, une
   * restauration remet le raffinement à zéro et le rend **silencieusement inerte**
   * le temps de reconstituer 5 mesures par carte.
   */
  test('porte la réponse écrite, le verdict et les trois durées', async ({ client, assert }) => {
    const user = await login()
    await seedCard()

    const response = await client.get('/revision/export').loginAs(user)
    const [card] = JSON.parse(response.text()).cards
    const [jugee, nonJugee] = card.reviews

    assert.equal(jugee.answer, 'Négocier les clés de session.')
    assert.equal(jugee.verdict, 'partiel')
    assert.equal(jugee.latencyMs, 4_200)
    assert.equal(jugee.thinkingMs, 8_500)
    assert.equal(jugee.totalMs, 31_000)

    // Ce qui vaut `null` est omis plutôt qu'écrit : le fichier se relit à la main, et
    // l'absence porte le même sens que le `null` de la colonne.
    assert.notProperty(nonJugee, 'answer')
    assert.notProperty(nonJugee, 'verdict')
    assert.notProperty(nonJugee, 'latencyMs')
    assert.notProperty(nonJugee, 'thinkingMs')
    assert.notProperty(nonJugee, 'totalMs')
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
  function upload(client: ApiClient, user: User, content: string | object) {
    const body = typeof content === 'string' ? content : JSON.stringify(content)

    return client
      .post('/revision/import')
      .file('file', Buffer.from(body, 'utf-8'), { filename: 'sauvegarde.json' })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)
  }

  /**
   * L'état complet de la base, tel qu'une restauration doit le rendre à l'identique.
   *
   * ⚠️ **C'est cette fonction qui fait la valeur du test, pas l'aller-retour lui-même.**
   * Une colonne qu'elle ne lit pas peut être perdue par l'export sans qu'un seul test
   * ne rougisse : c'est exactement ce qui a laissé passer CC-51 (`answer`, `verdict`,
   * `latency_ms`, `thinking_ms`, `total_ms` sortaient de la base sans jamais y revenir,
   * suite verte). Une colonne ajoutée à `leitner_cards` ou `leitner_reviews` s'ajoute
   * **ici** dans le même lot, ou elle n'est pas sauvegardée.
   *
   * Le tri des révisions reprend celui de l'export (`reviewed_at`, puis `id`) : sur
   * deux révisions au même horodatage, `reviewed_at` seul rendrait un ordre arbitraire
   * et la comparaison serait instable.
   */
  async function snapshot() {
    const cards = await LeitnerCard.query()
      .preload('theme', (theme) => theme.preload('category'))
      .preload('reviews', (reviews) => reviews.orderBy('reviewed_at', 'asc').orderBy('id', 'asc'))
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
          // La trace de la réponse écrite. `null` est une valeur à part entière : il
          // doit se relire `null`, jamais `0` ni `''`.
          answer: review.answer,
          verdict: review.verdict,
          latencyMs: review.latencyMs,
          thinkingMs: review.thinkingMs,
          totalMs: review.totalMs,
        })),
      })),
    }
  }

  /**
   * LE test : c'est lui qui valide la promesse d'assurance. Tout le reste est du détail.
   * Export → base vidée (`docker compose down -v`) → import → la base est identique.
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
    // Une révision JUGÉE : réponse écrite, verdict, et les trois durées.
    await LeitnerReview.create({
      leitnerCardId: revisee.id,
      grade: 'good',
      reviewedAt: DateTime.fromISO('2026-07-05T09:02:00.000Z'),
      answer: 'Négocier les clés de session.',
      verdict: 'partiel',
      latencyMs: 4_200,
      thinkingMs: 8_500,
      totalMs: 31_000,
    })
    // Une révision JAMAIS jugée : juge éteint, aucune mesure exploitable. Tout est
    // `null`, et `null` doit se relire `null` — un `0` restauré tirerait la médiane
    // de la carte vers le bas et lui vaudrait `easy`.
    await LeitnerReview.create({
      leitnerCardId: revisee.id,
      grade: 'hard',
      reviewedAt: DateTime.fromISO('2026-07-10T09:30:00.000Z'),
    })
    // Les deux valeurs FALSY qui ne sont pas des absences : une réponse vide (le verso
    // dévoilé sans rien écrire, mais soumis) et une frappe immédiate. Un export qui
    // filtrerait sur la vérité plutôt que sur `!== null` les perdrait toutes les deux.
    await LeitnerReview.create({
      leitnerCardId: revisee.id,
      grade: 'again',
      reviewedAt: DateTime.fromISO('2026-07-12T18:00:00.000Z'),
      answer: '',
      thinkingMs: 0,
      totalMs: 0,
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

    const response = await upload(client, user, backup)
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

  test('le contenu existant survit et la catégorie déjà présente est réutilisée', async ({
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

  test('un recto déjà présent sous le même thème est ignoré, en base comme dans le fichier', async ({
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

  test('rejouer le même fichier n’ajoute rien : l’import est idempotent', async ({
    client,
    assert,
  }) => {
    const user = await login()
    const fichier = {
      cards: [
        { front: 'Une', back: 'A.', category: 'DevOps', theme: 'Docker' },
        { front: 'Deux', back: 'B.', category: 'DevOps', theme: 'Docker' },
      ],
    }

    await upload(client, user, fichier)
    const response = await upload(client, user, fichier)

    const report = response.flashMessages().importReport as ImportReport
    assert.equal(report.cardsCreated, 0)
    assert.equal(report.cardsSkipped, 2)
    assert.lengthOf(await LeitnerCard.all(), 2)
    // La taxonomie n'est pas dupliquée non plus.
    assert.lengthOf(await LeitnerCategory.all(), 1)
    assert.lengthOf(await LeitnerTheme.all(), 1)
  })

  /**
   * Le revers assumé de « je n'importe que ce qui manque » : le couple (recto, thème)
   * fait l'identité d'une carte, donc deux cartes réellement identiques n'en font
   * qu'une après un aller-retour. C'est le prix de l'idempotence, pas un bug.
   */
  test('deux cartes au même recto sous le même thème fusionnent en une seule', async ({
    client,
    assert,
  }) => {
    const user = await login()

    const response = await upload(client, user, {
      cards: [
        { front: 'Même recto', back: 'Un.', category: 'DevOps', theme: 'Docker' },
        { front: 'Même recto', back: 'Deux.', category: 'DevOps', theme: 'Docker' },
      ],
    })

    const report = response.flashMessages().importReport as ImportReport
    assert.equal(report.cardsCreated, 1)
    assert.equal(report.cardsSkipped, 1)
    assert.lengthOf(await LeitnerCard.all(), 1)
  })

  /**
   * L'import n'ajoute que ce qui manque, et « ce qui manque » s'entend **carte par
   * carte** : une carte déjà présente est ignorée entièrement, ses révisions comprises.
   * Ses colonnes de trace vides ne sont donc **jamais** complétées depuis le fichier.
   *
   * C'est un choix, pas un oubli — apparier deux révisions demanderait une clé qu'on
   * n'a pas (`reviewed_at` n'est pas unique), et un mauvais appariement écrirait des
   * mesures sur la mauvaise carte : une référence de fluence fausse, en silence. Le
   * scénario réel, restaurer dans une base vide, n'est pas concerné.
   */
  test("une carte déjà présente n'est pas rétro-remplie depuis le fichier", async ({
    client,
    assert,
  }) => {
    const user = await login()
    const existante = await LeitnerCard.create({
      front: 'Rôle du handshake TLS ?',
      back: 'Négocier clés et algorithmes.',
      box: 2,
      nextReview: DateTime.fromISO('2026-07-20'),
    })
    await LeitnerReview.create({
      leitnerCardId: existante.id,
      grade: 'good',
      reviewedAt: DateTime.fromISO('2026-07-05T09:02:00.000Z'),
    })

    const response = await upload(client, user, {
      cards: [
        {
          front: 'Rôle du handshake TLS ?',
          back: 'Négocier clés et algorithmes.',
          reviews: [
            {
              grade: 'good',
              reviewedAt: '2026-07-05T09:02:00.000Z',
              answer: 'Une réponse venue du fichier.',
              verdict: 'juste',
              thinkingMs: 3_000,
            },
          ],
        },
      ],
    })

    const report = response.flashMessages().importReport as ImportReport
    assert.equal(report.cardsSkipped, 1)
    // Aucune révision créée : la boucle vit après le `continue` de déduplication.
    assert.equal(report.reviewsCreated, 0)

    const revisions = await LeitnerReview.query().where('leitner_card_id', existante.id)
    assert.lengthOf(revisions, 1)
    assert.isNull(revisions[0].answer)
    assert.isNull(revisions[0].verdict)
    assert.isNull(revisions[0].thinkingMs)
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
      // La trace d'une révision est bornée comme le `POST /review` qui l'écrit : un
      // fichier n'est pas une source plus fiable qu'une requête. `thinkingMs` alimente
      // une règle — accepter n'importe quoi ici dégraderait les suggestions futures.
      [
        'verdict hors énumération',
        {
          cards: [
            {
              front: 'A',
              back: 'B',
              reviews: [{ grade: 'good', reviewedAt: '2026-07-13T09:00:00Z', verdict: 'correct' }],
            },
          ],
        },
      ],
      [
        'mesure au-delà du plafond de transport',
        {
          cards: [
            {
              front: 'A',
              back: 'B',
              reviews: [
                { grade: 'good', reviewedAt: '2026-07-13T09:00:00Z', thinkingMs: 7_200_000 },
              ],
            },
          ],
        },
      ],
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
