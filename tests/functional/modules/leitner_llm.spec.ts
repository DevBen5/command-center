import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#core/auth/models/user'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerDraftCard from '#modules/leitner/models/leitner_draft_card'
import LeitnerIngestion from '#modules/leitner/models/leitner_ingestion'
import LlmClient from '#modules/leitner/services/llm_client'
import FakeLlmClient from '#tests/fakes/fake_llm_client'

/**
 * L'écran de configuration du LLM (`/revision/llm`). Deux promesses à tenir :
 *
 * 1. **la liste blanche** — ces routes font émettre au serveur des requêtes vers une
 *    URL saisie : hors loopback et plages privées, c'est un refus ;
 * 2. **rien n'est écrit** — ni carte, ni brouillon, ni ingestion. L'assistant détecte,
 *    teste en mémoire, et rend un bloc à copier.
 *
 * Comme partout dans ce module, le client LLM est remplacé par un faux : aucun test
 * n'appelle un vrai modèle, et aucun ne sonde un vrai port de la machine qui l'exécute.
 */
const LM_STUDIO = 'http://127.0.0.1:1234/v1'

const ONE_CARD = JSON.stringify({
  cards: [
    {
      front: 'À quoi sert le handshake TLS ?',
      back: 'À authentifier le serveur et négocier une clé de session.',
      category: 'Réseau',
      theme: 'TLS',
    },
  ],
})

test.group('Leitner / configuration du LLM', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.teardown(() => app.container.restore(LlmClient))

  function fakeLlm(
    responder: string[] | (() => string),
    server: { reachable?: string[]; models?: string[] } = {}
  ) {
    app.container.swap(LlmClient, () => new FakeLlmClient(responder, server))
  }

  async function login() {
    return User.create({
      fullName: 'Utilisateur Test',
      email: 'test@example.com',
      password: 'secret123',
    })
  }

  test('la page rend le composant et la configuration chargée, sans la clé d’API', async ({
    client,
    assert,
  }) => {
    const user = await login()

    const response = await client.get('/revision/llm').loginAs(user).withInertia()

    response.assertStatus(200)
    response.assertInertiaComponent('modules/leitner/llm')

    const props = response.inertiaProps as {
      current: Record<string, unknown>
      candidates: { baseUrl: string }[]
    }
    // ⚠️ La clé ne repart jamais vers le client : on dit qu'elle existe, pas sa valeur.
    assert.notProperty(props.current, 'apiKey')
    assert.property(props.current, 'hasApiKey')
    // Les candidats sondés viennent du code, pas du client.
    assert.isAbove(props.candidates.length, 0)
  })

  test('la détection ne sonde que les candidats du code', async ({ client, assert }) => {
    const user = await login()
    fakeLlm([ONE_CARD], { reachable: [LM_STUDIO] })

    const response = await client
      .post('/revision/llm/detect')
      .json({})
      .accept('json')
      .loginAs(user)
      .withCsrfToken()

    response.assertStatus(200)

    const { candidates } = response.body() as { candidates: { baseUrl: string; ok: boolean }[] }
    const reachable = candidates.filter((candidate) => candidate.ok)

    assert.lengthOf(reachable, 1)
    assert.equal(reachable[0].baseUrl, LM_STUDIO)
  })

  test('les modèles d’un serveur local sont listés', async ({ client, assert }) => {
    const user = await login()
    fakeLlm([ONE_CARD], { reachable: [LM_STUDIO], models: ['qwen2.5-7b-instruct'] })

    const response = await client
      .post('/revision/llm/models')
      .accept('json')
      .json({ baseUrl: LM_STUDIO })
      .loginAs(user)
      .withCsrfToken()

    response.assertStatus(200)
    assert.deepEqual(response.body(), {
      ok: true,
      models: ['qwen2.5-7b-instruct'],
      error: null,
    })
  })

  test('un serveur injoignable donne une erreur lisible, pas une 500', async ({
    client,
    assert,
  }) => {
    const user = await login()
    fakeLlm([ONE_CARD], { reachable: [] })

    const response = await client
      .post('/revision/llm/models')
      .accept('json')
      .json({ baseUrl: LM_STUDIO })
      .loginAs(user)
      .withCsrfToken()

    response.assertStatus(200)

    const body = response.body() as { ok: boolean; error: string }
    assert.isFalse(body.ok)
    assert.include(body.error, 'injoignable')
  })

  test('le test de génération rend la carte produite par le modèle', async ({ client, assert }) => {
    const user = await login()
    fakeLlm([ONE_CARD], { reachable: [LM_STUDIO], models: ['qwen2.5-7b-instruct'] })

    const response = await client
      .post('/revision/llm/test')
      .accept('json')
      .json({ baseUrl: LM_STUDIO, model: 'qwen2.5-7b-instruct' })
      .loginAs(user)
      .withCsrfToken()

    response.assertStatus(200)

    const body = response.body() as { ok: boolean; cards: { front: string }[] }
    assert.isTrue(body.ok)
    assert.lengthOf(body.cards, 1)
    assert.equal(body.cards[0].front, 'À quoi sert le handshake TLS ?')
  })

  test('la base est inchangée après un test de génération', async ({ client, assert }) => {
    const user = await login()
    fakeLlm([ONE_CARD], { reachable: [LM_STUDIO] })

    await client
      .post('/revision/llm/test')
      .accept('json')
      .json({ baseUrl: LM_STUDIO, model: 'qwen2.5-7b-instruct' })
      .loginAs(user)
      .withCsrfToken()

    // L'assistant ne persiste rien : ni carte, ni brouillon, ni ingestion.
    assert.lengthOf(await LeitnerCard.all(), 0)
    assert.lengthOf(await LeitnerDraftCard.all(), 0)
    assert.lengthOf(await LeitnerIngestion.all(), 0)
  })

  test('un modèle qui rend de la prose échoue ici, et nulle part ailleurs', async ({
    client,
    assert,
  }) => {
    const user = await login()
    fakeLlm(['Bien sûr ! Voici quelques cartes de révision sur le TLS…'], {
      reachable: [LM_STUDIO],
    })

    const response = await client
      .post('/revision/llm/test')
      .accept('json')
      .json({ baseUrl: LM_STUDIO, model: 'tinyllama' })
      .loginAs(user)
      .withCsrfToken()

    response.assertStatus(200)

    const body = response.body() as { ok: boolean; error: string }
    assert.isFalse(body.ok)
    assert.include(body.error, 'JSON')
  })

  test('les trois routes refusent une URL hors liste blanche', async ({ client }) => {
    const user = await login()
    fakeLlm([ONE_CARD], { reachable: [LM_STUDIO] })

    for (const [url, payload] of [
      ['/revision/llm/detect', { baseUrl: 'http://169.254.169.254' }],
      ['/revision/llm/models', { baseUrl: 'https://example.com/v1' }],
      ['/revision/llm/test', { baseUrl: 'http://8.8.8.8/v1', model: 'x' }],
    ] as const) {
      const response = await client
        .post(url)
        .accept('json')
        .json(payload)
        .loginAs(user)
        .withCsrfToken()
      // 422 : le validateur a refusé. Aucune requête n'est partie vers cet hôte.
      response.assertStatus(422)
    }
  })

  test('les routes de diagnostic sont protégées par le guard de session', async ({ client }) => {
    const response = await client
      .post('/revision/llm/detect')
      .json({})
      .accept('json')
      .withCsrfToken()
      .redirects(0)

    // Non connecté : le guard refuse avant d'atteindre le contrôleur (401 en JSON,
    // redirection vers /login en navigation).
    response.assertStatus(401)
  })
})
