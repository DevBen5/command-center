import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import enabledModules from '#config/modules'
import { createUserWith } from '#tests/helpers/users'
import { makeCard } from '#tests/helpers/leitner'
import LeitnerCourseSection from '#modules/corpus/models/leitner_course_section'

/**
 * Les mots-clés du recto (CC-254) — l'index de glossaire, consommé côté serveur depuis
 * CC-276 (`frontNodes` sur `/revision`, plus aucun `glossary` brut envoyé au client), et la
 * route de contenu (`GET /corpus/sections/:id`). Le tokeniseur pur est prouvé dans
 * `tests/unit/leitner_glossary_highlight.spec.ts`, le reparcours HTML+glossaire dans
 * `tests/unit/leitner_front_html.spec.ts` ; ce fichier prouve ce qu'aucun des deux ne peut
 * dire : la visibilité contre la base, la capacité, l'exclusion des tombes — observées à
 * travers le jeton cliquable (ou son absence) que le recto d'une carte due reçoit vraiment.
 */

/** Les jetons (texte + sectionId) de tout `frontNodes`, toutes profondeurs. */
function frontTokens(nodes: any[]): Array<{ texte: string; sectionId: number | null }> {
  const tokens: Array<{ texte: string; sectionId: number | null }> = []
  for (const node of nodes) {
    if (node.type === 'text') tokens.push(...node.tokens)
    else tokens.push(...frontTokens(node.children))
  }
  return tokens
}
function reader() {
  // `leitner.view` : sans elle, `GET /revision` répond 403 avant même d'atteindre l'index de
  // glossaire — la garde est sur la ROUTE de révision, distincte de `corpus.view`.
  return createUserWith(['leitner.view', 'corpus.view'])
}
function writer() {
  return createUserWith(['leitner.view', 'corpus.view', 'corpus.write'])
}

function postCourse(client: any, body: object, user: unknown) {
  return client
    .post('/corpus')
    .json(body)
    .header('accept', 'application/json')
    .loginAs(user)
    .withCsrfToken()
}

const COURSE_MARKDOWN =
  '# TLS\n\n> notion: TLS, Transport Layer Security\n\nLe protocole TLS négocie des clés.'

test.group('Leitner / glossaire — index et contenu (CC-254)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('un terme d’un cours visible produit un jeton cliquable dans le recto d’une carte due', async ({
    client,
    assert,
  }) => {
    const user = await writer()
    await postCourse(client, { title: 'Réseaux', markdown: COURSE_MARKDOWN }, user)
    await makeCard('Le protocole TLS est robuste.', { ownerId: user.id })

    const response = await client.get('/revision?scope=all').loginAs(user).withInertia()
    const props = response.inertiaProps as Record<string, any>
    const tokens = frontTokens(props.dueCards[0].frontNodes)

    assert.isTrue(tokens.some((t) => t.texte === 'TLS' && t.sectionId !== null))
  })

  test('mutation : un terme d’un cours privé d’un autre compte ne rend jamais de jeton cliquable', async ({
    client,
    assert,
  }) => {
    const owner = await writer()
    const stranger = await reader()
    await postCourse(client, { title: 'Privé', markdown: COURSE_MARKDOWN }, owner)
    await makeCard('Le protocole TLS est robuste.', { ownerId: stranger.id })

    const response = await client.get('/revision?scope=all').loginAs(stranger).withInertia()
    const props = response.inertiaProps as Record<string, any>
    const tokens = frontTokens(props.dueCards[0].frontNodes)

    assert.isFalse(tokens.some((t) => t.sectionId !== null))
  })

  test('sans corpus.view, aucun jeton du recto n’est cliquable', async ({ client, assert }) => {
    const user = await createUserWith(['leitner.view', 'leitner.review'])
    await makeCard('Le protocole TLS est robuste.', { ownerId: user.id })

    const response = await client.get('/revision?scope=all').loginAs(user).withInertia()
    const props = response.inertiaProps as Record<string, any>
    const tokens = frontTokens(props.dueCards[0].frontNodes)

    assert.isFalse(tokens.some((t) => t.sectionId !== null))
  })

  test('mutation : une section tombée ne rend plus de jeton cliquable', async ({
    client,
    assert,
  }) => {
    const user = await writer()
    const created = await postCourse(client, { title: 'Réseaux', markdown: COURSE_MARKDOWN }, user)
    const courseId = (created.body() as { course: { id: number } }).course.id

    // Remplace : TLS disparaît du markdown, la section devient une pierre tombale.
    await client
      .put(`/corpus/${courseId}`)
      .json({ markdown: '# DNS\n\nLa résolution de noms.' })
      .header('accept', 'application/json')
      .loginAs(user)
      .withCsrfToken()

    const tombstone = await LeitnerCourseSection.query()
      .where('course_id', courseId)
      .where('slug', 'tls')
      .firstOrFail()
    assert.isNotNull(tombstone.obsoleteAt, 'préalable : la section est bien tombée')

    await makeCard('Le protocole TLS est robuste.', { ownerId: user.id })
    const response = await client.get('/revision?scope=all').loginAs(user).withInertia()
    const props = response.inertiaProps as Record<string, any>
    const tokens = frontTokens(props.dueCards[0].frontNodes)

    assert.isFalse(tokens.some((t) => t.sectionId !== null))
  })

  test('GET /corpus/sections/:id rend le contenu d’une section visible', async ({
    client,
    assert,
  }) => {
    const user = await writer()
    const created = await postCourse(client, { title: 'Réseaux', markdown: COURSE_MARKDOWN }, user)
    const courseId = (created.body() as { course: { id: number } }).course.id
    const section = await LeitnerCourseSection.query()
      .where('course_id', courseId)
      .where('slug', 'tls')
      .firstOrFail()

    const response = await client
      .get(`/corpus/sections/${section.id}`)
      .loginAs(user)
      .header('accept', 'application/json')
    response.assertStatus(200)

    const body = response.body() as { courseId: number; headingPath: string[]; bodyHtml: string }
    assert.equal(body.courseId, courseId)
    assert.deepEqual(body.headingPath, ['TLS'])
    assert.include(body.bodyHtml, 'négocie des clés')
  })

  test('sans corpus.view, la route refuse', async ({ client }) => {
    const owner = await writer()
    const stranger = await createUserWith(['leitner.review'])
    const created = await postCourse(client, { title: 'Réseaux', markdown: COURSE_MARKDOWN }, owner)
    const courseId = (created.body() as { course: { id: number } }).course.id
    const section = await LeitnerCourseSection.query().where('course_id', courseId).firstOrFail()

    const response = await client
      .get(`/corpus/sections/${section.id}`)
      .loginAs(stranger)
      .header('accept', 'application/json')
    response.assertStatus(403)
  })

  test('une section d’un cours privé d’un autre compte est refusée, capacité comprise', async ({
    client,
  }) => {
    const owner = await writer()
    const stranger = await reader()
    const created = await postCourse(client, { title: 'Privé', markdown: COURSE_MARKDOWN }, owner)
    const courseId = (created.body() as { course: { id: number } }).course.id
    const section = await LeitnerCourseSection.query().where('course_id', courseId).firstOrFail()

    const response = await client
      .get(`/corpus/sections/${section.id}`)
      .loginAs(stranger)
      .header('accept', 'application/json')
    response.assertStatus(403)
  })
})

/**
 * `/revision` sans le module corpus (CC-275) : même un compte qui porte `corpus.view`
 * (grant orphelin possible — rien ne le retire automatiquement, voir `capabilities.ts`)
 * ne doit jamais déclencher une requête SQL vers `leitner_course_sections`, absente.
 * Patron `enabledModules.delete/add` de `dashboard_scope.spec.ts` (CC-137) — c'est la
 * seule façon d'éprouver ce chemin sans redémarrer le process, `.env.test` activant tous
 * les modules connus ensemble par doctrine.
 */
test.group('Leitner / révision sans le module corpus (CC-275)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(() => {
    enabledModules.delete('corpus')
    return () => {
      enabledModules.add('corpus')
    }
  })

  test('une carte due se rend normalement : recto Markdown intact, aucun jeton cliquable', async ({
    client,
    assert,
  }) => {
    // `corpus.view` accordée quand même : la garde doit être `isModuleEnabled('corpus')`,
    // pas seulement l'absence de la capacité — sans quoi ce test passerait par coïncidence.
    const user = await createUserWith(['leitner.view', 'leitner.review', 'corpus.view'])
    await makeCard('Le protocole **TLS** est robuste.', { ownerId: user.id })

    const response = await client.get('/revision?scope=all').loginAs(user).withInertia()
    response.assertStatus(200)

    const props = response.inertiaProps as Record<string, any>
    const tokens = frontTokens(props.dueCards[0].frontNodes)
    // Le recto garde son rendu Markdown (CC-276) — seul le soulignement disparaît.
    assert.isTrue(tokens.some((t) => t.texte === 'TLS'))
    assert.isFalse(tokens.some((t) => t.sectionId !== null))
    assert.deepEqual(props.dueCards[0].provenance, [])
  })
})
