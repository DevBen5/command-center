import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import type { ModelAttributes } from '@adonisjs/lucid/types/model'
import User from '#core/auth/models/user'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import LeitnerDraftCard from '#modules/leitner/models/leitner_draft_card'
import LeitnerIngestion from '#modules/leitner/models/leitner_ingestion'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'
import LeitnerCatalogService from '#modules/leitner/services/leitner_catalog_service'
import {
  ingestionJobs,
  MAX_COURSE_CHARS,
  sweepInterruptedIngestions,
} from '#modules/leitner/services/leitner_ingestion_service'
import LlmClient, {
  LlmUnavailableError,
  type LlmMessage,
} from '#modules/leitner/services/llm_client'
import FakeLlmClient from '#tests/fakes/fake_llm_client'

/**
 * Le LLM propose, l'utilisateur valide. Ces tests couvrent la voie d'entrée complète
 * — soumission, suivi, brouillons, promotion — **sans jamais appeler un vrai modèle** :
 * le client est remplacé dans le conteneur, ce qui est toute la raison de son injection.
 *
 * ⚠️ L'ingestion est **asynchrone** : le POST rend la main avant le modèle. Un test qui
 * n'attendrait pas la tâche de fond (`ingestionJobs()`) courrait contre elle.
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
  function fakeLlm(
    responder: string[] | ((messages: LlmMessage[], call: number) => string | Promise<string>)
  ) {
    app.container.swap(LlmClient, () => new FakeLlmClient(responder))
  }

  async function login() {
    return User.create({
      fullName: 'Utilisateur Test',
      email: 'test@example.com',
      password: 'secret123',
    })
  }

  /**
   * Le brouillon tel que l'écran l'enverrait à la validation, sans l'avoir corrigé :
   * la requête de promotion **porte le contenu**, jamais de simples ids.
   */
  function promotion(draft: LeitnerDraftCard) {
    return {
      id: draft.id,
      front: draft.front,
      back: draft.back,
      category: draft.category,
      theme: draft.theme,
    }
  }

  /** Soumet un cours, puis attend que la tâche de fond ait fini son travail. */
  async function submit(client: any, user: User, payload: Record<string, unknown> = {}) {
    const response = await client
      .post('/revision/ingest')
      .json({ text: COURSE, ...payload })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    await ingestionJobs()
    return response
  }

  test('le POST rend la main avant le modèle, et redirige vers la page du travail', async ({
    client,
    assert,
  }) => {
    const user = await login()

    // Le modèle est retenu : si la requête HTTP l'attendait, elle ne reviendrait pas.
    let release: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    fakeLlm(async () => {
      await held
      return TWO_CARDS
    })

    const response = await client
      .post('/revision/ingest')
      .json({ text: COURSE })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const ingestion = await LeitnerIngestion.firstOrFail()
    response.assertHeader('location', `/revision/ingest/${ingestion.id}`)

    // Le travail n'a pas commencé — ou vient à peine de commencer : rien n'est produit.
    assert.include(['pending', 'running'], ingestion.status)
    assert.equal(ingestion.cardsProposed, 0)
    assert.lengthOf(await LeitnerDraftCard.all(), 0)

    release!()
    await ingestionJobs()

    await ingestion.refresh()
    assert.equal(ingestion.status, 'done')
    assert.lengthOf(await LeitnerDraftCard.all(), 2)
  })

  test('soumettre un cours produit des brouillons, et aucune carte', async ({ client, assert }) => {
    const user = await login()
    fakeLlm([TWO_CARDS])

    const response = await submit(client, user)
    response.assertStatus(302)

    const ingestions = await LeitnerIngestion.all()
    assert.lengthOf(ingestions, 1)
    assert.equal(ingestions[0].status, 'done')
    assert.equal(ingestions[0].source, 'paste')
    assert.equal(ingestions[0].cardsProposed, 2)
    // Le titre est déduit du cours : « Texte collé » n'est plus jamais un titre.
    assert.equal(ingestions[0].title, 'Réseau')

    assert.lengthOf(await LeitnerDraftCard.all(), 2)
    // Relecture obligatoire : rien n'entre en base avant validation.
    assert.lengthOf(await LeitnerCard.all(), 0)
  })

  test('un titre fourni à la saisie n’est pas écrasé', async ({ client, assert }) => {
    const user = await login()
    fakeLlm([TWO_CARDS])

    await submit(client, user, { title: 'Cours de réseau — TLS' })

    const ingestion = await LeitnerIngestion.firstOrFail()
    assert.equal(ingestion.title, 'Cours de réseau — TLS')
  })

  test('valider un brouillon crée une carte via le catalogue', async ({ client, assert }) => {
    const user = await login()
    fakeLlm([TWO_CARDS])

    await submit(client, user)

    const drafts = await LeitnerDraftCard.query().orderBy('id', 'asc')
    const response = await client
      .post('/revision/ingest/drafts/accept')
      .json({ drafts: [promotion(drafts[0])] })
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

  test('valider emporte la correction en cours, jamais le texte du modèle', async ({
    client,
    assert,
  }) => {
    const user = await login()
    fakeLlm([TWO_CARDS])

    await submit(client, user)

    const draft = await LeitnerDraftCard.query().orderBy('id', 'asc').firstOrFail()

    // L'écran valide ce qu'il a sous les yeux : la correction part avec la promotion,
    // dans la même requête. Un accept sur de simples ids créerait la carte du modèle.
    await client
      .post('/revision/ingest/drafts/accept')
      .json({
        drafts: [
          {
            id: draft.id,
            front: 'Recto corrigé à la relecture ?',
            back: 'Verso corrigé à la relecture.',
            category: 'Réseau',
            theme: 'TLS',
          },
        ],
      })
      .loginAs(user)
      .withCsrfToken()

    const cards = await LeitnerCard.query()
    assert.lengthOf(cards, 1)
    assert.equal(cards[0].front, 'Recto corrigé à la relecture ?')
    assert.equal(cards[0].back, 'Verso corrigé à la relecture.')

    // Le brouillon garde la trace de ce qui a été validé, pas de ce qui a été proposé.
    await draft.refresh()
    assert.equal(draft.status, 'accepted')
    assert.equal(draft.front, 'Recto corrigé à la relecture ?')
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
    await submit(client, user)

    const drafts = await LeitnerDraftCard.query().orderBy('id', 'asc')
    await client
      .post('/revision/ingest/drafts/accept')
      .json({ drafts: drafts.map(promotion) })
      .loginAs(user)
      .withCsrfToken()

    // Deux brouillons validés, mais le premier existait déjà sous ce thème : une seule
    // carte de plus, et l'ancienne n'est pas écrasée.
    const cards = await LeitnerCard.query().orderBy('id', 'asc')
    assert.lengthOf(cards, 2)
    assert.equal(cards[0].back, 'Verso saisi à la main.')
  })

  test('l’origine déclarée est reprise telle quelle — stockée, affichée, jamais interprétée', async ({
    client,
    assert,
  }) => {
    const user = await login()
    fakeLlm([TWO_CARDS])

    // ⚠️ Depuis la prévisualisation, c'est le CLIENT qui extrait : `source` et
    // `sourceName` arrivent donc de lui. Le POST ne lit plus aucun fichier.
    await submit(client, user, { source: 'pdf', sourceName: 'cours.pdf' })

    const ingestion = await LeitnerIngestion.firstOrFail()
    assert.equal(ingestion.source, 'pdf')
    assert.equal(ingestion.sourceName, 'cours.pdf')
  })

  test('une origine « collé » n’emporte pas de nom de fichier', async ({ client, assert }) => {
    const user = await login()
    fakeLlm([TWO_CARDS])

    await submit(client, user, { source: 'paste', sourceName: 'menteur.pdf' })

    const ingestion = await LeitnerIngestion.firstOrFail()
    assert.equal(ingestion.source, 'paste')
    assert.isNull(ingestion.sourceName)
  })

  test('une origine inconnue est refusée', async ({ client, assert }) => {
    const user = await login()

    const response = await client
      .post('/revision/ingest')
      .accept('json')
      .json({ text: COURSE, source: 'ftp' })
      .loginAs(user)
      .withCsrfToken()

    // La liste est fermée : `source` est déclaratif, pas libre.
    response.assertStatus(422)
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

  test('un LLM injoignable laisse le travail en échec, avec son message', async ({
    client,
    assert,
  }) => {
    const user = await login()
    fakeLlm(() => {
      throw new LlmUnavailableError('Le serveur LLM (http://127.0.0.1:1234/v1) est injoignable.')
    })

    // La requête aboutit : l'échec est un état du travail, pas une 500.
    const response = await submit(client, user)
    response.assertStatus(302)

    const ingestions = await LeitnerIngestion.all()
    assert.lengthOf(ingestions, 1)
    // Jamais `running` : une tâche de fond qui lève écrit son erreur et bascule.
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

    await submit(client, user)

    const ingestions = await LeitnerIngestion.all()
    assert.equal(ingestions[0].status, 'failed')
    assert.include(ingestions[0].error!, 'JSON')
    assert.lengthOf(await LeitnerDraftCard.all(), 0)
  })
})

/*
| La route d'extraction — un chargeur de texte, pas une soumission
|------------------------------------------------------------------------------
| Prévisualiser veut dire que le texte existe AVANT le travail. Cette route rend le
| texte d'un fichier et **n'écrit rien** : c'est l'équivalent ici du « aucune écriture »
| des routes de diagnostic LLM. Le travail, lui, naît du POST d'après — avec le texte
| que l'utilisateur a relu.
|
| ⚠️ Les fixtures sont des binaires versionnés (`tests/fixtures/*.pdf`), jamais
| fabriqués à la volée, jamais téléchargés : aucun test de ce dépôt ne touche le réseau.
*/
test.group('Leitner / extraction du texte d’un fichier', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.teardown(() => app.container.restore(LlmClient))

  const FIXTURES = fileURLToPath(new URL('../../fixtures/', import.meta.url))

  async function login() {
    return User.create({
      fullName: 'Utilisateur Test',
      email: 'test@example.com',
      password: 'secret123',
    })
  }

  /** Téléverse un fichier sur la route d'extraction, et rend sa réponse JSON. */
  async function extract(client: any, user: User, file: Buffer, filename: string) {
    return client
      .post('/revision/ingest/extract')
      .accept('json')
      .file('file', file, { filename })
      .loginAs(user)
      .withCsrfToken()
  }

  const fixture = (name: string) => readFile(`${FIXTURES}${name}`)

  /** La base n'a pas bougé : ni travail, ni brouillon, ni carte. */
  async function assertNothingWritten(assert: any) {
    assert.lengthOf(await LeitnerIngestion.all(), 0)
    assert.lengthOf(await LeitnerDraftCard.all(), 0)
    assert.lengthOf(await LeitnerCard.all(), 0)
  }

  test('un .pdf rend son texte, et n’écrit rien', async ({ client, assert }) => {
    const user = await login()

    const response = await extract(client, user, await fixture('cours.pdf'), 'cours.pdf')

    response.assertStatus(200)
    const body = response.body() as {
      ok: boolean
      text: string
      source: string
      sourceName: string
    }
    assert.isTrue(body.ok)
    assert.include(body.text, 'Le handshake TLS')
    assert.equal(body.source, 'pdf')
    assert.equal(body.sourceName, 'cours.pdf')

    await assertNothingWritten(assert)
  })

  test('un .txt et un .md passent par le même chemin', async ({ client, assert }) => {
    const user = await login()

    // Les faire passer par la route d'extraction UNIFIE les trois formats : un PDF qui
    // se prévisualise pendant qu'un .md part à l'aveugle serait une incohérence gratuite.
    for (const filename of ['cours.txt', 'cours.md']) {
      const response = await extract(client, user, Buffer.from(COURSE, 'utf-8'), filename)

      response.assertStatus(200)
      const body = response.body() as { ok: boolean; text: string; source: string }
      assert.isTrue(body.ok)
      assert.include(body.text, 'Le handshake TLS')
      // `.txt` / `.md` restent « fichier » : seul un PDF est un PDF.
      assert.equal(body.source, 'file')
    }

    await assertNothingWritten(assert)
  })

  test('un scan est refusé, avec son message — et ce n’est pas une 500', async ({
    client,
    assert,
  }) => {
    const user = await login()

    const response = await extract(client, user, await fixture('scan.pdf'), 'scan.pdf')

    // L'échec d'extraction est une réponse, pas une panne : l'écran l'affiche.
    response.assertStatus(200)
    const body = response.body() as { ok: boolean; error: string }
    assert.isFalse(body.ok)
    assert.include(body.error, 'scan')

    await assertNothingWritten(assert)
  })

  test('un PDF protégé par mot de passe a un message distinct', async ({ client, assert }) => {
    const user = await login()

    const response = await extract(client, user, await fixture('protege.pdf'), 'protege.pdf')

    response.assertStatus(200)
    const body = response.body() as { ok: boolean; error: string }
    assert.isFalse(body.ok)
    assert.include(body.error, 'mot de passe')
    assert.notInclude(body.error, 'scan')
  })

  test('un type de fichier refusé est refusé', async ({ client, assert }) => {
    const user = await login()

    const response = await extract(client, user, Buffer.from('MZ'), 'cours.exe')

    response.assertStatus(422)
    await assertNothingWritten(assert)
  })

  test('la route est sous auth et exige le jeton CSRF', async ({ client, assert }) => {
    const user = await login()

    // Sans session : la porte du module, comme pour le reste.
    const anonymous = await client
      .post('/revision/ingest/extract')
      .accept('json')
      .file('file', Buffer.from(COURSE, 'utf-8'), { filename: 'cours.txt' })
    anonymous.assertStatus(401)

    // Connecté mais sans jeton : Shield refuse (`enableXsrfCookie`).
    //
    // ⚠️ Le refus est une **redirection**, pas un 403 : le gestionnaire d'exceptions
    // d'AdonisJS traite `E_BAD_CSRF_TOKEN` par un flash + `redirect().back()` — et ce,
    // même sur un `accept: application/json`. Sans `redirects(0)`, le client suivrait la
    // redirection jusqu'à l'accueil et le test lirait un 200 rassurant : c'est ce
    // faux vert qu'on empêche ici.
    const noToken = await client
      .post('/revision/ingest/extract')
      .accept('json')
      .file('file', Buffer.from(COURSE, 'utf-8'), { filename: 'cours.txt' })
      .loginAs(user)
      .redirects(0)
    noToken.assertStatus(302)

    await assertNothingWritten(assert)
  })

  test('le flux complet : un PDF, son texte relu, puis un travail', async ({ client, assert }) => {
    const user = await login()
    app.container.swap(LlmClient, () => new FakeLlmClient([TWO_CARDS]))

    // 1. Le fichier devient du texte — et rien n'existe encore.
    const extraction = await extract(client, user, await fixture('cours.pdf'), 'cours.pdf')
    const { text, source, sourceName } = extraction.body() as {
      text: string
      source: string
      sourceName: string
    }
    await assertNothingWritten(assert)

    // 2. L'utilisateur relit et coupe — l'usage normal, pas un contournement.
    const reviewed = `# Le handshake TLS\n\n${text}`

    // 3. Le flux existant, inchangé : c'est le TEXTE qui crée le travail.
    const response = await client
      .post('/revision/ingest')
      .json({ text: reviewed, source, sourceName })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    await ingestionJobs()
    response.assertStatus(302)

    const ingestion = await LeitnerIngestion.firstOrFail()
    assert.equal(ingestion.status, 'done')
    assert.equal(ingestion.source, 'pdf')
    assert.equal(ingestion.sourceName, 'cours.pdf')
    // C'est le texte relu qui est parti, pas celui du fichier.
    assert.equal(ingestion.charCount, reviewed.length)
    assert.equal(ingestion.title, 'Le handshake TLS')
    assert.lengthOf(await LeitnerDraftCard.all(), 2)
  })
})

test.group('Leitner / la page de suivi d’un travail', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function login() {
    return User.create({
      fullName: 'Utilisateur Test',
      email: 'test@example.com',
      password: 'secret123',
    })
  }

  /** Un travail en base, sans passer par le LLM : c'est la page qu'on teste ici. */
  async function ingestion(attributes: Partial<ModelAttributes<LeitnerIngestion>> = {}) {
    return LeitnerIngestion.create({
      title: 'Cours de réseau',
      status: 'running',
      source: 'paste',
      charCount: 500,
      chunkCount: 4,
      chunksDone: 1,
      cardsProposed: 0,
      ...attributes,
    })
  }

  test('l’historique dit ce que les brouillons sont devenus', async ({ client, assert }) => {
    const user = await login()
    const work = await ingestion({ status: 'done', chunksDone: 4, cardsProposed: 3 })

    for (const status of ['pending', 'accepted', 'rejected'] as const) {
      await LeitnerDraftCard.create({
        leitnerIngestionId: work.id,
        front: `Recto ${status} ?`,
        back: 'Un verso.',
        status,
      })
    }

    const response = await client.get('/revision/ingest').loginAs(user).withInertia()

    response.assertStatus(200)
    response.assertInertiaComponent('modules/leitner/ingest')

    const props = response.inertiaProps as {
      ingestions: {
        title: string
        drafts: { pending: number; accepted: number; rejected: number }
      }[]
    }
    assert.lengthOf(props.ingestions, 1)
    assert.equal(props.ingestions[0].title, 'Cours de réseau')
    // Un travail « terminé » dont tout a été rejeté et un dont tout attend encore ne
    // se ressemblent pas : la ligne d'historique doit les distinguer.
    assert.deepEqual(props.ingestions[0].drafts, { pending: 1, accepted: 1, rejected: 1 })
  })

  test('un travail en cours rend sa progression', async ({ client, assert }) => {
    const user = await login()
    const work = await ingestion()

    const response = await client.get(`/revision/ingest/${work.id}`).loginAs(user).withInertia()

    response.assertStatus(200)
    response.assertInertiaComponent('modules/leitner/ingest_show')

    // La barre de progression a sa source de données : c'est elle qu'on interroge.
    const props = response.inertiaProps as {
      ingestion: { status: string; chunkCount: number; chunksDone: number }
      drafts: unknown[]
    }
    assert.equal(props.ingestion.status, 'running')
    assert.equal(props.ingestion.chunksDone, 1)
    assert.equal(props.ingestion.chunkCount, 4)
    assert.lengthOf(props.drafts, 0)
  })

  test('un travail abouti rend ses brouillons', async ({ client, assert }) => {
    const user = await login()
    const work = await ingestion({ status: 'done', chunksDone: 4, cardsProposed: 1 })
    await LeitnerDraftCard.create({
      leitnerIngestionId: work.id,
      front: 'Rôle du handshake TLS ?',
      back: 'Négocier clés et algorithmes.',
      category: 'Réseau',
      theme: 'TLS',
      status: 'pending',
    })

    const response = await client.get(`/revision/ingest/${work.id}`).loginAs(user).withInertia()

    const props = response.inertiaProps as {
      ingestion: { status: string }
      drafts: { front: string }[]
    }
    assert.equal(props.ingestion.status, 'done')
    assert.lengthOf(props.drafts, 1)
  })

  test('un travail en échec rend son message, brut', async ({ client, assert }) => {
    const user = await login()
    const work = await ingestion({ status: 'failed', error: 'Le serveur LLM est injoignable.' })

    const response = await client.get(`/revision/ingest/${work.id}`).loginAs(user).withInertia()

    const props = response.inertiaProps as { ingestion: { status: string; error: string } }
    assert.equal(props.ingestion.status, 'failed')
    assert.equal(props.ingestion.error, 'Le serveur LLM est injoignable.')
  })

  test('renommer un travail', async ({ client, assert }) => {
    const user = await login()
    const work = await ingestion()

    const response = await client
      .put(`/revision/ingest/${work.id}/title`)
      .json({ title: 'TLS — le handshake' })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    await work.refresh()
    assert.equal(work.title, 'TLS — le handshake')
  })

  test('un titre vide ou trop long est refusé', async ({ client, assert }) => {
    const user = await login()
    const work = await ingestion()

    for (const title of ['   ', 'x'.repeat(121)]) {
      const response = await client
        .put(`/revision/ingest/${work.id}/title`)
        .accept('json')
        .json({ title })
        .loginAs(user)
        .withCsrfToken()

      response.assertStatus(422)
    }

    await work.refresh()
    assert.equal(work.title, 'Cours de réseau')
  })
})

/*
| Le balayage au démarrage
|------------------------------------------------------------------------------
| La tâche de fond vit dans le processus Node : un redémarrage la tue sans que rien
| ne la reprenne. Sans ce balayage, la page d'un travail mort tournerait indéfiniment
| sur une barre qui n'avancera plus — un statut qui ment en silence.
*/
test.group('Leitner / balayage des ingestions interrompues', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('un travail orphelin est passé en échec, les autres sont intacts', async ({ assert }) => {
    const base = {
      source: 'paste' as const,
      charCount: 500,
      chunkCount: 4,
      chunksDone: 2,
      cardsProposed: 0,
    }

    const running = await LeitnerIngestion.create({ ...base, title: 'Coupé', status: 'running' })
    const pending = await LeitnerIngestion.create({
      ...base,
      title: 'Jamais parti',
      status: 'pending',
    })
    const done = await LeitnerIngestion.create({ ...base, title: 'Abouti', status: 'done' })

    const swept = await sweepInterruptedIngestions()
    assert.equal(swept, 2)

    for (const work of [running, pending]) {
      await work.refresh()
      assert.equal(work.status, 'failed')
      // Le message dit pourquoi : sans lui, l'échec serait aussi opaque que la barre figée.
      assert.include(work.error!, 'redémarré')
    }

    await done.refresh()
    assert.equal(done.status, 'done')
    assert.isNull(done.error)
  })
})
