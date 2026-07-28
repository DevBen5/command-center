import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import type User from '#core/auth/models/user'
import { createUserWith } from '#tests/helpers/users'
import VeilleItem from '#modules/veille/models/veille_item'
import VeilleSource from '#modules/veille/models/veille_source'
import { immichDedupKey } from '#modules/veille/services/immich_asset'

/**
 * CC-20 : `VeilleController` n'avait **aucun test** hors le smoke test « la page rend ».
 * Ni la recherche plein texte (du SQL brut), ni le filtre par tag, ni `store`, ni `toggleQueue`.
 *
 * Fonctionnel plutôt qu'unitaire : le module est mince, la logique est dans la requête.
 */
test.group('Veille / liste, filtres et recherche', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

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

  async function itemsOf(client: any, user: User, query: Record<string, unknown> = {}) {
    const response = await client.get('/veille').qs(query).loginAs(user).withInertia()
    response.assertStatus(200)
    return response.inertiaProps as {
      items: {
        id: number
        title: string
        immichAssetId: string | null
        provenance: {
          origin: string
          sourceKind: string | null
          labelKey: string | null
          text: string | null
        }
      }[]
      stats: { total: number; articles: number; queue: number; unread: number; tags: number }
      tags: string[]
      sources: { id: number; title: string; kind: string }[]
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

  /**
   * CC-105 — le filtre « Sans source », de bout en bout.
   *
   * ⚠️ **Le mode d'échec ici est « le filtre ne filtre rien », qui ressemble beaucoup à « il n'y
   * a rien à filtrer ».** Un test qui n'asserterait que la présence de l'orphelin passerait aussi
   * bien si le filtre était ignoré — c'est exactement ce que faisait `Number('none') || null`.
   * D'où les deux assertions : celui qui doit être là, et celui qui ne doit PAS y être.
   */
  test('le filtre « Sans source » ne rend que les détachés', async ({ assert, client }) => {
    const user = await login()
    const feed = await VeilleSource.create({
      kind: 'rss',
      url: 'https://a.dev/feed',
      title: 'Source',
      fetchIntervalMinutes: 60,
      active: true,
    })
    await item({ title: 'Rattaché', veilleSourceId: feed.id, dedupKey: 'url:https://a.dev/1' })
    await item({ title: 'Détaché', dedupKey: 'url:https://b.dev/2' })

    const props = await itemsOf(client, user, { sourceId: 'none' })

    const titres = props.items.map((i) => i.title)
    assert.include(titres, 'Détaché')
    assert.notInclude(titres, 'Rattaché')
  })

  /**
   * ⚠️ **`0` n'est pas la sentinelle**, et ce test dit pourquoi la sentinelle est une chaîne :
   * `Number('0') || null` valait `null`, donc `?sourceId=0` ne filtrait rien. Le comportement
   * attendu est celui-là — une valeur qui n'est ni un identifiant ni la sentinelle rend la liste
   * complète, elle ne lève pas et ne vide pas l'écran.
   */
  test('une valeur de source inexploitable rend la liste complète', async ({ assert, client }) => {
    const user = await login()
    await item({ title: 'Un' })
    await item({ title: 'Deux' })

    const zero = await itemsOf(client, user, { sourceId: '0' })
    const nimporteQuoi = await itemsOf(client, user, { sourceId: 'nawak' })

    assert.lengthOf(zero.items, 2)
    assert.lengthOf(nimporteQuoi.items, 2)
  })

  /**
   * ⚠️ **La sentinelle doit traverser la pagination.** `applyFilters` et `goToPage` retirent de
   * l'URL tout ce qui vaut `null`, `false` ou `''` : `'none'` y survit, `0` non. Sans ce test,
   * la page 2 d'un filtre « Sans source » rendrait tout le flux — et la page 1 aurait l'air
   * correcte.
   */
  test('le filtre « Sans source » survit à la pagination', async ({ assert, client }) => {
    const user = await login()
    const feed = await VeilleSource.create({
      kind: 'rss',
      url: 'https://a.dev/feed',
      title: 'Source',
      fetchIntervalMinutes: 60,
      active: true,
    })
    for (let index = 0; index < 60; index++) {
      await item({
        title: `Détaché ${index}`,
        dedupKey: `url:https://b.dev/${index}`,
        publishedAt: DateTime.now().minus({ minutes: index }),
      })
    }
    await item({ title: 'Rattaché', veilleSourceId: feed.id, dedupKey: 'url:https://a.dev/1' })

    const page2 = await itemsOf(client, user, { sourceId: 'none', page: 2 })

    assert.equal(page2.pagination.total, 60)
    assert.notInclude(
      page2.items.map((i) => i.title),
      'Rattaché'
    )
  })

  /**
   * CC-104 — la pastille de provenance, **de bout en bout**.
   *
   * `tests/unit/veille_item_provenance.spec.ts` prouve la dérivation ; celui-ci prouve qu'elle
   * arrive à la page. Ce sont deux choses distinctes : la fonction peut être parfaite et le
   * contrôleur ne jamais l'appeler, ou l'appeler avec une liste de sources vide.
   *
   * ⚠️ **Les trois cas dans la MÊME liste, pas trois tests d'un item chacun.** C'est la situation
   * réelle de l'écran — 102 items dont 48 détachés — et c'est elle qui attrape une dérivation qui
   * rendrait le même verdict pour tout le monde.
   */
  test('chaque item annonce sa provenance', async ({ assert, client }) => {
    const user = await login()
    const feed = await VeilleSource.create({
      kind: 'rss',
      url: 'https://a.dev/feed',
      title: 'Korben- Full',
      fetchIntervalMinutes: 60,
      active: true,
    })
    await item({
      title: 'Collecté',
      veilleSourceId: feed.id,
      dedupKey: 'url:https://a.dev/1',
      publishedAt: DateTime.now(),
    })
    // Une capture manuelle : ni source, ni clé de dédup. C'est ce couple qui la définit.
    await item({ title: 'Saisi', publishedAt: DateTime.now().minus({ minutes: 1 }) })
    // Un détaché : sa source a été supprimée, la FK `ON DELETE SET NULL` a laissé la ligne et son
    // titre survit dans `metadata`. C'est le cas des 48 orphelins relevés sur la base réelle.
    await item({
      title: 'Détaché',
      dedupKey: 'url:https://news.ycombinator.com/item?id=1',
      metadata: { sourceTitle: 'Hacker News (horaire)' },
      publishedAt: DateTime.now().minus({ minutes: 2 }),
    })

    const props = await itemsOf(client, user)
    const [collecte, saisi, detache] = props.items

    assert.equal(collecte.provenance.origin, 'source')
    assert.equal(collecte.provenance.sourceKind, 'rss')
    assert.equal(collecte.provenance.text, 'Korben- Full')

    assert.equal(saisi.provenance.origin, 'manual')
    assert.equal(saisi.provenance.labelKey, 'veille.index.provenance.manual')

    assert.equal(detache.provenance.origin, 'orphan')
    assert.equal(detache.provenance.text, 'Hacker News (horaire)')
  })

  /**
   * CC-111 : `dedup_key` ne descend plus au navigateur (`serializeAs: null` sur la colonne). Elle
   * y partait dans chacun des 50 items d'une page, avec l'identifiant d'asset Immich ou de vidéo
   * YouTube en clair et le schéma de préfixes internes — sans qu'aucun `.vue` ne la lise.
   *
   * ⚠️ **L'absence ne se teste pas seule.** Elle serait verte sur un `serialize()` cassé de bout
   * en bout ; ce qu'on veut prouver, c'est que la charge utile a perdu la clé **sans perdre ce qui
   * s'en déduit**. Les deux dérivations qui la lisent sont donc vérifiées ici, sur le même
   * chargement :
   *
   * - `immichAssetId` — le proxy de vignette et le lien vers Immich en dépendent (CC-88) ;
   * - `provenance` — le `CLAUDE.md` du module avait nommé ce mode d'échec avant qu'il existe :
   *   dérivée de la charge utile, elle ferait basculer **tous les orphelins en « Saisi à la
   *   main »** dès la clé retirée, sans erreur ni test rouge. Elle est dérivée du modèle Lucid,
   *   passé en argument nommé — d'où le verdict `orphan` qui tient malgré l'absence.
   */
  test('la charge utile ne porte pas `dedupKey`, mais tout ce qui s’en déduit', async ({
    assert,
    client,
  }) => {
    const user = await login()
    const assetId = 'a4f7c0d2-1e3b-4c58-9a6d-2f8b70c14e59'
    await item({
      type: 'image',
      title: 'capture.jpg',
      dedupKey: immichDedupKey(assetId),
      publishedAt: DateTime.now(),
    })
    // Un orphelin : `dedup_key` renseignée, aucune source. C'est le cas que la page distingue
    // d'une capture manuelle sur la seule nullité de la clé.
    await item({
      title: 'Détaché',
      dedupKey: 'url:https://news.ycombinator.com/item?id=1',
      metadata: { sourceTitle: 'Hacker News (horaire)' },
      publishedAt: DateTime.now().minus({ minutes: 1 }),
    })

    const props = await itemsOf(client, user)
    const [media, detache] = props.items

    assert.notProperty(media, 'dedupKey')
    assert.notProperty(detache, 'dedupKey')

    assert.equal(media.immichAssetId, assetId)
    assert.equal(detache.provenance.origin, 'orphan')
  })

  /**
   * ⚠️ **Le `kind` colore la pastille, et rien d'autre ne le porte jusqu'à la page.** Il descend
   * parce que `index` envoie les modèles Lucid entiers — une sélection de colonnes ajoutée un
   * jour pour alléger la charge utile le ferait disparaître **sans rien casser** : les pastilles
   * des sources vivantes tomberaient toutes sur le repli neutre, ce qui ressemble à une décision
   * de style plutôt qu'à une panne.
   */
  test('le `kind` de chaque source descend jusqu’à la page', async ({ assert, client }) => {
    const user = await login()
    await VeilleSource.create({
      kind: 'immich',
      url: 'immich:album:un-album',
      title: 'Immich — album de veille',
      fetchIntervalMinutes: 60,
      active: true,
    })

    const props = await itemsOf(client, user)
    assert.lengthOf(props.sources, 1)
    assert.equal(props.sources[0].kind, 'immich')
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
    return createUserWith(['veille.view', 'veille.items.write'])
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

  /**
   * CC-21 — **le premier chemin d'écriture des tags par l'application**.
   *
   * ⚠️ Avant ce lot, `captureValidator` ne portait pas `tags` : la colonne se remplissait par les
   * collecteurs et se figeait. Sur la base réelle, les quatre seuls tags qui restent après CC-106
   * sont des noms de réseaux **devinés** depuis des noms de fichiers Immich — rien que
   * l'utilisateur ait choisi.
   */
  test('la capture pose enfin des tags', async ({ assert, client }) => {
    const user = await login()

    const response = await client
      .post('/veille')
      .json({ type: 'note', title: 'Avec des tags', tags: ['ia', 'self-host'] })
      .header('referrer', '/veille')
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const created = await VeilleItem.query().firstOrFail()
    assert.deepEqual(created.tags, ['ia', 'self-host'])
  })

  /**
   * ⚠️ **Le validateur ne repasse PAS derrière la normalisation de la page**, et ce test le fixe.
   * Accepter `IA` ici ferait deux entrées dans la barre de tags pour une même idée, et deux
   * filtres `? = ANY(tags)` qui ne se rejoignent jamais — sans qu'aucune erreur ne le signale.
   * Un client forgé n'a pas de page pour normaliser à sa place.
   */
  test('un tag mal formé est refusé, pas corrigé en silence', async ({ assert, client }) => {
    const user = await login()

    for (const mauvais of ['IA', 'veille perso', '-ia', 'a'.repeat(64)]) {
      /**
       * ⚠️ **Les deux options comptent, et chacune pour une raison différente.**
       * `.accept('json')` : sans lui, un refus de validation **redirige** (302 + erreurs
       * flashées) au lieu de rendre 422 — le test passerait au vert sur un tag accepté, les deux
       * réponses étant des 302. `.redirects(0)` : sans lui, supertest **suit** le 302 d'un tag
       * accepté et le test rougit en 403 (le jeton CSRF ne survit pas au saut) — rouge pour la
       * mauvaise raison, ce qui envoie chercher un problème d'authentification inexistant.
       * Vérifié en cassant `isValidTag` : le message doit dire « expected 302 to equal 422 ».
       */
      const response = await client
        .post('/veille')
        .accept('json')
        .json({ type: 'note', title: 'Refusée', tags: [mauvais] })
        .loginAs(user)
        .withCsrfToken()
        .redirects(0)

      response.assertStatus(422)
    }

    assert.isEmpty(await VeilleItem.all())
  })

  test('une capture sans tags reste une capture valide', async ({ assert, client }) => {
    const user = await login()

    const response = await client
      .post('/veille')
      .json({ type: 'note', title: 'Sans tag' })
      .header('referrer', '/veille')
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const created = await VeilleItem.query().firstOrFail()
    assert.isEmpty(created.tags)
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
