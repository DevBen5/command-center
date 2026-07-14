import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#core/auth/models/user'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import LeitnerDraftCard from '#modules/leitner/models/leitner_draft_card'
import LeitnerIngestion from '#modules/leitner/models/leitner_ingestion'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'
import LeitnerCatalogService from '#modules/leitner/services/leitner_catalog_service'
import { MAX_COURSE_CHARS } from '#modules/leitner/services/leitner_ingestion_service'
import LlmClient, {
  LlmUnavailableError,
  type LlmMessage,
} from '#modules/leitner/services/llm_client'
import FakeLlmClient from '#tests/fakes/fake_llm_client'

/**
 * Le LLM propose, l'utilisateur valide. Ces tests couvrent la voie d'entrée complète
 * — soumission, brouillons, promotion — **sans jamais appeler un vrai modèle** : le
 * client est remplacé dans le conteneur, ce qui est toute la raison de son injection.
 */
const TWO_CARDS = JSON.stringify({
  cards: [
    {
      front: 'Rôle du handshake TLS ?',
      back: 'Négocier clés et algorithmes.',
      category: 'Réseau',
      theme: 'TLS',
    },
    { front: 'Que fait un résolveur DNS ?', back: 'Il traduit un nom en adresse IP.' },
  ],
})

const COURSE = `# Réseau\n\n${'Le handshake TLS négocie les clés et les algorithmes. '.repeat(10)}`

test.group('Leitner / ingestion d’un cours par un LLM local', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.teardown(() => app.container.restore(LlmClient))

  /** Aucun réseau, aucun modèle chargé : la suite doit être déterministe. */
  function fakeLlm(responder: string[] | ((messages: LlmMessage[], call: number) => string)) {
    app.container.swap(LlmClient, () => new FakeLlmClient(responder))
  }

  async function login() {
    return User.create({
      fullName: 'Utilisateur Test',
      email: 'test@example.com',
      password: 'secret123',
    })
  }

  test('soumettre un cours produit des brouillons, et aucune carte', async ({ client, assert }) => {
    const user = await login()
    fakeLlm([TWO_CARDS])

    const response = await client
      .post('/revision/ingest')
      .json({ text: COURSE })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const ingestions = await LeitnerIngestion.all()
    assert.lengthOf(ingestions, 1)
    assert.equal(ingestions[0].status, 'done')
    assert.equal(ingestions[0].source, 'paste')
    assert.equal(ingestions[0].cardsProposed, 2)

    assert.lengthOf(await LeitnerDraftCard.all(), 2)
    // Relecture obligatoire : rien n'entre en base avant validation.
    assert.lengthOf(await LeitnerCard.all(), 0)
  })

  test('valider un brouillon crée une carte via le catalogue', async ({ client, assert }) => {
    const user = await login()
    fakeLlm([TWO_CARDS])

    await client.post('/revision/ingest').json({ text: COURSE }).loginAs(user).withCsrfToken()

    const drafts = await LeitnerDraftCard.query().orderBy('id', 'asc')
    const response = await client
      .post('/revision/ingest/drafts/accept')
      .json({ ids: [drafts[0].id] })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const cards = await LeitnerCard.query().preload('theme', (theme) => theme.preload('category'))
    assert.lengthOf(cards, 1)
    // Une carte issue d'un cours est une carte comme une autre : boîte 1, due aujourd'hui.
    assert.equal(cards[0].box, 1)
    assert.equal(cards[0].theme.name, 'TLS')
    assert.equal(cards[0].theme.category.name, 'Réseau')
  })

  test('la déduplication (recto, thème) tient à la promotion', async ({ client, assert }) => {
    const user = await login()
    const category = await LeitnerCategory.create({ name: 'Réseau' })
    const theme = await LeitnerTheme.create({ leitnerCategoryId: category.id, name: 'TLS' })
    await new LeitnerCatalogService().createCard({
      front: 'Rôle du handshake TLS ?',
      back: 'Verso saisi à la main.',
      leitnerThemeId: theme.id,
    })

    fakeLlm([TWO_CARDS])
    await client.post('/revision/ingest').json({ text: COURSE }).loginAs(user).withCsrfToken()

    const drafts = await LeitnerDraftCard.query().orderBy('id', 'asc')
    await client
      .post('/revision/ingest/drafts/accept')
      .json({ ids: drafts.map((draft) => draft.id) })
      .loginAs(user)
      .withCsrfToken()

    // Deux brouillons validés, mais le premier existait déjà sous ce thème : une seule
    // carte de plus, et l'ancienne n'est pas écrasée.
    const cards = await LeitnerCard.query().orderBy('id', 'asc')
    assert.lengthOf(cards, 2)
    assert.equal(cards[0].back, 'Verso saisi à la main.')
  })

  test('accepte un fichier .md', async ({ client, assert }) => {
    const user = await login()
    fakeLlm([TWO_CARDS])

    const response = await client
      .post('/revision/ingest')
      .file('file', Buffer.from(COURSE, 'utf-8'), { filename: 'cours.md' })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const ingestions = await LeitnerIngestion.all()
    assert.lengthOf(ingestions, 1)
    assert.equal(ingestions[0].source, 'file')
    assert.equal(ingestions[0].sourceName, 'cours.md')
    assert.lengthOf(await LeitnerDraftCard.all(), 2)
  })

  test('refuse un fichier d’un autre type', async ({ client, assert }) => {
    const user = await login()
    fakeLlm([TWO_CARDS])

    const response = await client
      .post('/revision/ingest')
      .file('file', Buffer.from(COURSE, 'utf-8'), { filename: 'cours.pdf' })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    // Rien n'a été tenté : pas même une ligne d'ingestion.
    assert.lengthOf(await LeitnerIngestion.all(), 0)
  })

  test('le plafond de taille tient', async ({ client, assert }) => {
    const user = await login()
    fakeLlm([TWO_CARDS])

    const response = await client
      .post('/revision/ingest')
      .json({ text: 'x'.repeat(MAX_COURSE_CHARS + 1) })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.lengthOf(await LeitnerIngestion.all(), 0)
  })

  test('un LLM injoignable donne une erreur lisible, sans écriture partielle', async ({
    client,
    assert,
  }) => {
    const user = await login()
    fakeLlm(() => {
      throw new LlmUnavailableError('Le serveur LLM (http://127.0.0.1:1234/v1) est injoignable.')
    })

    const response = await client
      .post('/revision/ingest')
      .json({ text: COURSE })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    // La requête aboutit : l'échec est un état de l'ingestion, pas une 500.
    response.assertStatus(302)

    const ingestions = await LeitnerIngestion.all()
    assert.lengthOf(ingestions, 1)
    assert.equal(ingestions[0].status, 'failed')
    assert.include(ingestions[0].error!, 'injoignable')

    assert.lengthOf(await LeitnerDraftCard.all(), 0)
    assert.lengthOf(await LeitnerCard.all(), 0)
  })

  test('un modèle qui répond n’importe quoi donne une erreur lisible', async ({
    client,
    assert,
  }) => {
    const user = await login()
    fakeLlm(['Désolé, je ne peux pas faire ça.'])

    await client.post('/revision/ingest').json({ text: COURSE }).loginAs(user).withCsrfToken()

    const ingestions = await LeitnerIngestion.all()
    assert.equal(ingestions[0].status, 'failed')
    assert.include(ingestions[0].error!, 'JSON')
    assert.lengthOf(await LeitnerDraftCard.all(), 0)
  })

  test('la page d’ingestion se rend avec ses brouillons', async ({ client, assert }) => {
    const user = await login()
    fakeLlm([TWO_CARDS])

    await client.post('/revision/ingest').json({ text: COURSE }).loginAs(user).withCsrfToken()

    const response = await client.get('/revision/ingest').loginAs(user).withInertia()

    response.assertStatus(200)
    response.assertInertiaComponent('modules/leitner/ingest')

    const props = response.inertiaProps as { drafts: unknown[]; current: { status: string } }
    assert.lengthOf(props.drafts, 2)
    assert.equal(props.current.status, 'done')
  })
})
