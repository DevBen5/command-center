import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import User from '#core/auth/models/user'
import VeilleItem from '#modules/veille/models/veille_item'
import VeilleSource from '#modules/veille/models/veille_source'

/**
 * CC-20 : `VeilleController` n'avait **aucun test** hors le smoke test « la page rend ».
 * Ni la recherche plein texte (du SQL brut), ni le filtre par tag, ni `store`, ni `toggleQueue`.
 *
 * Fonctionnel plutôt qu'unitaire : le module est mince, la logique est dans la requête.
 */
test.group('Veille / liste, filtres et recherche', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function login() {
    return User.create({
      fullName: 'Utilisateur Test',
      email: 'test@example.com',
      password: 'secret123',
    })
  }

  async function item(attrs: Partial<VeilleItem> = {}) {
    return VeilleItem.create({
      type: 'article',
      title: 'Titre par défaut',
      tags: [],
      metadata: {},
      readingQueue: false,
      ...attrs,
    })
  }

  async function itemsOf(client: any, user: User, query: Record<string, unknown> = {}) {
    const response = await client.get('/veille').qs(query).loginAs(user).withInertia()
    response.assertStatus(200)
    return response.inertiaProps as {
      items: { id: number; title: string }[]
      stats: { total: number; articles: number; queue: number; unread: number; tags: number }
      tags: string[]
      pagination: { total: number; lastPage: number; currentPage: number }
    }
  }

  test('la recherche plein texte trouve sur le titre et le contenu', async ({ assert, client }) => {
    const user = await login()
    await item({ title: 'Pipeline RAG local', content: 'Monter un pipeline entièrement local.' })
    await item({ title: 'Sortie de Traefik 3', content: 'Middlewares et configuration.' })

    const parTitre = await itemsOf(client, user, { search: 'pipeline' })
    assert.lengthOf(parTitre.items, 1)
    assert.equal(parTitre.items[0].title, 'Pipeline RAG local')

    const parContenu = await itemsOf(client, user, { search: 'middlewares' })
    assert.lengthOf(parContenu.items, 1)
    assert.equal(parContenu.items[0].title, 'Sortie de Traefik 3')
  })

  test('LE test de CC-20 : la recherche tient sur une entrée hostile', async ({
    assert,
    client,
  }) => {
    const user = await login()
    await item({ title: "L'oubli et la répétition espacée" })

    // Le `whereRaw` est paramétré (binding `?`), jamais concaténé : ces entrées doivent
    // traverser sans casser et sans exécuter quoi que ce soit. Une concaténation ferait
    // exploser la requête sur la première.
    for (const hostile of [
      "l'oubli",
      "'; DROP TABLE veille_items; --",
      'a & b | c',
      '<script>',
      '\\',
      '%',
      '‘’“”',
    ]) {
      const response = await client
        .get('/veille')
        .qs({ search: hostile })
        .loginAs(user)
        .withInertia()

      response.assertStatus(200)
    }

    // La table est toujours là, et son contenu aussi.
    assert.lengthOf(await VeilleItem.all(), 1)
  })

  test('la recherche par apostrophe trouve réellement l’item', async ({ assert, client }) => {
    const user = await login()
    await item({ title: "L'oubli et la répétition espacée" })

    // ⚠️ Un test qui n'asserterait que « ça ne casse pas » passerait aussi avec une requête
    // qui ne rend jamais rien. C'est le résultat qui compte.
    const props = await itemsOf(client, user, { search: 'oubli' })
    assert.lengthOf(props.items, 1)
  })

  test('le filtre par tag marche, accents compris', async ({ assert, client }) => {
    const user = await login()
    await item({ title: 'À lire', tags: ['à-lire', 'ia'] })
    await item({ title: 'Rust', tags: ['rust'] })

    const props = await itemsOf(client, user, { tag: 'à-lire' })
    assert.lengthOf(props.items, 1)
    assert.equal(props.items[0].title, 'À lire')
  })

  test('le filtre par type ne rend que ce type', async ({ assert, client }) => {
    const user = await login()
    await item({ type: 'article', title: 'Un article' })
    await item({ type: 'note', title: 'Une note' })
    await item({ type: 'bookmark', title: 'Un signet' })

    const props = await itemsOf(client, user, { type: 'note' })
    assert.lengthOf(props.items, 1)
    assert.equal(props.items[0].title, 'Une note')
  })

  test('CC-22 : les stats sont globales, indépendantes des filtres', async ({ assert, client }) => {
    const user = await login()
    await item({ type: 'article', title: 'A', tags: ['ia'], readingQueue: true })
    await item({ type: 'note', title: 'B', tags: ['rust'] })
    await item({ type: 'note', title: 'C', tags: ['ia'], readAt: DateTime.now() })

    const props = await itemsOf(client, user, { type: 'article' })

    // Un seul item affiché, mais les compteurs décrivent toute la base.
    assert.lengthOf(props.items, 1)
    assert.equal(props.stats.total, 3)
    assert.equal(props.stats.articles, 1)
    assert.equal(props.stats.queue, 1)
    assert.equal(props.stats.unread, 2)
    assert.equal(props.stats.tags, 2)
  })

  test('CC-22 : la liste des tags ne s’effondre pas quand on en sélectionne un', async ({
    assert,
    client,
  }) => {
    const user = await login()
    await item({ title: 'A', tags: ['ia'] })
    await item({ title: 'B', tags: ['rust'] })
    await item({ title: 'C', tags: ['self-host'] })

    // Le bug d'avant : les tags étaient dérivés des items AFFICHÉS. Un clic sur « ia » les
    // réduisait à ['ia'] — impossible d'en choisir un autre sans repasser par « Tout ».
    const props = await itemsOf(client, user, { tag: 'ia' })

    assert.lengthOf(props.items, 1)
    assert.deepEqual(props.tags, ['ia', 'rust', 'self-host'])
  })

  test('le filtre file de lecture ne s’active PAS tout seul', async ({ assert, client }) => {
    const user = await login()
    await item({ title: 'Dans la file', readingQueue: true })
    await item({ title: 'Hors de la file', readingQueue: false })

    // ⚠️ Le bug d'avant : `?readingQueue=false` arrive en chaîne `"false"`, qui est truthy.
    // Le filtre s'allumait à la première navigation et ne s'éteignait plus.
    const eteint = await itemsOf(client, user, { readingQueue: 'false' })
    assert.lengthOf(eteint.items, 2)

    const allume = await itemsOf(client, user, { readingQueue: 'true' })
    assert.lengthOf(allume.items, 1)
    assert.equal(allume.items[0].title, 'Dans la file')
  })

  test('le filtre non-lus ne rend que ce qui n’a pas été lu', async ({ assert, client }) => {
    const user = await login()
    await item({ title: 'Lu', readAt: DateTime.now() })
    await item({ title: 'Non lu' })

    const props = await itemsOf(client, user, { unread: 'true' })
    assert.lengthOf(props.items, 1)
    assert.equal(props.items[0].title, 'Non lu')
  })

  test('le filtre par source ne rend que ses items', async ({ assert, client }) => {
    const user = await login()
    const feed = await VeilleSource.create({
      kind: 'rss',
      url: 'https://a.dev/feed',
      title: 'Source',
      fetchIntervalMinutes: 60,
      active: true,
    })
    await item({ title: 'De la source', veilleSourceId: feed.id })
    await item({ title: 'Saisi à la main' })

    const props = await itemsOf(client, user, { sourceId: feed.id })
    assert.lengthOf(props.items, 1)
    assert.equal(props.items[0].title, 'De la source')
  })

  test('le tri prend la date de publication, pas celle de collecte', async ({ assert, client }) => {
    const user = await login()
    // Les trois sont collectés maintenant ; seul `publishedAt` doit décider de l'ordre.
    await item({ title: 'Ancien', publishedAt: DateTime.now().minus({ days: 10 }) })
    await item({ title: 'Récent', publishedAt: DateTime.now().minus({ days: 1 }) })
    await item({ title: 'Moyen', publishedAt: DateTime.now().minus({ days: 5 }) })

    const props = await itemsOf(client, user)
    assert.deepEqual(
      props.items.map((i) => i.title),
      ['Récent', 'Moyen', 'Ancien']
    )
  })

  test('la pagination borne la page et annonce le total', async ({ assert, client }) => {
    const user = await login()
    for (let index = 0; index < 55; index++) {
      await item({ title: `Item ${index}`, publishedAt: DateTime.now().minus({ minutes: index }) })
    }

    const premiere = await itemsOf(client, user)
    assert.lengthOf(premiere.items, 50)
    assert.equal(premiere.pagination.total, 55)
    assert.equal(premiere.pagination.lastPage, 2)

    const seconde = await itemsOf(client, user, { page: 2 })
    assert.lengthOf(seconde.items, 5)
    // Aucun chevauchement : l'ordre est total (published_at, id).
    const ids = new Set([...premiere.items, ...seconde.items].map((i) => i.id))
    assert.equal(ids.size, 55)
  })
})

test.group('Veille / capture manuelle et bascules', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function login() {
    return User.create({
      fullName: 'Utilisateur Test',
      email: 'test@example.com',
      password: 'secret123',
    })
  }

  test('la capture manuelle fonctionne après la migration', async ({ assert, client }) => {
    const user = await login()

    for (const type of ['note', 'bookmark', 'article'] as const) {
      const response = await client
        .post('/veille')
        .json({ type, title: `Capture ${type}`, url: 'https://exemple.dev/a' })
        .header('referrer', '/veille')
        .loginAs(user)
        .withCsrfToken()
        .redirects(0)

      response.assertStatus(302)
    }

    const items = await VeilleItem.query().orderBy('id')
    assert.lengthOf(items, 3)
    // Aucune source, aucune clé de dédup : plusieurs NULL cohabitent sous l'index unique.
    // C'est ce qui garantit que la capture manuelle ne peut jamais être bloquée par un doublon.
    for (const created of items) {
      assert.isNull(created.veilleSourceId)
      assert.isNull(created.dedupKey)
    }
  })

  test('deux captures manuelles vers la MÊME url ne se bloquent pas', async ({
    assert,
    client,
  }) => {
    const user = await login()

    for (let index = 0; index < 2; index++) {
      const response = await client
        .post('/veille')
        .json({ type: 'bookmark', title: `Signet ${index}`, url: 'https://exemple.dev/identique' })
        .header('referrer', '/veille')
        .loginAs(user)
        .withCsrfToken()
        .redirects(0)

      response.assertStatus(302)
    }

    assert.lengthOf(await VeilleItem.all(), 2)
  })

  test('la capture refuse un type inconnu', async ({ assert, client }) => {
    const user = await login()

    const response = await client
      .post('/veille')
      .json({ type: 'rss', title: 'Ancien type' })
      .header('referrer', '/veille')
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    // `rss` n'existe plus : c'est une provenance, pas un type.
    response.assertStatus(302)
    assert.lengthOf(await VeilleItem.all(), 0)
  })

  test('toggleQueue bascule dans les deux sens', async ({ assert, client }) => {
    const user = await login()
    const created = await VeilleItem.create({
      type: 'article',
      title: 'Un item',
      tags: [],
      metadata: {},
      readingQueue: false,
    })

    await client
      .post(`/veille/${created.id}/queue`)
      .header('referrer', '/veille')
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)
    await created.refresh()
    assert.isTrue(created.readingQueue)

    await client
      .post(`/veille/${created.id}/queue`)
      .header('referrer', '/veille')
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)
    await created.refresh()
    assert.isFalse(created.readingQueue)
  })

  test('toggleRead pose puis retire la date de lecture', async ({ assert, client }) => {
    const user = await login()
    const created = await VeilleItem.create({
      type: 'article',
      title: 'Un item',
      tags: [],
      metadata: {},
      readingQueue: false,
    })

    await client
      .post(`/veille/${created.id}/read`)
      .header('referrer', '/veille')
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)
    await created.refresh()
    assert.isNotNull(created.readAt)

    await client
      .post(`/veille/${created.id}/read`)
      .header('referrer', '/veille')
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)
    await created.refresh()
    assert.isNull(created.readAt)
  })

  test('un id inexistant rend 404, pas une 500', async ({ client }) => {
    const user = await login()

    const response = await client
      .post('/veille/999999/queue')
      .header('referrer', '/veille')
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(404)
  })

  test('les routes du module exigent une session', async ({ client }) => {
    const liste = await client.get('/veille').redirects(0)
    liste.assertStatus(302)

    const sources = await client.get('/veille/sources').redirects(0)
    sources.assertStatus(302)
  })
})
