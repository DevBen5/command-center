import { readFile } from 'node:fs/promises'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import type { ImmichConfig } from '#config/immich'
import type User from '#core/auth/models/user'
import { createUserWith } from '#tests/helpers/users'
import VeilleItem from '#modules/veille/models/veille_item'
import VeilleSource from '#modules/veille/models/veille_source'
import FeedFetcher from '#modules/veille/services/feed_fetcher'
import ImmichClient, { ImmichUnavailableError } from '#modules/veille/services/immich_client'
import ImmichCollector from '#modules/veille/services/immich_collector'
import VeilleCollectorService from '#modules/veille/services/veille_collector_service'
import { immichDedupKey, type ImmichAsset } from '#modules/veille/services/immich_asset'
import FakeFeedFetcher, { ok, type FeedScript } from '#tests/fakes/fake_feed_fetcher'
import FakeImmichClient, { type AlbumScript } from '#tests/fakes/fake_immich_client'

function fixture(name: string): Promise<string> {
  return readFile(new URL(`../../fixtures/feeds/${name}.xml`, import.meta.url), 'utf8')
}

/** La taille de page de `VeilleController`. Recopiée : le contrôleur ne l'exporte pas. */
const PER_PAGE = 50

/**
 * CC-63 — supprimer un article, sortir une image traitée.
 *
 * ⚠️ **Aucun test ne touche le réseau ni une vraie instance** : `FeedFetcher` et `ImmichClient`
 * sont remplacés dans le conteneur, et `.env.test` vide les variables Immich.
 *
 * Ce que ces tests portent, dans l'ordre d'importance :
 *
 * 1. **un item supprimé ne revient pas** à la collecte suivante — la pierre tombale ;
 * 2. **un échec Immich ne marque rien**, et **`trashDays: 0` n'émet même pas l'appel** ;
 * 3. un supprimé sort de **chaque** lecture — un test par endroit, parce qu'un filtre oublié ne
 *    se voit nulle part ailleurs.
 */
test.group('Veille / suppression', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  // ⚠️ Déclarés avant les tests : un swap qui fuite contaminerait les groupes suivants.
  group.each.teardown(() => app.container.restore(ImmichClient))
  group.each.teardown(() => app.container.restore(FeedFetcher))

  const ID_A = '219187d7-5320-498f-9c59-47a03bbdb491'
  const ID_B = 'c1d2e3f4-5a6b-4c8d-9e0f-1a2b3c4d5e6f'

  const CONFIG: ImmichConfig = {
    baseUrl: 'https://immich.test',
    apiKey: 'clé-de-test',
    albumId: 'album-de-veille',
    timeoutMs: 5_000,
    enabled: true,
  }

  async function login() {
    return createUserWith(['veille.view', 'veille.items.write'])
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

  function fakeImmich(album: AlbumScript): FakeImmichClient {
    const fake = new FakeImmichClient(album)
    app.container.swap(ImmichClient, () => fake)
    return fake
  }

  function fakeFetcher(script: Record<string, FeedScript>): FakeFeedFetcher {
    const fake = new FakeFeedFetcher(script)
    app.container.swap(FeedFetcher, () => fake)
    return fake
  }

  function collector(): Promise<VeilleCollectorService> {
    return app.container.make(VeilleCollectorService)
  }

  async function immichSource(): Promise<VeilleSource> {
    const made = await app.container.make(ImmichCollector)
    return (await made.ensureSource(CONFIG))!
  }

  /**
   * La suppression telle que la page l'émet.
   *
   * ⚠️ `redirects(0)` : sans lui, le client suivrait la redirection et **la requête suivante
   * consommerait le flash** — les assertions sur le message d'erreur porteraient alors sur du
   * vide, sans que le test paraisse faux pour autant.
   */
  async function remove(client: any, user: User, ids: number[]) {
    return client
      .post('/veille/items/delete')
      .json({ ids })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)
  }

  /**
   * L'état d'un item relu depuis la base.
   *
   * Deux accesseurs plutôt que des `(await …).champ` : le dépôt interdit l'accès direct sur une
   * expression `await`, et ces deux colonnes sont ce que la moitié des tests vérifie.
   */
  async function deletedAtOf(id: number) {
    const relu = await VeilleItem.findOrFail(id)
    return relu.deletedAt
  }

  async function unavailableAtOf(id: number) {
    const relu = await VeilleItem.findOrFail(id)
    return relu.unavailableAt
  }

  /** Ce que l'écran reçoit réellement — la seule source de vérité de ces tests. */
  async function screen(client: any, user: User, query: Record<string, unknown> = {}) {
    const response = await client.get('/veille').qs(query).loginAs(user).withInertia()
    response.assertStatus(200)
    return response.inertiaProps as {
      items: { id: number; title: string }[]
      stats: { total: number; articles: number; queue: number; unread: number; tags: number }
      tags: string[]
      pagination: { total: number; lastPage: number; currentPage: number }
      filters: { type: string | null }
    }
  }

  // -------------------------------------------------------------------------------------------
  // 1. La pierre tombale — ce que le lot achète
  // -------------------------------------------------------------------------------------------

  test('LE test du lot : un article supprimé ne revient pas à la collecte suivante', async ({
    assert,
    client,
  }) => {
    const user = await login()
    const rss = await fixture('rss2')
    fakeFetcher({ 'https://a.dev/feed': ok(rss) })

    const feed = await VeilleSource.create({
      kind: 'rss',
      url: 'https://a.dev/feed',
      title: 'Source A',
      fetchIntervalMinutes: 60,
      active: true,
    })

    const premiere = await collector()
    await premiere.collectSource(feed)

    const collected = await VeilleItem.query().orderBy('id')
    assert.lengthOf(collected, 2)

    await remove(client, user, [collected[0].id])

    /**
     * ⚠️ **Le flux republie exactement les mêmes entrées** — c'est le cas réel, pas une
     * hypothèse : un flux liste ses dernières entrées en permanence. Sans pierre tombale, la
     * ligne supprimée libérerait sa `dedup_key` et cette passe la réinsérerait. Le bouton
     * paraîtrait avoir marché, et l'item reviendrait dans l'heure.
     */
    const seconde = await collector()
    const outcome = await seconde.collectSource(feed)

    assert.equal(outcome.found, 2)
    assert.equal(outcome.inserted, 0, 'un item supprimé ne doit pas être réinséré')

    // La ligne existe toujours en base — c'est elle qui tient la clé occupée.
    assert.lengthOf(await VeilleItem.all(), 2)
    // Mais l'écran n'en voit plus qu'un.
    const props = await screen(client, user)
    assert.lengthOf(props.items, 1)
    assert.equal(props.items[0].id, collected[1].id)
  })

  test('un asset supprimé ne revient pas à la collecte suivante', async ({ assert, client }) => {
    const user = await login()
    const fake = fakeImmich([asset(ID_A), asset(ID_B)])
    const source = await immichSource()

    const premiere = await collector()
    await premiere.collectSource(source)

    const cible = await VeilleItem.findByOrFail('dedup_key', immichDedupKey(ID_A))
    await remove(client, user, [cible.id])

    assert.deepEqual(fake.trashed, [[ID_A]], "l'asset part à la corbeille, et lui seul")

    // L'asset a quitté l'album — c'est ce que la suppression provoque côté Immich.
    fake.setAlbum([asset(ID_B)])

    const seconde = await collector()
    const outcome = await seconde.collectSource(source)

    assert.equal(outcome.inserted, 0)
    const props = await screen(client, user)
    assert.lengthOf(props.items, 1)
  })

  test('une capture manuelle se supprime, sans clé de dédup', async ({ assert, client }) => {
    const user = await login()
    // ⚠️ `dedup_key` nul : rien ne la réinsérerait jamais, elle ne pose donc aucune question.
    const note = await item({ type: 'note', title: 'Une note à la main', dedupKey: null })

    await remove(client, user, [note.id])

    const props = await screen(client, user)
    assert.lengthOf(props.items, 0)
    assert.isNotNull(await deletedAtOf(note.id))
  })

  // -------------------------------------------------------------------------------------------
  // 2. Immich : l'ordre des opérations, et le refus
  // -------------------------------------------------------------------------------------------

  test('un échec côté Immich ne marque RIEN en base, et le message remonte', async ({
    assert,
    client,
  }) => {
    const user = await login()
    const fake = fakeImmich([asset(ID_A)])
    const source = await immichSource()

    const passe = await collector()
    await passe.collectSource(source)

    fake.trashError = new ImmichUnavailableError('Immich a répondu 500 à la mise à la corbeille.')

    const cible = await VeilleItem.findByOrFail('dedup_key', immichDedupKey(ID_A))
    const response = await remove(client, user, [cible.id])

    /**
     * ⚠️ **L'invariant du lot** : une ligne marquée supprimée = un asset réellement à la
     * corbeille. Marquer ici produirait la divergence silencieuse que l'ordre des opérations
     * existe pour empêcher — item disparu de l'écran, asset toujours dans la bibliothèque.
     */
    assert.isNull(await deletedAtOf(cible.id))

    const props = await screen(client, user)
    assert.lengthOf(props.items, 1, "l'item échoué reste visible et re-supprimable")

    const notification = response.flashMessages().notification as { type: string; message: string }
    assert.equal(notification.type, 'error')
    assert.include(notification.message, 'corbeille')
  })

  test('la corbeille désactivée (trashDays: 0) fait REFUSER, sans émettre la suppression', async ({
    assert,
    client,
  }) => {
    const user = await login()
    const fake = fakeImmich([asset(ID_A)])
    const source = await immichSource()

    const passe = await collector()
    await passe.collectSource(source)

    // Sur une instance sans corbeille, `force: false` détruit immédiatement — et Command Center
    // n'a aucune copie des octets.
    fake.trashDaysValue = 0

    const cible = await VeilleItem.findByOrFail('dedup_key', immichDedupKey(ID_A))
    const response = await remove(client, user, [cible.id])

    /**
     * ⚠️ **L'assertion qui porte ce test est `trashed` vide, pas `deletedAt` nul.** « Rien en
     * base » serait aussi vrai si l'appel partait et échouait. Ce qu'on prouve ici, c'est qu'on
     * ne demande **jamais** une suppression qu'Immich rendrait définitive.
     */
    assert.lengthOf(fake.trashed, 0, 'aucun appel de suppression ne doit partir')
    assert.isNull(await deletedAtOf(cible.id))

    const notification = response.flashMessages().notification as { type: string; message: string }
    assert.equal(notification.type, 'error')
    assert.include(notification.message, 'trashDays')
  })

  test('une trashDays illisible refuse aussi — la règle échoue fermée', async ({
    assert,
    client,
  }) => {
    const user = await login()
    const fake = fakeImmich([asset(ID_A)])
    const source = await immichSource()

    const passe = await collector()
    await passe.collectSource(source)

    // Une version future qui renomme le champ, ou une réponse illisible : tout ce qui n'est pas
    // un entier positif doit refuser. Laisser passer serait la seule erreur irréversible du lot.
    fake.trashDaysValue = new ImmichUnavailableError('champ trashDays absent')

    const cible = await VeilleItem.findByOrFail('dedup_key', immichDedupKey(ID_A))
    await remove(client, user, [cible.id])

    assert.lengthOf(fake.trashed, 0)
    assert.isNull(await deletedAtOf(cible.id))
  })

  test('Immich retiré de la configuration : le média reste, et le message le dit', async ({
    assert,
    client,
  }) => {
    const user = await login()
    fakeImmich([asset(ID_A)])
    const source = await immichSource()

    const passe = await collector()
    await passe.collectSource(source)

    /**
     * Le cas réel : des items média collectés du temps où Immich était configuré, et une
     * configuration retirée depuis. Le **vrai** client reprend sa place, désactivé — il refuse
     * avant même de construire une URL.
     */
    app.container.swap(ImmichClient, () => new ImmichClient({ ...CONFIG, enabled: false }))

    const cible = await VeilleItem.findByOrFail('dedup_key', immichDedupKey(ID_A))
    const response = await remove(client, user, [cible.id])

    assert.isNull(await deletedAtOf(cible.id))

    const notification = response.flashMessages().notification as { type: string; message: string }
    assert.equal(notification.type, 'error')
    // Le message nomme ce qui manque : sans lui, « Immich éteint » et « configuration retirée »
    // seraient indiscernables à l'écran.
    assert.include(notification.message, 'IMMICH_BASE_URL')
  })

  test('sélection mixte : un échec Immich laisse les médias, mais les articles partent', async ({
    assert,
    client,
  }) => {
    const user = await login()
    const fake = fakeImmich([asset(ID_A)])
    const source = await immichSource()

    const passe = await collector()
    await passe.collectSource(source)

    const article = await item({ title: 'Un article sans dépendance externe' })
    const media = await VeilleItem.findByOrFail('dedup_key', immichDedupKey(ID_A))

    fake.trashError = new ImmichUnavailableError('Immich est injoignable.')

    const response = await remove(client, user, [article.id, media.id])

    /**
     * Un article n'a aucune dépendance externe : rien de ce qui le concerne ne peut diverger.
     * Un tout-ou-rien le punirait pour une panne qui ne le regarde pas — sur un lot de trente,
     * ça bloquerait tout le geste.
     */
    assert.isNotNull(await deletedAtOf(article.id))
    assert.isNull(await deletedAtOf(media.id))

    const notification = response.flashMessages().notification as { type: string; message: string }
    assert.equal(notification.type, 'error')
  })

  test('supprimer deux fois les mêmes ids n’appelle Immich qu’une fois', async ({
    assert,
    client,
  }) => {
    const user = await login()
    const fake = fakeImmich([asset(ID_A)])
    const source = await immichSource()

    const passe = await collector()
    await passe.collectSource(source)

    const cible = await VeilleItem.findByOrFail('dedup_key', immichDedupKey(ID_A))

    await remove(client, user, [cible.id])
    // Double-clic, rejeu de requête, second onglet : le filtre `deleted_at IS NULL` rend le
    // geste idempotent, et l'asset n'est pas redemandé à une corbeille où il est déjà.
    await remove(client, user, [cible.id])

    assert.lengthOf(fake.trashed, 1)
  })

  // -------------------------------------------------------------------------------------------
  // 3. Un test par lecture — le prix de la pierre tombale, payé partout
  // -------------------------------------------------------------------------------------------

  test('un item supprimé sort de la LISTE', async ({ assert, client }) => {
    const user = await login()
    const garde = await item({ title: 'Celui qui reste' })
    const cible = await item({ title: 'Celui qui part' })

    await remove(client, user, [cible.id])

    const props = await screen(client, user)
    assert.lengthOf(props.items, 1)
    assert.equal(props.items[0].id, garde.id)
  })

  test('un item supprimé sort des COMPTEURS', async ({ assert, client }) => {
    const user = await login()
    await item({ title: 'Celui qui reste' })
    const cible = await item({
      title: 'Celui qui part',
      readingQueue: true,
      tags: ['seul-sur-cet-item'],
    })

    const avant = await screen(client, user)
    assert.equal(avant.stats.total, 2)
    assert.equal(avant.stats.queue, 1)

    await remove(client, user, [cible.id])

    const apres = await screen(client, user)
    assert.equal(apres.stats.total, 1)
    assert.equal(apres.stats.articles, 1)
    assert.equal(apres.stats.unread, 1)
    assert.equal(apres.stats.queue, 0, 'la file de lecture ne compte plus un item supprimé')
    assert.equal(apres.stats.tags, 0)
  })

  test('un item supprimé sort de la BARRE DE TAGS', async ({ assert, client }) => {
    const user = await login()
    await item({ title: 'Celui qui reste', tags: ['garde'] })
    const cible = await item({ title: 'Celui qui part', tags: ['disparait'] })

    await remove(client, user, [cible.id])

    const props = await screen(client, user)
    // Un tag qui ne vit plus que sur des supprimés donnerait une liste vide au clic.
    assert.deepEqual(props.tags, ['garde'])
  })

  test('un item supprimé sort de la RECHERCHE plein texte', async ({ assert, client }) => {
    const user = await login()
    const cible = await item({ title: 'Pipeline RAG local', content: 'Un pipeline local.' })

    const avant = await screen(client, user, { search: 'pipeline' })
    assert.lengthOf(avant.items, 1)

    await remove(client, user, [cible.id])

    // `search_vector` est une colonne générée : elle continue d'indexer la ligne, qui existe
    // toujours. C'est le filtre — et lui seul — qui la retire du résultat.
    const apres = await screen(client, user, { search: 'pipeline' })
    assert.lengthOf(apres.items, 0)
  })

  test('un item supprimé sort de la PAGINATION', async ({ assert, client }) => {
    const user = await login()
    const ids: number[] = []
    for (let index = 0; index < 4; index++) {
      const cree = await item({ title: `Item ${index}` })
      ids.push(cree.id)
    }

    await remove(client, user, [ids[0], ids[1]])

    const props = await screen(client, user)
    // Le total de la pagination vient du `count` de la même requête : un filtre oublié ferait
    // annoncer 4 éléments pour 2 lignes affichées.
    assert.equal(props.pagination.total, 2)
    assert.lengthOf(props.items, 2)
  })

  test('vider la dernière page recule dessus, sans perdre le filtre', async ({
    assert,
    client,
  }) => {
    const user = await login()

    /**
     * ⚠️ Le cas qui porte ce test : la page 2 n'existe plus après la suppression. Sans le
     * bornage, `paginate(2)` rendrait une liste vide et l'écran afficherait « Aucun résultat » —
     * le message qui fait croire que le filtre est en cause, ou que la suppression a emporté
     * plus que prévu.
     */
    const signets: number[] = []
    for (let index = 0; index < PER_PAGE + 2; index++) {
      const cree = await item({ title: `Signet ${index}`, type: 'bookmark' })
      signets.push(cree.id)
    }

    const avant = await screen(client, user, { type: 'bookmark', page: 2 })
    assert.equal(avant.pagination.lastPage, 2)
    assert.lengthOf(avant.items, 2)

    // On supprime les deux items de la page 2 : elle cesse d'exister.
    await remove(client, user, [signets[PER_PAGE], signets[PER_PAGE + 1]])

    const apres = await screen(client, user, { type: 'bookmark', page: 2 })

    assert.equal(apres.pagination.lastPage, 1)
    assert.lengthOf(apres.items, PER_PAGE, 'on recule sur la dernière page réelle, pas de vide')
    // ⚠️ Le filtre survit : vider « Signet » en plusieurs passes est le geste normal de l'écran.
    assert.equal(apres.filters.type, 'bookmark')
  })

  test('un clic sans effet le dit, au lieu de rester muet', async ({ assert, client }) => {
    const user = await login()
    const cible = await item({ title: 'Supprimé une première fois' })

    await remove(client, user, [cible.id])
    // Le second onglet, resté sur une liste périmée. Sans message, le bouton paraît cassé.
    const response = await remove(client, user, [cible.id])

    const notification = response.flashMessages().notification as { type: string; message: string }
    assert.equal(notification.type, 'info', 'ni un succès (rien n’a bougé) ni une erreur')
    assert.include(notification.message, 'Rien à supprimer')
  })

  test('un item supprimé sort du filtre par TYPE et par SOURCE', async ({ assert, client }) => {
    const user = await login()
    const feed = await VeilleSource.create({
      kind: 'rss',
      url: 'https://b.dev/feed',
      title: 'Source B',
      fetchIntervalMinutes: 60,
      active: true,
    })
    const cible = await item({ title: 'Un signet', type: 'bookmark', veilleSourceId: feed.id })

    await remove(client, user, [cible.id])

    const parType = await screen(client, user, { type: 'bookmark' })
    assert.lengthOf(parType.items, 0)

    const parSource = await screen(client, user, { sourceId: feed.id })
    assert.lengthOf(parSource.items, 0)
  })

  test('le proxy de vignette ne sert plus un item supprimé', async ({ client }) => {
    const user = await login()
    fakeImmich([asset(ID_A)])
    const source = await immichSource()

    const passe = await collector()
    await passe.collectSource(source)

    const cible = await VeilleItem.findByOrFail('dedup_key', immichDedupKey(ID_A))
    await remove(client, user, [cible.id])

    const response = await client.get(`/veille/items/${cible.id}/thumbnail`).loginAs(user)
    response.assertStatus(404)
  })

  // -------------------------------------------------------------------------------------------
  // 4. La réconciliation de CC-55 ignore les supprimés
  // -------------------------------------------------------------------------------------------

  test('la réconciliation IGNORE les items supprimés', async ({ assert, client }) => {
    const user = await login()
    const fake = fakeImmich([asset(ID_A), asset(ID_B)])
    const source = await immichSource()

    const premiere = await collector()
    await premiere.collectSource(source)

    const cible = await VeilleItem.findByOrFail('dedup_key', immichDedupKey(ID_A))
    await remove(client, user, [cible.id])

    // Supprimer l'asset le fait sortir de l'album : la passe suivante le verrait « disparu ».
    fake.setAlbum([asset(ID_B)])

    const seconde = await collector()
    const outcome = await seconde.collectSource(source)

    /**
     * ⚠️ Sans le filtre, le badge « plus dans l'album » se poserait sur une ligne que plus
     * personne ne regarde, et `disappeared` annoncerait une perte là où il y a eu une
     * suppression voulue — un compteur qui ment.
     */
    assert.equal(outcome.disappeared, 0)
    assert.isNull(await unavailableAtOf(cible.id))
  })

  test('un asset revenu dans l’album ne ressuscite pas un item supprimé', async ({
    assert,
    client,
  }) => {
    const user = await login()
    const fake = fakeImmich([asset(ID_A)])
    const source = await immichSource()

    const premiere = await collector()
    await premiere.collectSource(source)

    const cible = await VeilleItem.findByOrFail('dedup_key', immichDedupKey(ID_A))
    await remove(client, user, [cible.id])

    // L'utilisateur restaure l'asset depuis la corbeille d'Immich : il revient dans l'album.
    fake.setAlbum([asset(ID_A)])

    const seconde = await collector()
    await seconde.collectSource(source)

    /**
     * ⚠️ **Limite assumée du lot** : les 30 jours d'Immich récupèrent les octets, pas cette
     * ligne. La décision de l'utilisateur ne doit pas être défaite par une mécanique de fond —
     * la rétablir demanderait de passer par la base.
     */
    assert.isNotNull(await deletedAtOf(cible.id))
    const props = await screen(client, user)
    assert.lengthOf(props.items, 0)
  })

  // -------------------------------------------------------------------------------------------
  // 5. Le bornage de la route
  // -------------------------------------------------------------------------------------------

  test('la route refuse une liste vide et une liste démesurée', async ({ assert, client }) => {
    const user = await login()
    const cible = await item({ title: 'Ne doit pas partir' })

    await remove(client, user, [])
    assert.isNull(await deletedAtOf(cible.id))

    /**
     * ⚠️ **La liste démesurée porte un id réel**, et c'est ce qui fait le test : le refus doit
     * emporter **tout** le lot, pas seulement les ids surnuméraires. Le plafond borne le geste
     * le plus destructeur du module — sans lui, une requête forgée viderait la table d'un coup.
     */
    const enorme = [cible.id, ...Array.from({ length: 200 }, (_, index) => index + 10_000)]
    await remove(client, user, enorme)

    assert.isNull(
      await deletedAtOf(cible.id),
      'le plafond doit refuser le lot entier, pas en garder une partie'
    )
  })
})
