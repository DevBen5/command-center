import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import LeitnerDraftCard from '#modules/leitner/models/leitner_draft_card'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'
import LeitnerCatalogService from '#modules/leitner/services/leitner_catalog_service'
import LeitnerIngestionService, {
  chunkCourse,
  ingestionJobs,
  keepNewDrafts,
  LlmParseError,
  MAX_CHUNK_CHARS,
  parseLlmCards,
  type DraftInput,
} from '#modules/leitner/services/leitner_ingestion_service'
import { LlmUnavailableError, type LlmMessage } from '#modules/leitner/services/llm_client'
import FakeLlmClient from '#tests/fakes/fake_llm_client'

/** Le contrat avec le LLM est **exactement** le format d'import JSON du module. */
const ONE_CARD = JSON.stringify({
  cards: [
    {
      front: 'Rôle du handshake TLS ?',
      back: 'Négocier clés et algorithmes.',
      category: 'Réseau',
      theme: 'TLS',
    },
  ],
})

/** Le vrai client n'est jamais construit : aucun test ne parle à un modèle. */
function service(
  responder: string[] | ((messages: LlmMessage[], call: number) => string | Promise<string>)
) {
  const llm = new FakeLlmClient(responder)
  return { llm, service: new LeitnerIngestionService(llm, new LeitnerCatalogService()) }
}

/**
 * L'ingestion est **asynchrone** : `start()` rend la main aussitôt, le travail part en
 * tâche de fond. Un test qui n'attendrait pas ce travail (`ingestionJobs()`) courrait
 * contre lui — et contre le rollback de sa propre transaction.
 */
async function ingest(ingestionService: LeitnerIngestionService, text: string) {
  const ingestion = await ingestionService.start({ text, source: 'paste' })
  await ingestionJobs()
  await ingestion.refresh()
  return ingestion
}

/*
|------------------------------------------------------------------------------
| Le JSON qui n'en est pas
|------------------------------------------------------------------------------
| Un petit modèle local rend volontiers du JSON entouré de prose, ou dans un bloc
| de code. Ce n'est pas une panne : c'est le régime normal, et le parsing l'absorbe.
*/

test.group('LeitnerIngestionService / parsing de la réponse du LLM', () => {
  test('lit un JSON nu', async ({ assert }) => {
    const cards = await parseLlmCards(ONE_CARD)

    assert.lengthOf(cards, 1)
    assert.equal(cards[0].front, 'Rôle du handshake TLS ?')
    assert.equal(cards[0].category, 'Réseau')
    assert.equal(cards[0].theme, 'TLS')
  })

  test('lit un JSON dans un bloc de code', async ({ assert }) => {
    const cards = await parseLlmCards('```json\n' + ONE_CARD + '\n```')
    assert.lengthOf(cards, 1)
  })

  test('lit un JSON noyé dans de la prose', async ({ assert }) => {
    const cards = await parseLlmCards(
      `Bien sûr ! Voici les cartes que j'ai extraites :\n${ONE_CARD}\nDis-moi si tu veux plus de détails.`
    )
    assert.lengthOf(cards, 1)
  })

  test('accepte le tableau nu, sans son enveloppe', async ({ assert }) => {
    const cards = await parseLlmCards('[{"front":"Pod ?","back":"Unité déployable."}]')

    assert.lengthOf(cards, 1)
    // Rien à classer : le modèle n'a proposé ni catégorie ni thème.
    assert.isNull(cards[0].category)
    assert.isNull(cards[0].theme)
  })

  test('refuse ce qui ne contient aucun JSON, avec un message exploitable', async ({ assert }) => {
    await assert.rejects(() => parseLlmCards("Je ne peux pas t'aider avec ça."), LlmParseError)
  })

  test('refuse une carte sans verso, en disant lequel', async ({ assert }) => {
    try {
      await parseLlmCards('{"cards":[{"front":"Pod ?"}]}')
      assert.fail('Le parsing aurait dû échouer.')
    } catch (error) {
      assert.instanceOf(error, LlmParseError)
      // Le message repart au modèle pour sa réparation : il doit nommer le champ.
      assert.include((error as Error).message, 'back')
    }
  })

  test("jette la boîte et l'id que le modèle s'inventerait", async ({ assert }) => {
    const cards = await parseLlmCards(
      '{"cards":[{"id":42,"box":12,"front":"Pod ?","back":"Unité déployable.","nextReview":"2020-01-01"}]}'
    )

    // Le modèle n'a pas voix au chapitre : la carte naîtra en boîte 1, sans id.
    assert.deepEqual(cards, [
      { front: 'Pod ?', back: 'Unité déployable.', category: null, theme: null },
    ])
  })
})

/*
|------------------------------------------------------------------------------
| Découpage, fusion, déduplication
|------------------------------------------------------------------------------
*/

test.group('LeitnerIngestionService / découpage du cours', () => {
  test('un cours court tient en un seul morceau', ({ assert }) => {
    assert.deepEqual(chunkCourse('# Titre\n\nUn paragraphe.'), ['# Titre\n\nUn paragraphe.'])
  })

  test('un cours long est découpé, chaque morceau sous le plafond', ({ assert }) => {
    const section = (index: number) =>
      `## Section ${index}\n\n${'Le principe est le suivant. '.repeat(120)}`
    const chunks = chunkCourse([1, 2, 3, 4, 5, 6].map(section).join('\n\n'))

    assert.isAbove(chunks.length, 1)
    for (const chunk of chunks) assert.isAtMost(chunk.length, MAX_CHUNK_CHARS)
  })

  test('deux morceaux consécutifs se recouvrent', ({ assert }) => {
    const paragraph = (index: number) => `Paragraphe ${index}. ${'texte '.repeat(80)}`
    const chunks = chunkCourse(
      Array.from({ length: 20 }, (_, index) => paragraph(index)).join('\n\n')
    )

    assert.isAbove(chunks.length, 1)
    // La fin du premier morceau se retrouve en tête du second : un principe à cheval
    // sur la coupure reste énonçable d'un côté au moins.
    const tail = chunks[0].slice(-80)
    assert.include(chunks[1], tail)
  })

  test('un pavé sans respiration est tranché plutôt que rendu tel quel', ({ assert }) => {
    const chunks = chunkCourse('x'.repeat(MAX_CHUNK_CHARS * 2 + 500))

    assert.isAbove(chunks.length, 1)
    for (const chunk of chunks) assert.isAtMost(chunk.length, MAX_CHUNK_CHARS)
  })
})

/*
| Les brouillons s'écrivant au fil de l'eau, la déduplication ne fusionne plus des lots
| en fin de course : chaque lot est confronté à ce qui a **déjà été retenu**.
*/
test.group('LeitnerIngestionService / déduplication entre morceaux', () => {
  /** Rejoue des lots successifs, comme le fait la tâche de fond, morceau par morceau. */
  function keepAll(batches: DraftInput[][]): DraftInput[] {
    const seen = new Set<string>()
    return batches.flatMap((batch) => keepNewDrafts(batch, seen))
  }

  test('un principe énoncé deux fois ne donne pas deux cartes', ({ assert }) => {
    const kept = keepAll([
      [
        {
          front: 'Rôle du handshake TLS ?',
          back: 'Négocier les clés.',
          category: 'Réseau',
          theme: 'TLS',
        },
      ],
      // Même principe, rappelé en conclusion : autre casse, autre accent, autre ponctuation.
      [
        {
          front: 'role du handshake tls',
          back: 'Négocier clés et algorithmes.',
          category: 'Réseau',
          theme: 'TLS',
        },
      ],
      [{ front: 'Rôle du DNS ?', back: 'Résoudre les noms.', category: 'Réseau', theme: 'DNS' }],
    ])

    assert.lengthOf(kept, 2)
    // La première formulation gagne : c'est celle du morceau où le principe est posé.
    assert.equal(kept[0].back, 'Négocier les clés.')
  })

  test('le même recto sous deux thèmes reste deux cartes', ({ assert }) => {
    const kept = keepAll([
      [{ front: 'Rôle du proxy ?', back: 'Relayer.', category: 'Réseau', theme: 'HTTP' }],
      [{ front: 'Rôle du proxy ?', back: 'Relayer.', category: 'DevOps', theme: 'Docker' }],
    ])

    assert.lengthOf(kept, 2)
  })
})

/*
|------------------------------------------------------------------------------
| Le service, piloté par un faux client
|------------------------------------------------------------------------------
*/

const COURSE = `# TLS\n\n${'Le handshake négocie les clés. '.repeat(20)}`

test.group('LeitnerIngestionService / ingestion', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('écrit des brouillons, jamais des cartes', async ({ assert }) => {
    const ingestion = await ingest(service([ONE_CARD]).service, COURSE)

    assert.equal(ingestion.status, 'done')
    assert.equal(ingestion.cardsProposed, 1)
    assert.equal(ingestion.chunksDone, ingestion.chunkCount)

    assert.lengthOf(await LeitnerDraftCard.all(), 1)
    // Rien n'entre en base sans relecture : aucune carte n'a été créée.
    assert.lengthOf(await LeitnerCard.all(), 0)
  })

  test('le travail naît en attente, et rend la main avant le modèle', async ({ assert }) => {
    // Le modèle est retenu : tant qu'il ne répond pas, `start()` doit avoir rendu la
    // main. Un `await` sur la tâche de fond referait du synchrone — ce test le voit.
    let release: () => void
    const held = new Promise<void>((resolve) => (release = resolve))

    const { service: ingestionService } = service(async () => {
      await held
      return ONE_CARD
    })

    const ingestion = await ingestionService.start({ text: COURSE, source: 'paste' })

    assert.include(['pending', 'running'], ingestion.status)
    assert.equal(ingestion.cardsProposed, 0)
    assert.lengthOf(await LeitnerDraftCard.all(), 0)

    release!()
    await ingestionJobs()
    await ingestion.refresh()

    assert.equal(ingestion.status, 'done')
    assert.lengthOf(await LeitnerDraftCard.all(), 1)
  })

  test('déduplique les cartes entre morceaux', async ({ assert }) => {
    // Un cours assez long pour tenir en plusieurs morceaux, et un modèle qui répond
    // la même carte à chaque fois : le principe rappelé en conclusion.
    const long = `${'Le handshake négocie les clés et les algorithmes. '.repeat(400)}`
    const { service: ingestionService, llm } = service([ONE_CARD])

    const ingestion = await ingest(ingestionService, long)

    assert.isAbove(llm.calls.length, 1)
    assert.equal(ingestion.cardsProposed, 1)
    assert.lengthOf(await LeitnerDraftCard.all(), 1)
  })

  test('la progression avance morceau par morceau, et les brouillons avec elle', async ({
    assert,
  }) => {
    // Une carte différente par morceau : le compteur doit suivre le travail réel.
    const long = `${'Le handshake négocie les clés et les algorithmes. '.repeat(400)}`
    const { service: ingestionService } = service((_messages, call) =>
      JSON.stringify({ cards: [{ front: `Principe ${call} ?`, back: 'Un verso.' }] })
    )

    const ingestion = await ingest(ingestionService, long)

    assert.isAbove(ingestion.chunkCount, 1)
    assert.equal(ingestion.chunksDone, ingestion.chunkCount)
    assert.equal(ingestion.cardsProposed, ingestion.chunkCount)
    assert.lengthOf(await LeitnerDraftCard.all(), ingestion.chunkCount)
  })

  test('un échec en cours de route garde les brouillons déjà écrits, et le dit', async ({
    assert,
  }) => {
    // Rupture assumée avec l'import JSON (tout ou rien) : ici, les brouillons
    // s'écrivent au fil de l'eau. Ce sont des brouillons, pas des cartes.
    const long = `${'Le handshake négocie les clés et les algorithmes. '.repeat(400)}`
    const { service: ingestionService } = service((_messages, call) => {
      if (call === 0) return ONE_CARD
      throw new LlmUnavailableError('Le serveur LLM (http://127.0.0.1:1234/v1) est injoignable.')
    })

    const ingestion = await ingest(ingestionService, long)

    assert.equal(ingestion.status, 'failed')
    assert.include(ingestion.error!, 'injoignable')
    // Le premier morceau a produit sa carte : elle reste, et le compteur ne ment pas.
    assert.equal(ingestion.cardsProposed, 1)
    assert.lengthOf(await LeitnerDraftCard.all(), 1)
    // Ce qui n'entre jamais en base sans relecture, ce sont les cartes.
    assert.lengthOf(await LeitnerCard.all(), 0)
  })

  test('répare une seule fois un JSON illisible', async ({ assert }) => {
    const { service: ingestionService, llm } = service(['pas du JSON du tout', ONE_CARD])

    const ingestion = await ingest(ingestionService, COURSE)

    assert.equal(ingestion.status, 'done')
    assert.lengthOf(llm.calls, 2)
    // La réparation renvoie au modèle sa propre sortie et l'erreur.
    const repair = llm.calls[1]
    assert.equal(repair[repair.length - 2].role, 'assistant')
    assert.include(repair[repair.length - 1].content, "n'est pas exploitable")
  })

  test('une réparation qui échoue laisse une erreur lisible et aucun brouillon', async ({
    assert,
  }) => {
    const { service: ingestionService, llm } = service(['toujours pas du JSON'])

    const ingestion = await ingest(ingestionService, COURSE)

    assert.equal(ingestion.status, 'failed')
    assert.include(ingestion.error!, 'JSON')
    // Une seule réparation, jamais de boucle.
    assert.lengthOf(llm.calls, 2)
    assert.lengthOf(await LeitnerDraftCard.all(), 0)
  })

  test('un LLM injoignable échoue proprement, jamais en `running`', async ({ assert }) => {
    const { service: ingestionService } = service(() => {
      throw new LlmUnavailableError('Le serveur LLM (http://127.0.0.1:1234/v1) est injoignable.')
    })

    const ingestion = await ingest(ingestionService, COURSE)

    assert.equal(ingestion.status, 'failed')
    assert.include(ingestion.error!, 'injoignable')
    assert.lengthOf(await LeitnerDraftCard.all(), 0)
    assert.lengthOf(await LeitnerCard.all(), 0)
  })
})

test.group('LeitnerIngestionService / promotion des brouillons', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function ingestOne() {
    const { service: ingestionService } = service([ONE_CARD])
    const ingestion = await ingest(ingestionService, COURSE)
    const drafts = await LeitnerDraftCard.query().where('leitner_ingestion_id', ingestion.id)
    return { ingestionService, drafts }
  }

  test('valider un brouillon crée une carte en boîte 1, classée par son nom', async ({
    assert,
  }) => {
    const { ingestionService, drafts } = await ingestOne()

    const report = await ingestionService.accept([drafts[0].id])

    assert.equal(report.cardsCreated, 1)

    const cards = await LeitnerCard.query().preload('theme', (theme) => theme.preload('category'))
    assert.lengthOf(cards, 1)
    assert.equal(cards[0].box, 1)
    // La taxonomie est créée à la volée, à partir des noms — jamais d'un id.
    assert.equal(cards[0].theme.name, 'TLS')
    assert.equal(cards[0].theme.category.name, 'Réseau')

    await drafts[0].refresh()
    assert.equal(drafts[0].status, 'accepted')
    assert.equal(drafts[0].leitnerCardId, cards[0].id)
  })

  test('respecte la déduplication (recto, thème) du catalogue', async ({ assert }) => {
    const category = await LeitnerCategory.create({ name: 'Réseau' })
    const theme = await LeitnerTheme.create({ leitnerCategoryId: category.id, name: 'TLS' })
    const existing = await new LeitnerCatalogService().createCard({
      front: 'Rôle du handshake TLS ?',
      back: 'Un verso saisi à la main, qui ne doit pas être écrasé.',
      leitnerThemeId: theme.id,
    })

    const { ingestionService, drafts } = await ingestOne()
    const report = await ingestionService.accept([drafts[0].id])

    assert.equal(report.cardsCreated, 0)
    assert.equal(report.cardsSkipped, 1)

    // La carte existante survit telle quelle : son verso n'est jamais écrasé.
    assert.lengthOf(await LeitnerCard.all(), 1)
    await existing.refresh()
    assert.equal(existing.back, 'Un verso saisi à la main, qui ne doit pas être écrasé.')
  })

  test('refuse un classement à moitié rempli, et laisse le brouillon corrigeable', async ({
    assert,
  }) => {
    const { ingestionService, drafts } = await ingestOne()

    drafts[0].category = null
    await drafts[0].save()

    const report = await ingestionService.accept([drafts[0].id])

    assert.lengthOf(report.errors, 1)
    assert.equal(report.cardsCreated, 0)
    assert.lengthOf(await LeitnerCard.all(), 0)

    await drafts[0].refresh()
    assert.equal(drafts[0].status, 'pending')
  })

  test('un brouillon rejeté ne crée rien mais reste en trace', async ({ assert }) => {
    const { ingestionService, drafts } = await ingestOne()

    await ingestionService.reject([drafts[0].id])

    await drafts[0].refresh()
    assert.equal(drafts[0].status, 'rejected')
    assert.lengthOf(await LeitnerCard.all(), 0)

    // Un brouillon relu ne redevient jamais « en attente » : le valider ensuite ne fait rien.
    const report = await ingestionService.accept([drafts[0].id])
    assert.equal(report.cardsCreated, 0)
  })
})
