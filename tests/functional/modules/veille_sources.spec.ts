import { readFile } from 'node:fs/promises'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import User from '#core/auth/models/user'
import VeilleItem from '#modules/veille/models/veille_item'
import VeilleSource from '#modules/veille/models/veille_source'
import FeedFetcher, { FeedUnavailableError } from '#modules/veille/services/feed_fetcher'
import VeilleCollectorService from '#modules/veille/services/veille_collector_service'
import FakeFeedFetcher, { ok, type FeedScript } from '#tests/fakes/fake_feed_fetcher'

function fixture(name: string): Promise<string> {
  return readFile(new URL(`../../fixtures/feeds/${name}.xml`, import.meta.url), 'utf8')
}

test.group('Veille / collecte des sources', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  // ⚠️ Déclaré avant les tests : un swap qui fuite contaminerait les groupes suivants.
  group.each.teardown(() => app.container.restore(FeedFetcher))

  /** Aucun test ne touche le réseau : le fetcher est remplacé dans le conteneur. */
  function fakeFetcher(script: Record<string, FeedScript>): FakeFeedFetcher {
    const fake = new FakeFeedFetcher(script)
    app.container.swap(FeedFetcher, () => fake)
    return fake
  }

  function collector(): Promise<VeilleCollectorService> {
    return app.container.make(VeilleCollectorService)
  }

  async function source(url: string, attrs: Partial<VeilleSource> = {}) {
    return VeilleSource.create({
      kind: 'rss',
      url,
      title: `Source ${url}`,
      fetchIntervalMinutes: 60,
      active: true,
      ...attrs,
    })
  }

  test('collecte un flux RSS et écrit ses entrées', async ({ assert }) => {
    fakeFetcher({ 'https://a.dev/feed': ok(await fixture('rss2')) })
    const feed = await source('https://a.dev/feed')

    const service = await collector()
    const outcome = await service.collectSource(feed)

    assert.isTrue(outcome.ok)
    assert.equal(outcome.found, 2)
    assert.equal(outcome.inserted, 2)

    const items = await VeilleItem.query().orderBy('title')
    assert.lengthOf(items, 2)
    assert.equal(items[0].type, 'article')
    assert.equal(items[0].veilleSourceId, feed.id)
    assert.isNotNull(items[0].dedupKey)
    assert.isNull(items[0].readAt)
  })

  test('LE test du lot : le même item collecté deux fois n’en fait qu’un', async ({ assert }) => {
    const rss = await fixture('rss2')
    fakeFetcher({ 'https://a.dev/feed': ok(rss) })
    const feed = await source('https://a.dev/feed')

    // Deux instances distinctes, à dessein : la seconde passe ne doit rien devoir à la
    // garde en mémoire de la première — c'est la base qui dédoublonne.
    const premierePasse = await collector()
    const first = await premierePasse.collectSource(feed)
    const secondePasse = await collector()
    const second = await secondePasse.collectSource(feed)

    assert.equal(first.inserted, 2)
    // La seconde passe relit les deux mêmes entrées et n'en écrit aucune.
    assert.equal(second.found, 2)
    assert.equal(second.inserted, 0)
    assert.lengthOf(await VeilleItem.all(), 2)
  })

  test('dédup DANS une même passe : un flux qui liste deux fois la même entrée', async ({
    assert,
  }) => {
    // Le second niveau de dédup, celui que la contrainte de base ne suffit pas à décrire :
    // les deux lignes sont dans le MÊME insert.
    const doublon = `<?xml version="1.0"?><rss version="2.0"><channel><title>F</title>
      <item><title>Un</title><link>https://a.dev/un</link></item>
      <item><title>Un (republié)</title><link>https://a.dev/un?utm_source=x</link></item>
    </channel></rss>`

    fakeFetcher({ 'https://a.dev/feed': ok(doublon) })
    const feed = await source('https://a.dev/feed')

    const service = await collector()
    const outcome = await service.collectSource(feed)

    assert.equal(outcome.found, 2)
    assert.equal(outcome.inserted, 1, 'les paramètres de campagne ont créé un doublon')
  })

  test('deux sources qui annoncent le même article ne font qu’un item', async ({ assert }) => {
    // La propriété que le ticket vise : le blog ET l'agrégateur. Une clé fondée sur le `guid`
    // échouerait ici — chaque flux a le sien.
    fakeFetcher({
      'https://a.dev/feed': ok(await fixture('rss2')),
      'https://b.dev/feed': ok(await fixture('atom')),
    })
    const blog = await source('https://a.dev/feed')
    const agregateur = await source('https://b.dev/feed')

    const passeBlog = await collector()
    await passeBlog.collectSource(blog)
    const passeAgregateur = await collector()
    await passeAgregateur.collectSource(agregateur)

    assert.lengthOf(await VeilleItem.all(), 2, 'les deux flux ont produit des doublons')
  })

  test('LE second test du lot : un flux en erreur n’empêche pas les autres', async ({ assert }) => {
    fakeFetcher({
      'https://mort.dev/feed': new FeedUnavailableError('Le flux a répondu 500.'),
      'https://vivant.dev/feed': ok(await fixture('rss2')),
      'https://casse.dev/feed': ok('<rss><channel><item></oops>'),
    })
    await source('https://mort.dev/feed')
    await source('https://vivant.dev/feed')
    await source('https://casse.dev/feed')

    const service = await collector()
    const outcomes = await service.collectAll()

    assert.lengthOf(outcomes, 3)
    assert.lengthOf(
      outcomes.filter((o) => o.ok),
      1
    )
    // Ce qui compte : les items du flux sain sont bien là malgré les deux autres.
    assert.lengthOf(await VeilleItem.all(), 2)

    const mort = await VeilleSource.findByOrFail('url', 'https://mort.dev/feed')
    assert.include(mort.lastError, '500')
    assert.isNotNull(mort.lastErrorAt)
    // `last_fetched_at` bouge aussi en échec, sinon on martèle un serveur en panne à chaque tick.
    assert.isNotNull(mort.lastFetchedAt)

    const casse = await VeilleSource.findByOrFail('url', 'https://casse.dev/feed')
    assert.isNotNull(casse.lastError)
  })

  test('un flux qui répond 200 sans entrée est signalé, pas silencieux', async ({ assert }) => {
    const vide = `<?xml version="1.0"?><rss version="2.0"><channel><title>Vide</title></channel></rss>`
    fakeFetcher({ 'https://a.dev/feed': ok(vide) })
    const feed = await source('https://a.dev/feed')

    const service = await collector()
    const outcome = await service.collectSource(feed)

    assert.isTrue(outcome.ok)
    assert.equal(outcome.found, 0)

    await feed.refresh()
    // Pas une erreur — mais `lastItemCount = 0` est ce qui empêche la source de *paraître* saine.
    assert.isNull(feed.lastError)
    assert.equal(feed.lastItemCount, 0)
  })

  test('un succès efface l’erreur précédente', async ({ assert }) => {
    const feed = await source('https://a.dev/feed', {
      lastError: 'Panne précédente',
      lastErrorAt: DateTime.now(),
    })
    fakeFetcher({ 'https://a.dev/feed': ok(await fixture('rss2')) })

    const service = await collector()
    await service.collectSource(feed)
    await feed.refresh()

    assert.isNull(feed.lastError)
    assert.isNull(feed.lastErrorAt)
  })

  test('etag et last-modified sont renvoyés à la passe suivante', async ({ assert }) => {
    const fake = fakeFetcher({
      'https://a.dev/feed': ok(await fixture('rss2'), {
        etag: 'W/"abc"',
        lastModified: 'Mon, 13 Jul 2026 09:00:00 GMT',
      }),
    })
    const feed = await source('https://a.dev/feed')

    const premierePasse = await collector()
    await premierePasse.collectSource(feed)
    await feed.refresh()
    assert.equal(feed.etag, 'W/"abc"')

    const secondePasse = await collector()
    await secondePasse.collectSource(feed)

    // La politesse minimale envers un serveur interrogé toutes les heures.
    assert.deepEqual(fake.calls[1].conditional, {
      etag: 'W/"abc"',
      lastModified: 'Mon, 13 Jul 2026 09:00:00 GMT',
    })
  })

  test('un 304 n’écrit rien et ne casse rien', async ({ assert }) => {
    fakeFetcher({ 'https://a.dev/feed': { status: 'not-modified' } })
    const feed = await source('https://a.dev/feed', { lastItemCount: 7 })

    const service = await collector()
    const outcome = await service.collectSource(feed)

    assert.isTrue(outcome.ok)
    assert.isTrue(outcome.notModified)
    assert.equal(outcome.inserted, 0)
    assert.lengthOf(await VeilleItem.all(), 0)

    await feed.refresh()
    assert.isNotNull(feed.lastFetchedAt)
    assert.equal(feed.lastItemCount, 7, 'le compteur a été écrasé par un 304')
  })

  test('un échec APRÈS la réponse HTTP ne mémorise pas l’etag', async ({ assert }) => {
    // ⚠️ Le mode d'échec silencieux n° 1 du lot. Si l'etag était écrit dès la réponse, la passe
    // suivante recevrait un 304 et ces entrées seraient sautées DÉFINITIVEMENT — le flux ne les
    // republiera pas. Ici le corps est illisible : la réponse est arrivée, le parse a échoué.
    fakeFetcher({ 'https://a.dev/feed': ok('pas du xml', { etag: 'W/"piege"' }) })
    const feed = await source('https://a.dev/feed')

    const service = await collector()
    const outcome = await service.collectSource(feed)

    assert.isFalse(outcome.ok)
    await feed.refresh()
    assert.isNull(feed.etag, 'l’etag a été mémorisé alors que rien n’a été écrit')
    assert.isNull(feed.lastModified)
  })

  test('la cadence décide qui est dû — une source neuve l’est tout de suite', async ({
    assert,
  }) => {
    fakeFetcher({
      'https://neuve.dev/feed': ok(await fixture('rss2')),
      'https://recente.dev/feed': ok(await fixture('atom')),
    })
    await source('https://neuve.dev/feed')
    await source('https://recente.dev/feed', {
      lastFetchedAt: DateTime.now().minus({ minutes: 5 }),
      fetchIntervalMinutes: 60,
    })

    const service = await collector()
    const outcomes = await service.collectDue()

    assert.lengthOf(outcomes, 1, 'une source hors cadence a été collectée')
    const neuve = await VeilleSource.findByOrFail('url', 'https://neuve.dev/feed')
    assert.equal(outcomes[0].sourceId, neuve.id)
  })

  test('une source désactivée n’est pas collectée', async ({ assert }) => {
    fakeFetcher({ 'https://a.dev/feed': ok(await fixture('rss2')) })
    await source('https://a.dev/feed', { active: false })

    const passeDue = await collector()
    assert.lengthOf(await passeDue.collectDue(), 0)
    const passeAll = await collector()
    assert.lengthOf(await passeAll.collectAll(), 0)
  })

  test('le contenu collecté est du texte, jamais du HTML', async ({ assert }) => {
    fakeFetcher({ 'https://a.dev/feed': ok(await fixture('rss2')) })
    const feed = await source('https://a.dev/feed')

    const service = await collector()
    await service.collectSource(feed)

    const items = await VeilleItem.all()
    for (const item of items) {
      assert.notInclude(item.content ?? '', '<')
      assert.notInclude(item.content ?? '', 'alert')
    }
  })
})

test.group('Veille / écran des sources', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.teardown(() => app.container.restore(FeedFetcher))

  async function login() {
    return User.create({
      fullName: 'Utilisateur Test',
      email: 'test@example.com',
      password: 'secret123',
    })
  }

  test('ajoute une source', async ({ assert, client }) => {
    const user = await login()

    const response = await client
      .post('/veille/sources')
      .json({ url: 'https://blog.exemple.dev/feed.xml', title: 'Blog Exemple' })
      .header('referrer', '/veille/sources')
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const sources = await VeilleSource.all()
    assert.lengthOf(sources, 1)
    assert.equal(sources[0].url, 'https://blog.exemple.dev/feed.xml')
    assert.equal(sources[0].fetchIntervalMinutes, 60)
    assert.isTrue(sources[0].active)
  })

  test('REFUSE une URL interne — la garde SSRF passe par la route', async ({ assert, client }) => {
    const user = await login()

    for (const url of [
      'http://127.0.0.1:8080/feed',
      'http://169.254.169.254/latest/meta-data/',
      'http://192.168.1.1/feed',
      'file:///etc/passwd',
    ]) {
      const response = await client
        .post('/veille/sources')
        .json({ url, title: 'Piège' })
        .header('referrer', '/veille/sources')
        .loginAs(user)
        .withCsrfToken()
        .redirects(0)

      response.assertStatus(302)
      assert.lengthOf(await VeilleSource.all(), 0, `${url} a été enregistrée`)
    }
  })

  test('refuse une source déjà suivie plutôt que de rendre une 500', async ({ assert, client }) => {
    const user = await login()
    await VeilleSource.create({
      kind: 'rss',
      url: 'https://a.dev/feed',
      title: 'Déjà là',
      fetchIntervalMinutes: 60,
      active: true,
    })

    const response = await client
      .post('/veille/sources')
      .json({ url: 'https://a.dev/feed', title: 'Doublon' })
      .header('referrer', '/veille/sources')
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.lengthOf(await VeilleSource.all(), 1)
  })

  test('désactive une source sans la supprimer', async ({ assert, client }) => {
    const user = await login()
    const feed = await VeilleSource.create({
      kind: 'rss',
      url: 'https://a.dev/feed',
      title: 'Source',
      fetchIntervalMinutes: 60,
      active: true,
    })

    await client
      .post(`/veille/sources/${feed.id}`)
      .json({ active: false })
      .header('referrer', '/veille/sources')
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    await feed.refresh()
    assert.isFalse(feed.active)
    assert.lengthOf(
      await VeilleSource.all(),
      1,
      'la source a été supprimée au lieu d’être désactivée'
    )
  })

  test('le rafraîchissement manuel d’une source collecte tout de suite', async ({
    assert,
    client,
  }) => {
    const user = await login()
    const rss = await fixture('rss2')
    app.container.swap(FeedFetcher, () => new FakeFeedFetcher({ 'https://a.dev/feed': ok(rss) }))
    const feed = await VeilleSource.create({
      kind: 'rss',
      url: 'https://a.dev/feed',
      title: 'Source',
      fetchIntervalMinutes: 60,
      active: true,
    })

    const response = await client
      .post(`/veille/sources/${feed.id}/refresh`)
      .header('referrer', '/veille/sources')
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    // Synchrone : c'est tout l'intérêt — savoir immédiatement si une source neuve marche.
    assert.lengthOf(await VeilleItem.all(), 2)
  })

  test('la page des sources rend le bon composant avec ses sources', async ({ assert, client }) => {
    const user = await login()
    await VeilleSource.create({
      kind: 'rss',
      url: 'https://a.dev/feed',
      title: 'Ma source',
      fetchIntervalMinutes: 30,
      active: true,
      lastError: 'Une panne à afficher',
    })

    const response = await client.get('/veille/sources').loginAs(user).withInertia()

    response.assertStatus(200)
    response.assertInertiaComponent('modules/veille/sources')
    const props = response.inertiaProps as { sources: { title: string; lastError: string }[] }
    assert.lengthOf(props.sources, 1)
    assert.equal(props.sources[0].title, 'Ma source')
    // Le message d'échec doit atteindre l'écran : c'est toute la raison de la colonne.
    assert.equal(props.sources[0].lastError, 'Une panne à afficher')
  })
})
