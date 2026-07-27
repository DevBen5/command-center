import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import type { YoutubeConfig } from '#config/youtube'
import { createUserWith } from '#tests/helpers/users'
import VeilleItem from '#modules/veille/models/veille_item'
import VeilleSource from '#modules/veille/models/veille_source'
import FeedFetcher from '#modules/veille/services/feed_fetcher'
import ImmichClient from '#modules/veille/services/immich_client'
import YoutubeClient, { YoutubeUnavailableError } from '#modules/veille/services/youtube_client'
import YoutubeCollector from '#modules/veille/services/youtube_collector'
import VeilleCollectorService from '#modules/veille/services/veille_collector_service'
import { youtubeDedupKey, type YoutubeVideo } from '#modules/veille/services/youtube_asset'
import FakeYoutubeClient, { type PlaylistScript } from '#tests/fakes/fake_youtube_client'
import FakeFeedFetcher from '#tests/fakes/fake_feed_fetcher'

/**
 * CC-87 — la collecte de la playlist « Veille » YouTube.
 *
 * ⚠️ **Aucun test ne touche le réseau ni l'API réelle** : `YoutubeClient` est remplacé dans le
 * conteneur, et `.env.test` vide les deux variables YouTube — le vrai client refuserait donc de
 * partir même si un `swap` était oublié, et le quota du jour n'est jamais consommé.
 *
 * Ce que ces tests portent, dans l'ordre d'importance :
 * 1. **l'aiguillage par `kind`** — sans lui la source part au `FeedFetcher`, en silence ;
 * 2. une **erreur d'API ne marque rien** et n'écrit pas une playlist vide ;
 * 3. une **deuxième collecte n'ajoute rien** ;
 * 4. une vidéo **retirée de la playlist est marquée**, et **rétablie** si elle y revient.
 */
test.group('Veille / collecte YouTube', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  // ⚠️ Déclarés avant les tests : un swap qui fuite contaminerait les groupes suivants.
  group.each.teardown(() => app.container.restore(YoutubeClient))
  group.each.teardown(() => app.container.restore(FeedFetcher))
  group.each.teardown(() => app.container.restore(ImmichClient))

  const ID_A = 'aaaaaaaaaaa'
  const ID_B = 'bbbbbbbbbbb'
  const ID_C = 'ccccccccccc'

  const CONFIG: YoutubeConfig = {
    apiKey: 'clé-de-test',
    playlistId: 'PLveille',
    timeoutMs: 5_000,
    enabled: true,
  }

  function video(videoId: string, attrs: Partial<YoutubeVideo> = {}): YoutubeVideo {
    return {
      videoId,
      title: `Vidéo ${videoId}`,
      description: 'Sa description.',
      publishedAt: DateTime.fromISO('2020-01-15T08:30:00.000Z'),
      addedToPlaylistAt: DateTime.fromISO('2026-07-20T10:00:00.000Z'),
      channelTitle: 'Une chaîne',
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      durationSeconds: 253,
      ...attrs,
    }
  }

  function fakeClient(playlist: PlaylistScript): FakeYoutubeClient {
    const fake = new FakeYoutubeClient(playlist)
    app.container.swap(YoutubeClient, () => fake)
    return fake
  }

  async function source(): Promise<VeilleSource> {
    const collector = await app.container.make(YoutubeCollector)
    const created = await collector.ensureSource(CONFIG)
    return created!
  }

  test('provisionne la source depuis la configuration, sans formulaire', async ({ assert }) => {
    fakeClient([])

    const created = await source()

    assert.equal(created.kind, 'youtube')
    assert.equal(created.url, 'youtube:playlist:PLveille')
    assert.isTrue(created.active)
    // ⚠️ `youtube:playlist:…` n'est pas une URL http : `isPublicFeedUrl` la refuse, donc aucun
    // formulaire ne peut créer cette source. C'est la garantie, pas une convention.
  })

  test('désactive la source quand la configuration disparaît, et la réactive quand elle revient', async ({
    assert,
  }) => {
    fakeClient([])
    const collector = await app.container.make(YoutubeCollector)

    await collector.ensureSource(CONFIG)
    await collector.ensureSource({ ...CONFIG, apiKey: '', enabled: false })

    const disabled = await VeilleSource.query().where('kind', 'youtube').firstOrFail()
    assert.isFalse(disabled.active)
    assert.include(disabled.lastError!, 'YOUTUBE_API_KEY')

    await collector.ensureSource(CONFIG)

    const restored = await VeilleSource.query().where('kind', 'youtube').firstOrFail()
    assert.isTrue(restored.active)
    assert.isNull(restored.lastError)
  })

  /**
   * ⚠️ **Une désactivation VOLONTAIRE ne doit pas être défaite au démarrage suivant.** C'est tout
   * l'objet du marqueur `DISABLED_BY_CONFIG` : sans comparaison exacte du message, `ensureSource`
   * réactiverait à chaque boot une source que l'utilisateur a éteinte depuis l'écran.
   */
  test('ne réactive pas une source désactivée à la main', async ({ assert }) => {
    fakeClient([])
    const collector = await app.container.make(YoutubeCollector)

    const created = await collector.ensureSource(CONFIG)
    created!.active = false
    created!.lastError = null
    await created!.save()

    await collector.ensureSource(CONFIG)

    const after = await VeilleSource.query().where('kind', 'youtube').firstOrFail()
    assert.isFalse(after.active)
  })

  /**
   * ⚠️ **LE test du lot.** Sans l'aiguillage par `kind`, la source part au `FeedFetcher`, qui va
   * chercher `youtube:playlist:PLveille` comme une URL de flux : elle échoue à chaque passe avec
   * un message parlant d'URL publique — un faux problème affiché, et le vrai invisible.
   *
   * On asserte donc que le faux fetcher n'a reçu **aucun** appel : « la collecte a réussi » ne
   * suffirait pas à le prouver.
   */
  test('aiguille sur le collecteur YouTube, jamais sur le fetcher de flux', async ({ assert }) => {
    fakeClient([video(ID_A)])
    const fetcher = new FakeFeedFetcher({})
    app.container.swap(FeedFetcher, () => fetcher)

    const collector = await app.container.make(VeilleCollectorService)
    const outcome = await collector.collectSource(await source())

    assert.isTrue(outcome.ok, `la collecte a échoué : ${outcome.error}`)
    assert.equal(outcome.found, 1)
    assert.lengthOf(fetcher.calls, 0, 'le fetcher de flux a été appelé sur une source YouTube')
  })

  test('écrit une vidéo avec sa clé de dédup, son lien et ses métadonnées', async ({ assert }) => {
    fakeClient([video(ID_A)])

    const collector = await app.container.make(VeilleCollectorService)
    await collector.collectSource(await source())

    const item = await VeilleItem.query().where('dedup_key', youtubeDedupKey(ID_A)).firstOrFail()

    assert.equal(item.type, 'video')
    assert.equal(item.url, `https://www.youtube.com/watch?v=${ID_A}`)
    assert.deepEqual(item.tags, ['youtube'])
    assert.equal(item.metadata!.durationSeconds, 253)
    assert.equal(item.metadata!.channelTitle, 'Une chaîne')
    assert.equal(item.metadata!.thumbnailUrl, `https://i.ytimg.com/vi/${ID_A}/hqdefault.jpg`)

    /**
     * ⚠️ **`published_at` porte la date d'AJOUT à la playlist, pas celle de la vidéo** (CC-87).
     * La liste trie sur `coalesce(published_at, created_at) DESC` : avec la date de mise en ligne,
     * une vidéo de 2020 ajoutée aujourd'hui atterrirait des centaines de lignes plus bas, donc
     * invisible. Le test fige la décision — la date de la vidéo reste dans `metadata`.
     */
    assert.equal(item.publishedAt?.toISODate(), '2026-07-20')
    assert.include(String(item.metadata!.videoPublishedAt), '2020-01-15')
  })

  test('une deuxième collecte n’ajoute rien', async ({ assert }) => {
    const fake = fakeClient([video(ID_A), video(ID_B)])
    const collector = await app.container.make(VeilleCollectorService)
    const created = await source()

    const first = await collector.collectSource(created)
    const second = await collector.collectSource(created)

    assert.equal(first.inserted, 2)
    assert.equal(second.inserted, 0)
    assert.equal(second.found, 2)
    assert.equal(fake.passes, 2, 'la seconde passe n’a pas interrogé la playlist')
  })

  test('marque les vidéos retirées de la playlist, et les rétablit si elles y reviennent', async ({
    assert,
  }) => {
    const fake = fakeClient([video(ID_A), video(ID_B)])
    const collector = await app.container.make(VeilleCollectorService)
    const created = await source()

    await collector.collectSource(created)

    fake.setPlaylist([video(ID_A)])
    const removed = await collector.collectSource(created)

    assert.equal(removed.disappeared, 1)
    const gone = await VeilleItem.query().where('dedup_key', youtubeDedupKey(ID_B)).firstOrFail()
    assert.isNotNull(gone.unavailableAt)

    fake.setPlaylist([video(ID_A), video(ID_B)])
    await collector.collectSource(created)

    const back = await VeilleItem.query().where('dedup_key', youtubeDedupKey(ID_B)).firstOrFail()
    assert.isNull(back.unavailableAt, 'une vidéo remise dans la playlist doit redevenir normale')
  })

  /**
   * ⚠️ **Le mode d'échec le plus coûteux du lot, et il ressemble à un fonctionnement normal.**
   * Si une erreur d'API se lisait « playlist vide », la réconciliation marquerait TOUS les items
   * « plus dans la playlist » en une passe. La garantie ne vit pas dans le collecteur mais dans
   * `YoutubeClient.playlistVideos()`, qui lève plutôt que de rendre une liste partielle.
   */
  test('une erreur d’API ne marque rien et laisse les items intacts', async ({ assert }) => {
    const fake = fakeClient([video(ID_A), video(ID_B), video(ID_C)])
    const collector = await app.container.make(VeilleCollectorService)
    const created = await source()

    await collector.collectSource(created)

    fake.setPlaylist(new YoutubeUnavailableError('quota épuisé (quotaExceeded)'))
    const failed = await collector.collectSource(created)

    assert.isFalse(failed.ok)
    assert.equal(failed.disappeared, 0)
    assert.include(failed.error!, 'quotaExceeded')

    const marked = await VeilleItem.query()
      .where('veille_source_id', created.id)
      .whereNotNull('unavailable_at')
    assert.lengthOf(marked, 0, 'une erreur d’API a marqué des items comme disparus')

    const after = await VeilleSource.query().where('kind', 'youtube').firstOrFail()
    assert.include(after.lastError!, 'quotaExceeded')
    // ⚠️ `last_fetched_at` bouge aussi en cas d'échec, sinon la source reste éternellement due et
    // on martèle l'API à chaque tick — en consommant le quota pour rien.
    assert.isNotNull(after.lastFetchedAt)
  })

  /**
   * ⚠️ Une playlist réellement vidée marque bien tout, et c'est correct. Ce qui empêche que ce
   * soit silencieux, c'est `last_item_count = 0`, que l'écran des sources signale.
   */
  test('une playlist vidée marque tout, et le compteur le dit', async ({ assert }) => {
    const fake = fakeClient([video(ID_A), video(ID_B)])
    const collector = await app.container.make(VeilleCollectorService)
    const created = await source()

    await collector.collectSource(created)
    fake.setPlaylist([])
    const emptied = await collector.collectSource(created)

    assert.equal(emptied.disappeared, 2)

    const after = await VeilleSource.query().where('kind', 'youtube').firstOrFail()
    assert.equal(after.lastItemCount, 0)
  })

  test('marque le succès sur la source : compteur, horodatage, erreur effacée', async ({
    assert,
  }) => {
    fakeClient([video(ID_A), video(ID_B)])
    const collector = await app.container.make(VeilleCollectorService)
    const created = await source()

    created.lastError = 'une panne précédente'
    created.lastErrorAt = DateTime.now()
    await created.save()

    await collector.collectSource(created)

    const after = await VeilleSource.query().where('kind', 'youtube').firstOrFail()
    assert.equal(after.lastItemCount, 2)
    assert.isNull(after.lastError)
    assert.isNull(after.lastErrorAt)
    assert.isNotNull(after.lastFetchedAt)
  })

  /**
   * ⚠️ **La source est relue depuis la base, et ce n'est pas une précaution de style.** C'est
   * exactement ce que fait la production : `collectDue()` part d'un `VeilleSource.query()`, jamais
   * de l'objet rendu par `create()`. La différence compte — les défauts de `last_fetched_at` et de
   * `schedule_mode` sont **en base**, pas sur le modèle, donc l'instance juste créée les porte à
   * `undefined` en mémoire. Asserter sur cet objet-là testerait un état qui n'existe nulle part
   * ailleurs que dans ce test.
   */
  test('la source est due immédiatement tant qu’elle n’a jamais collecté', async ({ assert }) => {
    fakeClient([])
    await source()

    const persisted = await VeilleSource.query().where('kind', 'youtube').firstOrFail()

    assert.isTrue(persisted.isDue(), 'une source neuve doit collecter tout de suite')
  })

  /**
   * CC-88 — le proxy de vignette, généralisé.
   *
   * ⚠️ **L'aiguillage se fait sur le préfixe de `dedup_key`, pas sur `type`.** `video` vaut pour
   * les deux provenances : router dessus enverrait une vidéo YouTube au client Immich, qui
   * chercherait un UUID dans une clé qui n'en porte pas.
   */
  test('le proxy sert la vignette d’une vidéo YouTube', async ({ client, assert }) => {
    const fake = fakeClient([video(ID_A)])
    const collector = await app.container.make(VeilleCollectorService)
    await collector.collectSource(await source())

    const item = await VeilleItem.query().where('dedup_key', youtubeDedupKey(ID_A)).firstOrFail()
    const response = await client
      .get(`/veille/items/${item.id}/thumbnail`)
      .loginAs(await createUserWith(['veille.view']))

    response.assertStatus(200)
    assert.equal(response.header('content-type'), 'image/jpeg')
    // ⚠️ Contenu servi derrière `veille.view` : sans `private`, un mandataire partagé pourrait le
    // servir à quelqu'un d'autre. Vrai même pour YouTube — la miniature est publique, la route non.
    assert.include(response.header('cache-control')!, 'private')
    // L'identifiant demandé au CDN vient de NOTRE base, jamais de l'URL appelée.
    assert.deepEqual(fake.thumbnailed, [ID_A])
  })

  /**
   * ⚠️ Le pendant du test précédent : un item Immich ne doit pas partir chez YouTube. Sans cette
   * assertion, un aiguillage inversé passerait les deux tests d'affichage en échouant en silence
   * sur la moitié des items.
   */
  test('le proxy n’envoie pas un item Immich au client YouTube', async ({ client, assert }) => {
    const fake = fakeClient([])

    /**
     * ⚠️ **Le client Immich est configuré explicitement, et ça reste le bon motif** même depuis
     * que `config/env_isolation.ts` neutralise les clients externes en test (CC-101) : un test
     * n'a pas à dépendre de l'environnement de la machine pour être déterministe. La garde est
     * une seconde barrière, pas une dispense.
     *
     * Historiquement, c'était un **contournement nécessaire** : `.env.test` vidait bien
     * `IMMICH_BASE_URL` et consorts, mais une valeur vide n'y masque pas celle de `.env`, et
     * `immichConfig.enabled` valait donc `true` pendant les tests. Sans cette ligne, ce test-ci
     * allait chercher une vraie vignette sur la vraie instance — mesuré en CC-88, pas supposé.
     */
    app.container.swap(
      ImmichClient,
      () =>
        new ImmichClient({
          baseUrl: 'https://immich.test',
          apiKey: '',
          albumId: '',
          timeoutMs: 5_000,
          enabled: false,
        })
    )

    const item = await VeilleItem.create({
      type: 'image',
      title: 'a.jpg',
      dedupKey: 'immich:219187d7-5320-498f-9c59-47a03bbdb491',
      tags: [],
      metadata: {},
    })

    const response = await client
      .get(`/veille/items/${item.id}/thumbnail`)
      .loginAs(await createUserWith(['veille.view']))

    // Le client désactivé refuse avant de construire une URL, d'où le 404. Ce qui compte ici,
    // c'est que le client YouTube n'ait **rien** reçu : l'aiguillage lit le préfixe de
    // `dedup_key`, pas le `type`, qui vaut `image`/`video` des deux côtés.
    response.assertStatus(404)
    assert.lengthOf(fake.thumbnailed, 0, 'un item Immich est parti chez le client YouTube')
  })

  test('la clé d’API ne repart jamais vers le client', async ({ client, assert }) => {
    fakeClient([video(ID_A)])
    const collector = await app.container.make(VeilleCollectorService)
    await collector.collectSource(await source())

    const item = await VeilleItem.query().where('dedup_key', youtubeDedupKey(ID_A)).firstOrFail()
    const response = await client
      .get(`/veille/items/${item.id}/thumbnail`)
      .loginAs(await createUserWith(['veille.view']))

    // Le corps est binaire : `response.text()` est `undefined` sur une image. On repasse par les
    // octets bruts, faute de quoi l'assertion porterait sur rien et passerait toujours.
    const body = response.body()
    const raw = Buffer.isBuffer(body) ? body.toString('utf8') : String(body ?? '')

    assert.notInclude(raw, 'clé-de-test')
    assert.notInclude(JSON.stringify(response.headers()), 'clé-de-test')
  })
})
