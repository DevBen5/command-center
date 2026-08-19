import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import type User from '#core/auth/models/user'
import { createUserWith } from '#tests/helpers/users'
import { makeCard } from '#tests/helpers/leitner'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCardSection from '#modules/leitner/models/leitner_card_section'
import LeitnerCourse from '#modules/leitner/models/leitner_course'
import LeitnerCourseSection from '#modules/leitner/models/leitner_course_section'
import LeitnerDraftCard from '#modules/leitner/models/leitner_draft_card'
import { ingestionJobs } from '#modules/leitner/services/leitner_ingestion_service'
import LlmClient, { type LlmMessage } from '#modules/leitner/services/llm_client'
import FakeLlmClient from '#tests/fakes/fake_llm_client'

/**
 * La provenance d'ingestion (CC-253) : d'où vient une carte générée, calculé
 * arithmétiquement (jamais déclaré par le LLM) — trois angles, trois groupes :
 * la pose du lien à la promotion, le sélecteur manuel de `/revision/settings`, et
 * son exposition dans le panneau de révision.
 */
const ONE_CARD = JSON.stringify({
  cards: [{ front: 'Rôle du handshake TLS ?', back: 'Négocier clés et algorithmes.' }],
})

/** Un seul titre : `chunkCourse` en tire un unique morceau, un unique slug (`tls`). */
const COURSE = `# TLS\n\n${'Le handshake TLS négocie les clés et les algorithmes. '.repeat(10)}`

test.group('Leitner / provenance à la promotion (CC-253)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.teardown(() => app.container.restore(LlmClient))

  function fakeLlm(responder: string[] | ((messages: LlmMessage[]) => string)) {
    app.container.swap(LlmClient, () => new FakeLlmClient(responder))
  }

  function login() {
    return createUserWith(['leitner.ingest'])
  }

  async function submitAndPromote(client: any, user: User, saveCourse: boolean) {
    await client
      .post('/revision/ingest')
      .json({ text: COURSE, saveCourse })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)
    await ingestionJobs()

    const draft = await LeitnerDraftCard.query().orderBy('id', 'asc').firstOrFail()
    await client
      .post('/revision/ingest/drafts/accept')
      .json({
        drafts: [
          { id: draft.id, front: draft.front, back: draft.back, category: null, theme: null },
        ],
      })
      .loginAs(user)
      .withCsrfToken()

    return draft
  }

  test('« conserver ce cours » coché : la promotion pose un lien `ingestion`', async ({
    client,
    assert,
  }) => {
    const user = await login()
    fakeLlm([ONE_CARD])

    await submitAndPromote(client, user, true)

    const card = await LeitnerCard.firstOrFail()
    const links = await LeitnerCardSection.query().where('leitner_card_id', card.id)
    assert.lengthOf(links, 1)
    assert.equal(links[0].origin, 'ingestion')

    const section = await LeitnerCourseSection.findOrFail(links[0].leitnerCourseSectionId)
    assert.equal(section.slug, 'tls')
  })

  test('« conserver ce cours » décoché : aucun lien n’est posé', async ({ client, assert }) => {
    const user = await login()
    fakeLlm([ONE_CARD])

    await submitAndPromote(client, user, false)

    assert.lengthOf(await LeitnerCardSection.all(), 0)
  })

  /**
   * ⚠️ La promotion EST le point de validation humaine, indépendamment du fait que le
   * catalogue avait déjà cette carte : `accept()` lie même quand `created` est `false`.
   */
  test('un doublon retrouvé au catalogue reçoit quand même son lien', async ({
    client,
    assert,
  }) => {
    const user = await login()
    // La carte existe déjà, non classée — exactement ce que produira le brouillon.
    await makeCard('Rôle du handshake TLS ?', { back: 'Une autre formulation.' })
    fakeLlm([ONE_CARD])

    await submitAndPromote(client, user, true)

    const cards = await LeitnerCard.all()
    assert.lengthOf(cards, 1, 'préalable : la déduplication a bien évité une seconde carte')

    const links = await LeitnerCardSection.query().where('leitner_card_id', cards[0].id)
    assert.lengthOf(links, 1)
    assert.equal(links[0].origin, 'ingestion')
  })
})

test.group('Leitner / sélecteur manuel de provenance (CC-253)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  function login() {
    return createUserWith(['leitner.cards.write'])
  }

  async function courseSection(ownerId: number, isShared: boolean, slug = 'http') {
    const course = await LeitnerCourse.create({
      title: `Cours ${slug}`,
      markdown: `# ${slug}\n\nContenu.`,
      contentHash: `empreinte-${slug}-${ownerId}`,
      source: 'paste',
      ownerId,
      isShared,
    })
    return LeitnerCourseSection.create({
      courseId: course.id,
      slug,
      headingPath: [slug],
      body: 'Contenu.',
      aliases: null,
      obsoleteAt: null,
    })
  }

  test('poser un lien manuel à la création d’une carte', async ({ client, assert }) => {
    const user = await login()
    const section = await courseSection(user.id, false)

    await client
      .post('/revision/cards')
      .json({ front: 'Recto', back: 'Verso', courseSectionId: section.id })
      .loginAs(user)
      .withCsrfToken()

    const card = await LeitnerCard.firstOrFail()
    const links = await LeitnerCardSection.query().where('leitner_card_id', card.id)
    assert.lengthOf(links, 1)
    assert.equal(links[0].origin, 'manuel')
    assert.equal(links[0].leitnerCourseSectionId, section.id)
  })

  test('remplacer le lien manuel ne le duplique pas, et ne touche pas un lien `ingestion`', async ({
    client,
    assert,
  }) => {
    const user = await login()
    const card = await makeCard('Recto', { ownerId: user.id, isShared: false })
    const sectionA = await courseSection(user.id, false, 'a')
    const sectionB = await courseSection(user.id, false, 'b')

    await LeitnerCardSection.create({
      leitnerCardId: card.id,
      leitnerCourseSectionId: sectionA.id,
      origin: 'manuel',
    })
    // Un lien de provenance réelle, posé par une ingestion antérieure : il ne doit
    // jamais être touché par ce sélecteur, qui ne gère que l'origine `manuel`.
    const sectionIngestion = await courseSection(user.id, false, 'origine-ingestion')
    await LeitnerCardSection.create({
      leitnerCardId: card.id,
      leitnerCourseSectionId: sectionIngestion.id,
      origin: 'ingestion',
    })

    await client
      .put(`/revision/cards/${card.id}`)
      .json({ front: card.front, back: card.back, courseSectionId: sectionB.id })
      .loginAs(user)
      .withCsrfToken()

    const links = await LeitnerCardSection.query()
      .where('leitner_card_id', card.id)
      .orderBy('origin', 'asc')
    assert.lengthOf(links, 2)
    const manual = links.find((link) => link.origin === 'manuel')!
    const ingestion = links.find((link) => link.origin === 'ingestion')!
    assert.equal(manual.leitnerCourseSectionId, sectionB.id)
    assert.equal(ingestion.leitnerCourseSectionId, sectionIngestion.id)
  })

  test('`courseSectionId: null` efface le lien manuel existant', async ({ client, assert }) => {
    const user = await login()
    const card = await makeCard('Recto', { ownerId: user.id, isShared: false })
    const section = await courseSection(user.id, false)
    await LeitnerCardSection.create({
      leitnerCardId: card.id,
      leitnerCourseSectionId: section.id,
      origin: 'manuel',
    })

    await client
      .put(`/revision/cards/${card.id}`)
      .json({ front: card.front, back: card.back, courseSectionId: null })
      .loginAs(user)
      .withCsrfToken()

    assert.lengthOf(await LeitnerCardSection.query().where('leitner_card_id', card.id), 0)
  })

  test('lier à une section d’un cours privé d’un autre compte est refusé, en silence', async ({
    client,
    assert,
  }) => {
    const user = await login()
    const stranger = await createUserWith(['leitner.cards.write'])
    const hiddenSection = await courseSection(stranger.id, false)

    const response = await client
      .post('/revision/cards')
      .json({ front: 'Recto', back: 'Verso', courseSectionId: hiddenSection.id })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    // La carte se crée quand même — seul le lien est refusé, pas la requête entière.
    response.assertStatus(302)
    const card = await LeitnerCard.firstOrFail()
    assert.lengthOf(await LeitnerCardSection.query().where('leitner_card_id', card.id), 0)
  })
})

test.group('Leitner / panneau de révision — provenance (CC-253)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function props(client: any, user: User) {
    const response = await client.get('/revision?scope=all').loginAs(user).withInertia()
    response.assertStatus(200)
    return response.inertiaProps as { dueCards: Array<{ id: number; provenance: unknown[] }> }
  }

  test('le lien explicite est exposé, rendu en HTML, avant toute recherche', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['leitner.view', 'leitner.review', 'leitner.courses.view'])
    const course = await LeitnerCourse.create({
      title: 'Réseaux',
      markdown: '# HTTP\n\nLes verbes.',
      contentHash: 'empreinte-panneau',
      source: 'paste',
      ownerId: user.id,
      isShared: false,
    })
    const section = await LeitnerCourseSection.create({
      courseId: course.id,
      slug: 'http',
      headingPath: ['HTTP'],
      body: 'Les *verbes*.',
      aliases: null,
      obsoleteAt: null,
    })
    const card = await makeCard('Une carte du corpus', { ownerId: user.id, isShared: false })
    await LeitnerCardSection.create({
      leitnerCardId: card.id,
      leitnerCourseSectionId: section.id,
      origin: 'ingestion',
    })

    const { dueCards } = await props(client, user)
    const [due] = dueCards
    assert.lengthOf(due.provenance, 1)
    const [provenance] = due.provenance as Array<{
      courseTitle: string
      bodyHtml: string
      obsoleteAt: string | null
    }>
    assert.equal(provenance.courseTitle, 'Réseaux')
    // Rendu SERVEUR (`renderMarkdown`) — jamais la source Markdown brute.
    assert.include(provenance.bodyHtml, '<em>verbes</em>')
    assert.isNull(provenance.obsoleteAt)
  })

  test('une section devenue obsolète reste affichée, en le disant', async ({ client, assert }) => {
    const user = await createUserWith(['leitner.view', 'leitner.review', 'leitner.courses.view'])
    const course = await LeitnerCourse.create({
      title: 'Réseaux',
      markdown: '# TLS\n\nLe handshake.',
      contentHash: 'empreinte-obsolete',
      source: 'paste',
      ownerId: user.id,
      isShared: false,
    })
    const section = await LeitnerCourseSection.create({
      courseId: course.id,
      slug: 'tls',
      headingPath: ['TLS'],
      body: 'Le handshake.',
      aliases: null,
      obsoleteAt: DateTime.now(),
    })
    const card = await makeCard('Carte liée à une section tombée', {
      ownerId: user.id,
      isShared: false,
    })
    await LeitnerCardSection.create({
      leitnerCardId: card.id,
      leitnerCourseSectionId: section.id,
      origin: 'ingestion',
    })

    const { dueCards } = await props(client, user)
    const [provenance] = dueCards[0].provenance as Array<{ obsoleteAt: string | null }>
    assert.isNotNull(provenance.obsoleteAt)
  })

  test('sans `leitner.courses.view`, la provenance est vide malgré un lien en base', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['leitner.view', 'leitner.review'])
    const course = await LeitnerCourse.create({
      title: 'Réseaux',
      markdown: '# HTTP\n\nLes verbes.',
      contentHash: 'empreinte-sans-capacite',
      source: 'paste',
      ownerId: user.id,
      isShared: true,
    })
    const section = await LeitnerCourseSection.create({
      courseId: course.id,
      slug: 'http',
      headingPath: ['HTTP'],
      body: 'Les verbes.',
      aliases: null,
      obsoleteAt: null,
    })
    const card = await makeCard('Une carte du corpus', { ownerId: user.id, isShared: false })
    await LeitnerCardSection.create({
      leitnerCardId: card.id,
      leitnerCourseSectionId: section.id,
      origin: 'manuel',
    })

    const { dueCards } = await props(client, user)
    assert.deepEqual(dueCards[0].provenance, [])
  })

  /**
   * ⚠️ Cas limite (pas atteignable par l'UI actuelle, mais possible en base) : une
   * carte visible dont le lien pointe vers un cours resté PRIVÉ d'un autre compte —
   * un admin qui aurait validé le brouillon d'une ingestion privée d'autrui, par
   * exemple. Le panneau ne doit jamais exposer ce cours par la bande.
   */
  test('un lien vers un cours resté privé d’un autre compte n’est jamais exposé', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['leitner.view', 'leitner.review', 'leitner.courses.view'])
    const stranger = await createUserWith(['leitner.view'])
    const hiddenCourse = await LeitnerCourse.create({
      title: 'Cours privé',
      markdown: '# Secret\n\nRien à voir.',
      contentHash: 'empreinte-cachee-panneau',
      source: 'paste',
      ownerId: stranger.id,
      isShared: false,
    })
    const hiddenSection = await LeitnerCourseSection.create({
      courseId: hiddenCourse.id,
      slug: 'secret',
      headingPath: ['Secret'],
      body: 'Rien à voir.',
      aliases: null,
      obsoleteAt: null,
    })
    const card = await makeCard('Carte visible, provenance cachée', {
      ownerId: user.id,
      isShared: false,
    })
    await LeitnerCardSection.create({
      leitnerCardId: card.id,
      leitnerCourseSectionId: hiddenSection.id,
      origin: 'ingestion',
    })

    const { dueCards } = await props(client, user)
    assert.deepEqual(dueCards[0].provenance, [])
  })
})
