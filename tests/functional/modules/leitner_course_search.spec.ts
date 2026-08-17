import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { createUserWith } from '#tests/helpers/users'
import { makeCard } from '#tests/helpers/leitner'
import LeitnerCourseSection from '#modules/leitner/models/leitner_course_section'

/**
 * « Approfondir » (CC-252) — la route `GET /:id/course-search`, par les routes. La
 * construction pure de la requête est prouvée dans `tests/unit/leitner_course_search.spec.ts` ;
 * ce fichier prouve ce qu'elle ne peut pas dire : la visibilité contre la base, la
 * capacité, l'exclusion des tombes et le classement.
 */
function reader() {
  return createUserWith(['leitner.courses.view'])
}
function writer() {
  return createUserWith(['leitner.courses.view', 'leitner.courses.write'])
}

function postCourse(client: any, body: object, user: unknown) {
  return client
    .post('/revision/cours')
    .json(body)
    .header('accept', 'application/json')
    .loginAs(user)
    .withCsrfToken()
}

test.group('Leitner / recherche du corpus — visibilité et classement (CC-252)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('la section la plus proche du recto revient en tête', async ({ client, assert }) => {
    const user = await writer()
    await postCourse(
      client,
      {
        title: 'Réseaux',
        markdown:
          '# TLS\n\nLe protocole TLS négocie des clés lors du handshake.\n\n# HTTP\n\nLes verbes du protocole HTTP.',
      },
      user
    )
    const card = await makeCard('Que négocie le handshake TLS ?', { ownerId: user.id })

    const response = await client.get(`/revision/${card.id}/course-search`).loginAs(user)
    response.assertStatus(200)

    const results = response.body().results as Array<{ courseTitle: string; headingPath: string[] }>
    assert.isAbove(results.length, 0)
    assert.deepEqual(results[0].headingPath, ['TLS'])
  })

  test('une section d’un cours privé d’un autre compte n’apparaît jamais', async ({
    client,
    assert,
  }) => {
    const owner = await writer()
    const stranger = await reader()
    await postCourse(
      client,
      { title: 'Privé', markdown: '# TLS\n\nLe handshake TLS négocie des clés.' },
      owner
    )
    const card = await makeCard('Que négocie le handshake TLS ?', { ownerId: stranger.id })

    const response = await client.get(`/revision/${card.id}/course-search`).loginAs(stranger)
    response.assertStatus(200)

    const results = response.body().results as unknown[]
    assert.lengthOf(results, 0)
  })

  test('sans leitner.courses.view, la route refuse', async ({ client }) => {
    const user = await createUserWith(['leitner.review'])
    const card = await makeCard('Peu importe', { ownerId: user.id })

    const response = await client.get(`/revision/${card.id}/course-search`).loginAs(user)
    response.assertStatus(403)
  })

  test('une carte privée d’un autre compte est refusée, capacité comprise', async ({ client }) => {
    const owner = await writer()
    const stranger = await writer()
    const card = await makeCard('Peu importe', { ownerId: owner.id })

    const response = await client.get(`/revision/${card.id}/course-search`).loginAs(stranger)
    response.assertStatus(403)
  })

  test('mutation : sans l’exclusion des tombes, une section obsolète remonterait', async ({
    client,
    assert,
  }) => {
    const user = await writer()
    const created = await postCourse(
      client,
      { title: 'Réseaux', markdown: '# TLS\n\nLe handshake TLS négocie des clés.' },
      user
    )
    const courseId = created.body().course.id as number
    // Remplace : TLS disparaît du markdown, la section devient une pierre tombale.
    await client
      .put(`/revision/cours/${courseId}`)
      .json({ markdown: '# DNS\n\nLa résolution de noms.' })
      .header('accept', 'application/json')
      .loginAs(user)
      .withCsrfToken()

    const tombstone = await LeitnerCourseSection.query()
      .where('course_id', courseId)
      .where('slug', 'tls')
      .firstOrFail()
    assert.isNotNull(tombstone.obsoleteAt, 'préalable : la section est bien tombée')

    const card = await makeCard('Que négocie le handshake TLS ?', { ownerId: user.id })
    const response = await client.get(`/revision/${card.id}/course-search`).loginAs(user)
    response.assertStatus(200)

    const results = response.body().results as Array<{ headingPath: string[] }>
    // Ceci est l'assertion qui rougirait si la garde `whereNull('obsolete_at')` disparaissait :
    // la section tombée, seule à contenir « handshake TLS », ne doit jamais remonter.
    assert.isFalse(results.some((r) => r.headingPath.includes('TLS')))
  })
})
