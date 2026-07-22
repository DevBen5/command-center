import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import type { ImmichConfig } from '#config/immich'
import { createUserWith } from '#tests/helpers/users'
import VeilleItem from '#modules/veille/models/veille_item'
import VeilleSource from '#modules/veille/models/veille_source'
import ImmichClient, { ImmichUnavailableError } from '#modules/veille/services/immich_client'
import ImmichCollector from '#modules/veille/services/immich_collector'
import VeilleCollectorService from '#modules/veille/services/veille_collector_service'
import { immichDedupKey, type ImmichAsset } from '#modules/veille/services/immich_asset'
import FakeImmichClient, { type AlbumScript } from '#tests/fakes/fake_immich_client'

/**
 * CC-55 — la collecte d'un album Immich.
 *
 * ⚠️ **Aucun test ne touche le réseau ni une vraie instance** : `ImmichClient` est remplacé dans
 * le conteneur, et `.env.test` vide les trois variables Immich — le vrai client refuserait donc
 * de partir même si un `swap` était oublié.
 *
 * Ce que ces tests portent, dans l'ordre d'importance :
 * 1. une **erreur d'API ne marque rien** et n'écrit pas d'album vide ;
 * 2. une **deuxième collecte n'ajoute rien** ;
 * 3. un asset **sorti de l'album est marqué**, et **rétabli** s'il y revient.
 */
test.group('Veille / collecte Immich', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  // ⚠️ Déclaré avant les tests : un swap qui fuite contaminerait les groupes suivants.
  group.each.teardown(() => app.container.restore(ImmichClient))

  const ID_A = '219187d7-5320-498f-9c59-47a03bbdb491'
  const ID_B = 'c1d2e3f4-5a6b-4c8d-9e0f-1a2b3c4d5e6f'
  const ID_C = 'f0e1d2c3-b4a5-4968-8776-5a4b3c2d1e0f'

  const CONFIG: ImmichConfig = {
    baseUrl: 'https://immich.test',
    apiKey: 'clé-de-test',
    albumId: 'album-de-veille',
    timeoutMs: 5_000,
    enabled: true,
  }

  function asset(id: string, attrs: Partial<ImmichAsset> = {}): ImmichAsset {
    return {
      id,
      type: 'image',
      fileName: `${id}.jpg`,
      takenAt: DateTime.fromISO('2026-07-21T08:59:50.413Z'),
      durationSeconds: null,
      network: null,
      ...attrs,
    }
  }

  function fakeClient(album: AlbumScript, version?: string | Error): FakeImmichClient {
    const fake = new FakeImmichClient(album, version)
    app.container.swap(ImmichClient, () => fake)
    return fake
  }

  /**
   * ⚠️ Une seule instance par test suffit, et c'est vérifié : `VeilleCollectorService` et
   * `ImmichCollector` sont **sans état**, la garde de dédup en mémoire vivant dans
   * `insertNewItems`, locale à l'appel. C'est la différence avec `veille_sources.spec.ts`, où
   * plusieurs tests instancient deux fois **à dessein** pour prouver qu'une seconde passe ne
   * doit rien à la première — ne factorise pas ceux-là.
   */
  function collector(): Promise<VeilleCollectorService> {
    return app.container.make(VeilleCollectorService)
  }

  /** L'item relu depuis la base, pour asserter sur son état après une passe. */
  function itemFor(assetId: string): Promise<VeilleItem> {
    return VeilleItem.findByOrFail('dedup_key', immichDedupKey(assetId))
  }

  /** La source telle que `ensureSource` la produit — jamais un formulaire. */
  async function immichSource(): Promise<VeilleSource> {
    const made = await app.container.make(ImmichCollector)
    const source = await made.ensureSource(CONFIG)
    return source!
  }

  test('écrit les assets de l’album, et ne stocke aucun fichier', async ({ assert }) => {
    fakeClient([
      asset(ID_A, { fileName: 'Screenshot_20260721_105950_TikTok.jpg', network: 'tiktok' }),
      asset(ID_B, { type: 'video', fileName: 'reddit.mp4', durationSeconds: 64 }),
    ])
    const source = await immichSource()
    const service = await collector()

    const outcome = await service.collectSource(source)

    assert.isTrue(outcome.ok)
    assert.equal(outcome.found, 2)
    assert.equal(outcome.inserted, 2)

    const items = await VeilleItem.query().orderBy('title')
    assert.lengthOf(items, 2)

    const [screenshot, video] = items
    assert.equal(screenshot.type, 'image')
    assert.deepEqual(screenshot.tags, ['tiktok'])
    assert.equal(screenshot.dedupKey, immichDedupKey(ID_A))
    // ⚠️ `url` reste nul : le lien vers Immich se construit à l'affichage. Figé en base, il
    // pointerait sur l'ancien domaine le jour d'un déménagement d'instance.
    assert.isNull(screenshot.url)
    // Rien du fichier lui-même n'est stocké — Immich possède les octets.
    assert.isNull(screenshot.content)

    assert.equal(video.type, 'video')
    assert.equal(video.metadata.durationSeconds, 64)
  })

  test('une deuxième collecte n’ajoute rien', async ({ assert }) => {
    const client = fakeClient([asset(ID_A), asset(ID_B)])
    const source = await immichSource()
    const service = await collector()

    const first = await service.collectSource(source)
    const second = await service.collectSource(source)

    assert.equal(first.inserted, 2)
    // ⚠️ `found` reste à 2 — l'album n'a pas changé — mais **rien n'est écrit**. Le compte vient
    // du `RETURNING id` : les doublons ignorés par `ON CONFLICT` n'y sont pas.
    assert.equal(second.found, 2)
    assert.equal(second.inserted, 0)
    assert.equal(client.passes, 2)

    assert.lengthOf(await VeilleItem.all(), 2)
  })

  test('le même asset deux fois dans une même passe ne fait qu’un item', async ({ assert }) => {
    // La pagination peut rendre deux fois le même asset si l'album bouge pendant la collecte :
    // le `Set` en mémoire tranche là où `ON CONFLICT` ne verrait qu'un seul INSERT.
    fakeClient([asset(ID_A), asset(ID_A), asset(ID_B)])
    const source = await immichSource()
    const service = await collector()

    const outcome = await service.collectSource(source)

    assert.equal(outcome.inserted, 2)
    assert.lengthOf(await VeilleItem.all(), 2)
  })

  test('un asset retiré de l’album est marqué, pas supprimé', async ({ assert }) => {
    const client = fakeClient([asset(ID_A), asset(ID_B)])
    const source = await immichSource()
    const service = await collector()
    await service.collectSource(source)

    client.setAlbum([asset(ID_A)])
    const outcome = await service.collectSource(source)

    assert.equal(outcome.disappeared, 1)

    const gone = await VeilleItem.findByOrFail('dedup_key', immichDedupKey(ID_B))
    assert.isNotNull(gone.unavailableAt)

    const stayed = await VeilleItem.findByOrFail('dedup_key', immichDedupKey(ID_A))
    assert.isNull(stayed.unavailableAt)

    // ⚠️ L'item **reste en base** : ce que le module a produit lui-même (lu/non-lu, file de
    // lecture, tags, et le résumé au lot suivant) n'a aucune raison de disparaître avec l'asset.
    assert.lengthOf(await VeilleItem.all(), 2)
  })

  test('un asset remis dans l’album redevient normal', async ({ assert }) => {
    // Sans ce retour, une sortie accidentelle serait définitive et il faudrait passer par la
    // base pour la défaire.
    const client = fakeClient([asset(ID_A)])
    const source = await immichSource()
    const service = await collector()
    await service.collectSource(source)

    client.setAlbum([])
    await service.collectSource(source)
    const marked = await itemFor(ID_A)
    assert.isNotNull(marked.unavailableAt)

    client.setAlbum([asset(ID_A)])
    await service.collectSource(source)

    const restored = await itemFor(ID_A)
    assert.isNull(restored.unavailableAt)
  })

  test('une erreur d’API ne marque AUCUN asset disparu', async ({ assert }) => {
    /**
     * ⚠️ **Le test qui porte le lot.**
     *
     * Le marquage se calcule par différence : si une erreur laissait passer une liste vide ou
     * partielle, **tout l'album** serait marqué « plus dans l'album » en une passe — et rien à
     * l'écran ne dirait que c'est faux. C'est le pire mode d'échec de ce lot, parce qu'il
     * ressemble trait pour trait à un fonctionnement normal.
     *
     * La garantie est le tout-ou-rien de `ImmichClient.albumAssets()` : une page en échec fait
     * lever, et `reconcile()` n'est jamais atteint.
     */
    const client = fakeClient([asset(ID_A), asset(ID_B), asset(ID_C)])
    const source = await immichSource()
    const service = await collector()
    await service.collectSource(source)

    client.setAlbum(new ImmichUnavailableError('Immich a répondu 502.'))
    const outcome = await service.collectSource(source)

    assert.isFalse(outcome.ok)
    assert.equal(outcome.disappeared, 0)

    const items = await VeilleItem.all()
    assert.lengthOf(items, 3)
    assert.isTrue(items.every((item) => item.unavailableAt === null))
  })

  test('une erreur d’API s’écrit dans last_error, et laisse le compteur intact', async ({
    assert,
  }) => {
    const client = fakeClient([asset(ID_A), asset(ID_B)])
    const source = await immichSource()
    const service = await collector()
    await service.collectSource(source)
    await source.refresh()
    assert.equal(source.lastItemCount, 2)

    client.setAlbum(new ImmichUnavailableError('Immich a répondu text/html au lieu de JSON.'))
    await service.collectSource(source)
    await source.refresh()

    assert.include(source.lastError!, 'text/html')
    assert.isNotNull(source.lastErrorAt)
    // ⚠️ Le compteur garde la dernière collecte **réussie** : le remettre à 0 sur un échec ferait
    // afficher le bandeau « 0 entrée » — l'anomalie du lot 1 — à la place de la vraie erreur.
    assert.equal(source.lastItemCount, 2)
    // `last_fetched_at` bouge quand même, sinon la source reste éternellement due et on martèle
    // une instance en panne à chaque tick.
    assert.isNotNull(source.lastFetchedAt)
  })

  test('une instance injoignable n’écrit rien du tout', async ({ assert }) => {
    // La sonde de version échoue avant l'album : la passe s'arrête là, sans le moindre item.
    fakeClient([asset(ID_A)], new ImmichUnavailableError('Immich est injoignable.'))
    const source = await immichSource()
    const service = await collector()

    const outcome = await service.collectSource(source)

    assert.isFalse(outcome.ok)
    assert.include(outcome.error!, 'injoignable')
    assert.lengthOf(await VeilleItem.all(), 0)
  })

  test('un album réellement vidé marque tout, et se voit', async ({ assert }) => {
    // Indiscernable d'un album qui n'a jamais rien eu — et c'est assumé. Ce qui le rend non
    // silencieux est le compteur : `last_item_count = 0` déclenche le bandeau d'anomalie du
    // lot 1. Une *erreur*, elle, n'arrive jamais jusqu'ici (test précédent).
    const client = fakeClient([asset(ID_A), asset(ID_B)])
    const source = await immichSource()
    const service = await collector()
    await service.collectSource(source)

    client.setAlbum([])
    const outcome = await service.collectSource(source)
    await source.refresh()

    assert.isTrue(outcome.ok)
    assert.equal(outcome.disappeared, 2)
    assert.equal(source.lastItemCount, 0)
    assert.isNull(source.lastError)
  })

  test('la collecte n’envoie pas la source Immich au collecteur de flux', async ({ assert }) => {
    // ⚠️ Sans l'aiguillage sur `kind`, la source partirait au `FeedFetcher`, qui irait chercher
    // `immich:album:…` comme une URL de flux : échec à chaque passe, avec un message parlant
    // d'URL publique — un faux problème, et le vrai invisible.
    fakeClient([asset(ID_A)])
    const source = await immichSource()
    const service = await collector()

    const outcome = await service.collectSource(source)

    assert.isTrue(outcome.ok)
    assert.notInclude(outcome.error ?? '', 'publique')
  })

  test('les articles d’un flux ne sont jamais marqués par la collecte Immich', async ({
    assert,
  }) => {
    // La réconciliation est cadrée par `veille_source_id` : un article d'un autre robinet, ou
    // une capture manuelle sans source, n'a rien à voir avec l'album.
    fakeClient([])
    const source = await immichSource()
    const service = await collector()

    const manual = await VeilleItem.create({
      type: 'note',
      title: 'Une note à moi',
      tags: [],
      metadata: {},
      readingQueue: false,
    })

    await service.collectSource(source)
    await manual.refresh()

    assert.isNull(manual.unavailableAt)
  })
})

test.group('Veille / source Immich alignée sur l’environnement', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  const CONFIG: ImmichConfig = {
    baseUrl: 'https://immich.test',
    apiKey: 'clé-de-test',
    albumId: 'album-de-veille',
    timeoutMs: 5_000,
    enabled: true,
  }

  function collector(): Promise<ImmichCollector> {
    return app.container.make(ImmichCollector)
  }

  test('crée la source depuis la configuration, une seule fois', async ({ assert }) => {
    const made = await collector()

    const first = await made.ensureSource(CONFIG)
    const second = await made.ensureSource(CONFIG)

    assert.equal(first!.id, second!.id)
    assert.equal(first!.kind, 'immich')
    assert.equal(first!.url, 'immich:album:album-de-veille')
    assert.lengthOf(await VeilleSource.query().where('kind', 'immich'), 1)
  })

  test('réaligne l’album quand la configuration change', async ({ assert }) => {
    const made = await collector()
    await made.ensureSource(CONFIG)

    const source = await made.ensureSource({ ...CONFIG, albumId: 'un-autre-album' })

    assert.equal(source!.url, 'immich:album:un-autre-album')
    assert.lengthOf(await VeilleSource.query().where('kind', 'immich'), 1)
  })

  test('désactive la source quand la configuration disparaît, en disant pourquoi', async ({
    assert,
  }) => {
    const made = await collector()
    await made.ensureSource(CONFIG)

    const absent = await made.ensureSource({ ...CONFIG, enabled: false })

    assert.isNull(absent)
    const source = await VeilleSource.findByOrFail('kind', 'immich')
    assert.isFalse(source.active)
    // Le message part dans `last_error`, affiché tel quel sur l'écran des sources : une source
    // qui se tait sans rien dire est le mode de panne que ce module existe pour éviter.
    assert.include(source.lastError!, 'IMMICH_BASE_URL')
  })

  test('réactive la source quand la configuration revient', async ({ assert }) => {
    const made = await collector()
    await made.ensureSource(CONFIG)
    await made.ensureSource({ ...CONFIG, enabled: false })

    const back = await made.ensureSource(CONFIG)

    assert.isTrue(back!.active)
    assert.isNull(back!.lastError)
  })

  test('ne réactive JAMAIS une source désactivée à la main', async ({ assert }) => {
    /**
     * ⚠️ La nuance qui fait la valeur du marqueur. Sans elle, il faudrait choisir entre deux
     * mauvaises options : réactiver à chaque démarrage — et ignorer un geste explicite de
     * l'utilisateur, qui verrait la collecte repartir toute seule — ou ne jamais réactiver, et
     * laisser la source muette après une correction de `.env`, sans dire pourquoi.
     */
    const made = await collector()
    const source = await made.ensureSource(CONFIG)

    source!.active = false
    source!.lastError = null
    await source!.save()

    const after = await made.ensureSource(CONFIG)

    assert.isFalse(after!.active)
  })
})

test.group('Veille / proxy de vignette', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.teardown(() => app.container.restore(ImmichClient))

  const ID_A = '219187d7-5320-498f-9c59-47a03bbdb491'

  async function login() {
    return createUserWith(['veille.view'])
  }

  test('sert la vignette d’un item média', async ({ client, assert }) => {
    const fake = new FakeImmichClient([
      {
        id: ID_A,
        type: 'image',
        fileName: 'a.jpg',
        takenAt: null,
        durationSeconds: null,
        network: null,
      },
    ])
    app.container.swap(ImmichClient, () => fake)

    const item = await VeilleItem.create({
      type: 'image',
      title: 'a.jpg',
      dedupKey: immichDedupKey(ID_A),
      tags: [],
      metadata: {},
      readingQueue: false,
    })

    const response = await client.get(`/veille/items/${item.id}/thumbnail`).loginAs(await login())

    response.assertStatus(200)
    assert.equal(response.header('content-type'), 'image/webp')
    // ⚠️ Contenu authentifié : sans `private`, un mandataire partagé pourrait le servir à
    // quelqu'un d'autre.
    assert.include(response.header('cache-control')!, 'private')
    // L'identifiant demandé à Immich vient de NOTRE base, jamais de l'URL appelée.
    assert.deepEqual(fake.thumbnailed, [ID_A])
  })

  test('la clé d’API ne repart jamais vers le client', async ({ client, assert }) => {
    // Pendant exact de `hasApiKey` sur l'écran LLM : le serveur l'envoie à Immich, le navigateur
    // ne la voit jamais — ni dans le corps, ni dans un en-tête.
    const fake = new FakeImmichClient([
      {
        id: ID_A,
        type: 'image',
        fileName: 'a.jpg',
        takenAt: null,
        durationSeconds: null,
        network: null,
      },
    ])
    app.container.swap(ImmichClient, () => fake)

    const item = await VeilleItem.create({
      type: 'image',
      title: 'a.jpg',
      dedupKey: immichDedupKey(ID_A),
      tags: [],
      metadata: {},
      readingQueue: false,
    })

    const response = await client.get(`/veille/items/${item.id}/thumbnail`).loginAs(await login())

    // Le corps est binaire : `response.text()` est `undefined` sur une image. On repasse par les
    // octets bruts, faute de quoi l'assertion porterait sur rien et passerait toujours.
    const body = response.body()
    const raw = Buffer.isBuffer(body) ? body.toString('utf8') : String(body ?? '')

    assert.notInclude(raw, 'clé-de-test')
    assert.notInclude(JSON.stringify(response.headers()), 'clé-de-test')
  })

  test('refuse un item qui n’est pas un média', async ({ client }) => {
    /**
     * ⚠️ **C'est ici que se joue la sécurité du proxy.** La route est indexée par l'id d'item de
     * notre base : un item qui n'a pas de `dedup_key` Immich ne donne aucun identifiant, donc
     * aucune requête ne part. Une route indexée par l'identifiant Immich, elle, aurait servi
     * n'importe quel asset de la bibliothèque personnelle — il n'y aurait rien eu à vérifier.
     */
    app.container.swap(ImmichClient, () => new FakeImmichClient([]))

    const article = await VeilleItem.create({
      type: 'article',
      title: 'Un article',
      dedupKey: 'url:https://exemple.dev/article',
      tags: [],
      metadata: {},
      readingQueue: false,
    })

    await client
      .get(`/veille/items/${article.id}/thumbnail`)
      .loginAs(await login())
      .then((response) => response.assertStatus(404))
  })

  test('exige d’être connecté', async ({ client, assert }) => {
    /**
     * ⚠️ Le pire défaut possible de ce lot serait un proxy **anonyme** : une route qui porte la clé
     * d'API d'Immich et sert des médias personnels sans authentification. La route est dans le
     * groupe `middleware.auth()` (`start/routes.ts:185`), mais un déplacement de route la ferait
     * sortir du groupe **sans qu'aucun autre test ne bronche** — d'où celui-ci.
     */
    const fake = new FakeImmichClient([
      {
        id: ID_A,
        type: 'image',
        fileName: 'a.jpg',
        takenAt: null,
        durationSeconds: null,
        network: null,
      },
    ])
    app.container.swap(ImmichClient, () => fake)

    const item = await VeilleItem.create({
      type: 'image',
      title: 'a.jpg',
      dedupKey: immichDedupKey(ID_A),
      tags: [],
      metadata: {},
      readingQueue: false,
    })

    const response = await client.get(`/veille/items/${item.id}/thumbnail`).redirects(0)

    // Le guard de session renvoie vers l'écran de connexion, il ne rend pas la vignette.
    response.assertStatus(302)
    assert.equal(response.header('location'), '/login')
    // Et surtout : Immich n'a même pas été interrogé.
    assert.lengthOf(fake.thumbnailed, 0)
  })

  test('refuse un item inconnu', async ({ client }) => {
    app.container.swap(ImmichClient, () => new FakeImmichClient([]))

    const response = await client.get('/veille/items/999999/thumbnail').loginAs(await login())

    response.assertStatus(404)
  })

  test('rend 404 quand Immich ne sert plus l’asset', async ({ client }) => {
    // L'asset a réellement été supprimé d'Immich : une image cassée est le bon comportement
    // visuel — c'est précisément le « lien mort » que le ticket veut rendre visible. Le motif
    // exact part dans les logs, jamais au navigateur.
    app.container.swap(ImmichClient, () => new FakeImmichClient([]))

    const item = await VeilleItem.create({
      type: 'image',
      title: 'disparu.jpg',
      dedupKey: immichDedupKey(ID_A),
      tags: [],
      metadata: {},
      readingQueue: false,
    })

    const response = await client.get(`/veille/items/${item.id}/thumbnail`).loginAs(await login())

    response.assertStatus(404)
  })
})
