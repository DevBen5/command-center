import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { createUserWith } from '#tests/helpers/users'
import GlossaryTerm from '#modules/corpus/models/glossary_term'
import { glossaryIndex } from '#bridges/leitner_corpus/glossary_index'
import LeitnerCourse from '#modules/corpus/models/leitner_course'
import LeitnerCourseSection from '#modules/corpus/models/leitner_course_section'
import { ownedSharedCorpusContentTable } from '#modules/corpus/services/course_account_deletion_guard'

function writer() {
  return createUserWith(['corpus.view', 'corpus.write'])
}

function postTerm(client: any, body: object, user: unknown) {
  return client
    .post('/corpus/glossaire')
    .json(body)
    .header('accept', 'application/json')
    .loginAs(user)
    .withCsrfToken()
}

test.group('Corpus — glossaire autonome (CC-277)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('édition complète, visibilité privée puis partagée et refus des écritures étrangères', async ({
    client,
    assert,
  }) => {
    const owner = await writer()
    const other = await writer()
    const created = await postTerm(client, { term: 'TLS', definition: 'Version initiale' }, owner)
    const id = created.body().term.id
    const denied = await client.get(`/corpus/glossaire/${id}`).loginAs(other)
    denied.assertStatus(403)
    assert.lengthOf(await glossaryIndex(other.id, false), 0)
    const updated = await client
      .put(`/corpus/glossaire/${id}`)
      .loginAs(owner)
      .withCsrfToken()
      .header('accept', 'application/json')
      .json({
        term: 'Transport',
        definition: '**Définition**',
        aliases: ['TLS'],
        isShared: true,
        sectionId: null,
      })
    updated.assertStatus(200)
    const shared = await client.get(`/corpus/glossaire/${id}`).loginAs(other)
    shared.assertStatus(200)
    assert.equal(await ownedSharedCorpusContentTable(owner.id), 'glossary_terms')
    assert.include(shared.body().definitionHtml, '<strong>Définition</strong>')
    const index = await glossaryIndex(other.id, false)
    assert.deepEqual(
      index.map((term) => term.term),
      ['Transport', 'TLS']
    )
    const refusedDelete = await client
      .delete(`/corpus/glossaire/${id}`)
      .loginAs(other)
      .withCsrfToken()
    refusedDelete.assertStatus(403)
    const deleted = await client.delete(`/corpus/glossaire/${id}`).loginAs(owner).withCsrfToken()
    deleted.assertStatus(204)
    assert.lengthOf(await glossaryIndex(other.id, false), 0)
    assert.isNull(await ownedSharedCorpusContentTable(owner.id))
  })

  test('ne propose ni ne révèle la section privée d’un autre compte', async ({
    client,
    assert,
  }) => {
    const owner = await writer()
    const other = await writer()
    const course = await LeitnerCourse.create({
      title: 'Secret',
      markdown: '# Secret',
      contentHash: 'secret',
      source: 'paste',
      ownerId: owner.id,
      isShared: false,
    })
    const section = await LeitnerCourseSection.create({
      courseId: course.id,
      slug: 'secret',
      headingPath: ['Secret'],
      body: 'Confidentiel',
    })
    const term = await GlossaryTerm.create({
      term: 'TLS',
      aliases: [],
      definition: 'Public',
      ownerId: owner.id,
      isShared: true,
      leitnerCourseSectionId: section.id,
    })
    const shown = await client.get(`/corpus/glossaire/${term.id}`).loginAs(other)
    assert.isNull(shown.body().sectionId)
    assert.isNull(shown.body().sectionHref)
    const page = await client.get('/corpus/glossaire').loginAs(other).withInertia()
    assert.deepEqual((page.inertiaProps as any).sections, [])
    const denied = await postTerm(
      client,
      { term: 'Autre', definition: 'Texte', sectionId: section.id },
      other
    )
    denied.assertStatus(403)
  })

  test('refuse sans droit d’écriture et assainit la définition', async ({ client, assert }) => {
    const reader = await createUserWith(['corpus.view'])
    const denied = await postTerm(client, { term: 'TLS', definition: 'Texte' }, reader)
    denied.assertStatus(403)
    const owner = await writer()
    const response = await postTerm(
      client,
      { term: 'TLS', definition: '<script>alert(1)</script> **Sûr**' },
      owner
    )
    const shown = await client.get(`/corpus/glossaire/${response.body().term.id}`).loginAs(owner)
    assert.notInclude(shown.body().definitionHtml, '<script>')
  })

  test('crée un terme privé avec définition libre puis le supprime immédiatement', async ({
    client,
    assert,
  }) => {
    const user = await writer()
    const response = await postTerm(
      client,
      { term: 'TLS', aliases: ['Transport Layer Security'], definition: 'Un protocole.' },
      user
    )

    response.assertStatus(201)
    const term = await GlossaryTerm.findOrFail(response.body().term.id)
    assert.equal(term.term, 'TLS')
    assert.deepEqual(term.aliases, ['Transport Layer Security'])
    assert.isFalse(term.isShared)
    assert.isNull(term.leitnerCourseSectionId)

    const deleted = await client
      .delete(`/corpus/glossaire/${term.id}`)
      .loginAs(user)
      .withCsrfToken()
    deleted.assertStatus(204)
    assert.isNull(await GlossaryTerm.find(term.id))
  })
})
