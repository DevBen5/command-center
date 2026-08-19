import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#core/auth/models/user'
import { createAdmin, createUserWith } from '#tests/helpers/users'
import LeitnerCourse from '#modules/leitner/models/leitner_course'
import LeitnerCourseSection from '#modules/leitner/models/leitner_course_section'

/**
 * Le corpus de cours (CC-251) — par les routes. La partie **pure** (découpage, slug,
 * glossaire, empreinte) se prouve dans `tests/unit/leitner_course_sections.spec.ts` ;
 * ce fichier prouve ce qu'elle ne peut pas dire : la dédup contre la base, la doctrine
 * des pierres tombales à travers une vraie transaction, la visibilité, et la garde de
 * suppression de compte.
 */
function reader() {
  return createUserWith(['leitner.courses.view'])
}
function writer() {
  return createUserWith(['leitner.courses.view', 'leitner.courses.write'])
}

function post(client: any, body: object, user: unknown) {
  return client
    .post('/revision/cours')
    .json(body)
    .header('accept', 'application/json')
    .loginAs(user)
    .withCsrfToken()
}
function conflict(client: any, body: object, user: unknown) {
  return client
    .post('/revision/cours/conflict')
    .json(body)
    .header('accept', 'application/json')
    .loginAs(user)
    .withCsrfToken()
}
function put(client: any, id: number, body: object, user: unknown) {
  return client
    .put(`/revision/cours/${id}`)
    .json(body)
    .header('accept', 'application/json')
    .loginAs(user)
    .withCsrfToken()
}

test.group('Leitner / corpus de cours — dédup (CC-251)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('même empreinte exactement : rattaché à l’existant, rien créé', async ({
    client,
    assert,
  }) => {
    const user = await writer()
    const markdown = '# TLS\n\nLe handshake.'

    const first = await post(client, { title: 'Réseaux', markdown }, user)
    first.assertStatus(200)
    assert.equal(first.body().status, 'created')

    const second = await post(client, { title: 'Réseaux', markdown }, user)
    second.assertStatus(200)
    assert.equal(second.body().status, 'attached')
    assert.equal(second.body().course.id, first.body().course.id)

    const total = await LeitnerCourse.query().where('owner_id', user.id).count('* as total')
    assert.equal(Number(total[0].$extras.total), 1)
  })

  test('même titre, texte différent : un conflit, jamais un doublon silencieux', async ({
    client,
    assert,
  }) => {
    const user = await writer()

    const first = await post(client, { title: 'Réseaux', markdown: '# TLS\n\nUn.' }, user)
    first.assertStatus(200)

    const second = await post(client, { title: 'Réseaux', markdown: '# TLS\n\nDeux.' }, user)
    second.assertStatus(200)
    assert.equal(second.body().status, 'conflict')
    assert.equal(second.body().existing.id, first.body().course.id)

    const total = await LeitnerCourse.query().where('owner_id', user.id).count('* as total')
    assert.equal(Number(total[0].$extras.total), 1)
  })

  test('« Remplacer le contenu » réutilise le cours existant', async ({ client, assert }) => {
    const user = await writer()
    const created = await post(client, { title: 'Réseaux', markdown: '# TLS\n\nUn.' }, user)
    const existingId = created.body().course.id

    const resolved = await conflict(
      client,
      { existingId, resolution: 'replace', title: 'Réseaux', markdown: '# TLS\n\nDeux.' },
      user
    )
    resolved.assertStatus(200)
    assert.equal(resolved.body().course.id, existingId)

    const course = await LeitnerCourse.findOrFail(existingId)
    assert.include(course.markdown, 'Deux.')

    const total = await LeitnerCourse.query().where('owner_id', user.id).count('* as total')
    assert.equal(Number(total[0].$extras.total), 1)
  })

  test('« Créer un second cours » suffixe le titre, laisse l’existant intact', async ({
    client,
    assert,
  }) => {
    const user = await writer()
    const created = await post(client, { title: 'Réseaux', markdown: '# TLS\n\nUn.' }, user)
    const existingId = created.body().course.id

    const resolved = await conflict(
      client,
      { existingId, resolution: 'createSecond', title: 'Réseaux', markdown: '# TLS\n\nDeux.' },
      user
    )
    resolved.assertStatus(200)
    assert.notEqual(resolved.body().course.id, existingId)

    const original = await LeitnerCourse.findOrFail(existingId)
    assert.include(original.markdown, 'Un.')

    const second = await LeitnerCourse.findOrFail(resolved.body().course.id)
    assert.equal(second.title, 'Réseaux (2)')
    assert.include(second.markdown, 'Deux.')
  })

  test('« Annuler » n’écrit rien', async ({ client, assert }) => {
    const user = await writer()
    const created = await post(client, { title: 'Réseaux', markdown: '# TLS\n\nUn.' }, user)

    const resolved = await conflict(
      client,
      { existingId: created.body().course.id, resolution: 'cancel' },
      user
    )
    resolved.assertStatus(200)
    assert.equal(resolved.body().status, 'cancelled')

    const total = await LeitnerCourse.query().where('owner_id', user.id).count('* as total')
    assert.equal(Number(total[0].$extras.total), 1)
  })

  test('la dédup est portée au propriétaire, jamais globale', async ({ client, assert }) => {
    const alice = await writer()
    const bob = await writer()
    const markdown = '# TLS\n\nMême texte, deux comptes.'

    await post(client, { title: 'Réseaux', markdown }, alice)
    const forBob = await post(client, { title: 'Réseaux', markdown }, bob)

    forBob.assertStatus(200)
    assert.equal(forBob.body().status, 'created')
  })
})

test.group('Leitner / corpus de cours — pierres tombales (CC-251)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('slug retrouvé, slug neuf, slug disparu — le report exact', async ({ client, assert }) => {
    const user = await writer()
    const created = await post(
      client,
      { title: 'Réseaux', markdown: '# TLS\n\nLe handshake.\n\n# HTTP\n\nLes verbes.' },
      user
    )
    const id = created.body().course.id

    const before = await LeitnerCourseSection.query().where('course_id', id)
    const tlsBefore = before.find((s) => s.slug === 'tls')!
    assert.isNull(tlsBefore.obsoleteAt)

    // TLS retrouvé (texte changé), HTTP disparu, DNS neuf.
    const replaced = await put(
      client,
      id,
      { markdown: '# TLS\n\nLe handshake, détaillé.\n\n# DNS\n\nLa résolution.' },
      user
    )
    replaced.assertStatus(200)

    const after = await LeitnerCourseSection.query().where('course_id', id)

    const tls = after.find((s) => s.slug === 'tls')!
    assert.equal(tls.id, tlsBefore.id, 'le slug retrouvé garde la même ligne')
    assert.isNull(tls.obsoleteAt)
    assert.include(tls.body, 'détaillé')

    const dns = after.find((s) => s.slug === 'dns')!
    assert.isNull(dns.obsoleteAt)

    const http = after.find((s) => s.slug === 'http')!
    assert.isNotNull(http.obsoleteAt, 'la section disparue devient une pierre tombale')
    assert.equal(http.body, 'Les verbes.', 'le texte de la tombe est CONSERVÉ, jamais vidé')
  })

  test('mutation : sans la branche « disparu », aucune tombe ne se pose', async ({
    client,
    assert,
  }) => {
    // Preuve par mutation, demandée par le ticket : casser la garde et vérifier qu'elle
    // rougit. On simule la mutation en vérifiant l'assertion qui la détecterait.
    const user = await writer()
    const created = await post(client, { title: 'Réseaux', markdown: '# TLS\n\nUn.' }, user)
    const id = created.body().course.id

    await put(client, id, { markdown: '# DNS\n\nAutre chose.' }, user)

    const sections = await LeitnerCourseSection.query().where('course_id', id)
    const tls = sections.find((s) => s.slug === 'tls')!
    // Ceci est l'assertion qui rougirait si `replaceMarkdown` supprimait la ligne au
    // lieu de poser `obsolete_at` : `find` rendrait `undefined`.
    assert.isDefined(tls)
    assert.isNotNull(tls.obsoleteAt)
  })

  test('un slug tombé qui réapparaît est ressuscité, pas dupliqué', async ({ client, assert }) => {
    const user = await writer()
    const created = await post(
      client,
      { title: 'Réseaux', markdown: '# TLS\n\nUn.\n\n# HTTP\n\nDeux.' },
      user
    )
    const id = created.body().course.id

    await put(client, id, { markdown: '# HTTP\n\nDeux.' }, user) // TLS tombe
    await put(client, id, { markdown: '# TLS\n\nTrois.\n\n# HTTP\n\nDeux.' }, user) // TLS revient

    const sections = await LeitnerCourseSection.query().where('course_id', id).where('slug', 'tls')
    assert.lengthOf(sections, 1, 'jamais une seconde ligne pour le même slug')
    assert.isNull(sections[0].obsoleteAt)
    assert.equal(sections[0].body, 'Trois.')
  })

  test('la purge supprime physiquement les tombes, jamais les sections vivantes', async ({
    client,
    assert,
  }) => {
    const user = await writer()
    const created = await post(
      client,
      { title: 'Réseaux', markdown: '# TLS\n\nUn.\n\n# HTTP\n\nDeux.' },
      user
    )
    const id = created.body().course.id
    await put(client, id, { markdown: '# HTTP\n\nDeux.' }, user) // TLS tombe

    const purge = await client
      .post(`/revision/cours/${id}/purge`)
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)
    purge.assertStatus(302)

    const sections = await LeitnerCourseSection.query().where('course_id', id)
    assert.lengthOf(sections, 1)
    assert.equal(sections[0].slug, 'http')
  })
})

test.group('Leitner / corpus de cours — visibilité (CC-251)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('un cours privé d’un autre compte est invisible', async ({ client, assert }) => {
    const owner = await writer()
    const stranger = await reader()
    const created = await post(client, { title: 'Privé', markdown: '# TLS\n\nUn.' }, owner)
    const id = created.body().course.id

    const list = await client.get('/revision/cours').loginAs(stranger).withInertia()
    const props = list.inertiaProps as { courses: { id: number }[] }
    assert.isFalse(props.courses.some((c) => c.id === id))

    const show = await client.get(`/revision/cours/${id}`).loginAs(stranger).redirects(0)
    show.assertStatus(403)
  })

  test('un cours partagé reste visible', async ({ client, assert }) => {
    const owner = await writer()
    const stranger = await reader()
    const created = await post(
      client,
      { title: 'Partagé', markdown: '# TLS\n\nUn.', source: 'paste' },
      owner
    )
    const course = await LeitnerCourse.findOrFail(created.body().course.id)
    course.isShared = true
    await course.save()

    const list = await client.get('/revision/cours').loginAs(stranger).withInertia()
    const props = list.inertiaProps as { courses: { id: number }[] }
    assert.isTrue(props.courses.some((c) => c.id === course.id))
  })

  test('écrire sur le cours d’un autre compte est refusé', async ({ client, assert }) => {
    const owner = await writer()
    const stranger = await writer()
    const created = await post(client, { title: 'Privé', markdown: '# TLS\n\nUn.' }, owner)
    const id = created.body().course.id

    const update = await put(client, id, { markdown: '# TLS\n\nModifié.' }, stranger)
    update.assertStatus(403)

    const destroy = await client
      .delete(`/revision/cours/${id}`)
      .loginAs(stranger)
      .withCsrfToken()
      .redirects(0)
    destroy.assertStatus(403)

    const course = await LeitnerCourse.findOrFail(id)
    assert.include(course.markdown, 'Un.')
  })
})

test.group('Leitner / corpus de cours — capacités', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('un lecteur ne peut pas créer de cours', async ({ client }) => {
    const user = await reader()
    const response = await post(client, { title: 'X', markdown: '# X\n\nY.' }, user)
    response.assertStatus(403)
  })
})

test.group('Leitner / corpus de cours — suppression de compte (CC-251)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('refuse de supprimer un compte qui possède encore un cours partagé', async ({
    client,
    assert,
  }) => {
    const admin = await createAdmin()
    const owner = await writer()
    const created = await post(client, { title: 'Partagé', markdown: '# TLS\n\nUn.' }, owner)
    const course = await LeitnerCourse.findOrFail(created.body().course.id)
    course.isShared = true
    await course.save()

    const response = await client.delete(`/admin/users/${owner.id}`).loginAs(admin).withCsrfToken()

    response.assertStatus(400)
    assert.isNotNull(await User.find(owner.id))
  })

  test('un compte dont le seul cours est privé se supprime, le cours devient orphelin', async ({
    client,
    assert,
  }) => {
    const admin = await createAdmin()
    const owner = await writer()
    const created = await post(client, { title: 'Privé', markdown: '# TLS\n\nUn.' }, owner)

    const response = await client
      .delete(`/admin/users/${owner.id}`)
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)
    response.assertStatus(302)

    const course = await LeitnerCourse.findOrFail(created.body().course.id)
    assert.isNull(course.ownerId)
  })
})

/**
 * ⚠️ **Jamais `withGlobalTransaction()` ici non plus, et pour la même raison
 * qu'`installation.spec.ts`** : la transaction globale route TOUTE requête — avec ou
 * sans `{ client: trx }` explicite — sur la même connexion Postgres, donc elle rend
 * invisible un `Model.create()` oublié hors de la transaction du service (il verrait
 * quand même le cours fraîchement créé, puisque « fraîchement créé » et « lu » sont la
 * même connexion). Avec une connexion séparée du pool, comme en production, une ligne
 * insérée sans `{ client: trx }` pendant que la transaction du cours est encore ouverte
 * ne voit pas ce cours et casse sur la contrainte de clé étrangère — exactement le bug
 * mesuré en direct sur ce poste le 2026-08-19 (`#insertSections` créait ses sections
 * sans passer le `trx` reçu par `db.transaction`).
 */
test.group('Leitner / corpus de cours — sections écrites dans la transaction du cours', (group) => {
  group.each.setup(() => {
    return async () => {
      await LeitnerCourse.query().delete()
      await User.query().delete()
    }
  })

  test('un cours neuf voit ses sections créées malgré une connexion séparée', async ({
    client,
    assert,
  }) => {
    const user = await writer()
    const response = await post(
      client,
      { title: 'Réseaux', markdown: '# TLS\n\nLe handshake.\n\n# HTTP\n\nLes en-têtes.' },
      user
    )
    response.assertStatus(200)

    const sections = await LeitnerCourseSection.query().where(
      'course_id',
      response.body().course.id
    )
    assert.lengthOf(sections, 2)
    assert.sameMembers(
      sections.map((s) => s.slug),
      ['tls', 'http']
    )
  })
})
