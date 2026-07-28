import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import type User from '#core/auth/models/user'
import { createUserWith } from '#tests/helpers/users'
import VeilleItem from '#modules/veille/models/veille_item'
import VeilleSource from '#modules/veille/models/veille_source'
import VeilleDeletionService from '#modules/veille/services/veille_deletion_service'
import { immichDedupKey } from '#modules/veille/services/immich_asset'
import FakeImmichClient from '#tests/fakes/fake_immich_client'

/**
 * CC-108 — agir sur **tout ce que le filtre affiche**, au-delà de la page courante.
 *
 * Ce lot lève la borne de CC-63 (« pas de tout sélectionner inter-pages », plafond de 200
 * identifiants au validateur). Il ne pouvait pas se contenter de la retirer : il devait la
 * **remplacer**. Ce que ces tests portent est donc moins « ça marche » que « ce qui bornait le
 * geste borne toujours quelque chose » :
 *
 * 1. **le filtre envoyé désigne exactement le même ensemble que la liste** — l'assertion centrale,
 *    et elle porte sur les deux sens : ce qui doit partir, et ce qui doit rester ;
 * 2. **un filtre vide est refusé**, sans quoi le bouton devient « vider la veille » ;
 * 3. **le décompte vient du serveur**, y compris le nombre d'assets Immich — la seule chose que
 *    l'utilisateur ne peut pas déduire de l'écran.
 */
test.group('Veille / suppression par filtre', (group) => {
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

  async function source(title = 'Source') {
    return VeilleSource.create({
      kind: 'rss',
      url: `https://${title.toLowerCase()}.dev/feed`,
      title,
      fetchIntervalMinutes: 60,
      active: true,
    })
  }

  function removeFiltered(client: any, user: User, filters: Record<string, string>) {
    return client
      .post('/veille/items/filtered/delete')
      .json(filters)
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)
  }

  function countFiltered(client: any, user: User, filters: Record<string, string>) {
    return client.get('/veille/items/filtered/count').qs(filters).loginAs(user)
  }

  /** Les titres encore visibles, dans l'ordre du flux. */
  async function visibles(): Promise<string[]> {
    const items = await VeilleItem.visible().orderBy('id', 'asc')
    return items.map((entry) => entry.title)
  }

  /**
   * ⚠️ **L'assertion centrale du lot, et elle porte sur les DEUX sens.** Un test qui vérifierait
   * seulement que les items filtrés disparaissent passerait au vert sur une implémentation qui
   * supprime toute la table — ce qui est précisément le mode d'échec que ce ticket introduit.
   * Il faut donc asserter aussi ce qui doit **rester**.
   */
  test('le filtre envoyé désigne exactement le même ensemble que la liste', async ({
    assert,
    client,
  }) => {
    const user = await login()
    await item({ title: 'Note visée', type: 'note' })
    await item({ title: 'Autre note visée', type: 'note' })
    await item({ title: 'Article épargné', type: 'article' })

    const response = await removeFiltered(client, user, { type: 'note' })
    response.assertStatus(302)

    assert.deepEqual(await visibles(), ['Article épargné'])
  })

  test('le filtre traverse la pagination, pas seulement la première page', async ({
    assert,
    client,
  }) => {
    const user = await login()
    // 60 items visés : au-delà d'une page de 50, ce qui est tout l'objet du ticket.
    for (let index = 0; index < 60; index++) {
      await item({
        title: `Note ${index}`,
        type: 'note',
        publishedAt: DateTime.now().minus({ minutes: index }),
      })
    }
    await item({ title: 'Article épargné', type: 'article' })

    await removeFiltered(client, user, { type: 'note' })

    assert.deepEqual(await visibles(), ['Article épargné'])
  })

  /**
   * ⚠️ **LE refus qui remplace le plafond de 200.** Sans lui, le bouton devient « vider la
   * veille » derrière un `confirm()` d'une ligne. La page ne l'offre pas — la barre de rappel
   * n'existe pas sans filtre posé — mais **une route est un contrat public** : un `curl` muni
   * d'un cookie de session valide n'a que faire du rendu Vue.
   */
  test('un filtre vide est refusé, et rien ne bouge', async ({ assert, client }) => {
    const user = await login()
    await item({ title: 'Un' })
    await item({ title: 'Deux' })

    const response = await removeFiltered(client, user, {})
    response.assertStatus(302)

    assert.deepEqual(await visibles(), ['Un', 'Deux'])
  })

  /**
   * ⚠️ Le pendant du précédent, sur l'autre route. Un décompte sur filtre vide annoncerait
   * « 102 éléments » et armerait une confirmation pour un geste que le serveur refuse ensuite :
   * l'utilisateur croirait à une panne plutôt qu'à une garde.
   */
  test('le décompte refuse aussi un filtre vide', async ({ client }) => {
    const user = await login()
    await item({ title: 'Un' })

    const response = await countFiltered(client, user, {})
    response.assertStatus(422)
  })

  /**
   * ⚠️ **Le nombre d'assets Immich est la seule chose que l'utilisateur ne peut pas déduire de
   * l'écran.** Le total, il le lit dans « N éléments » ; combien d'images partent réellement à la
   * corbeille d'une autre application, personne ne peut le compter à l'œil sur trois pages.
   */
  test('le décompte annonce le total ET les assets Immich concernés', async ({
    assert,
    client,
  }) => {
    const user = await login()
    await item({ title: 'Image A', type: 'image', dedupKey: immichDedupKey(crypto.randomUUID()) })
    await item({ title: 'Image B', type: 'image', dedupKey: immichDedupKey(crypto.randomUUID()) })
    // Une image sans asset Immich : elle compte dans le total, pas dans la corbeille.
    await item({ title: 'Image sans asset', type: 'image', dedupKey: 'url:https://a.dev/x' })
    await item({ title: 'Article hors filtre', type: 'article' })

    const response = await countFiltered(client, user, { type: 'image' })
    response.assertStatus(200)

    assert.deepEqual(response.body(), { total: 3, media: 2 })
  })

  test('le décompte compte ce que le filtre désigne, pas la table', async ({ assert, client }) => {
    const user = await login()
    const feed = await source('Korben')
    await item({ title: 'Rattaché', veilleSourceId: feed.id, dedupKey: 'url:https://a.dev/1' })
    await item({ title: 'Détaché', dedupKey: 'url:https://b.dev/2' })
    await item({ title: 'Manuel' })

    const response = await countFiltered(client, user, { sourceId: 'none' })

    // ⚠️ Deux items sans source (le détaché et la capture manuelle), pas les trois : un décompte
    // qui rendrait le total de la table passerait le test précédent et échouerait ici.
    assert.deepEqual(response.body(), { total: 2, media: 0 })
  })

  /**
   * ⚠️ **Un supprimé ne se resupprime pas.** C'est l'idempotence par `deleted_at IS NULL`, et
   * elle vaut d'autant plus ici : sans elle, un second clic rappellerait Immich sur des assets
   * déjà à la corbeille — sur *n* items au lieu de 50.
   */
  test('un second passage ne redésigne pas ce qui est déjà parti', async ({ assert, client }) => {
    const user = await login()
    await item({ title: 'Note', type: 'note' })

    await removeFiltered(client, user, { type: 'note' })
    const apres = await countFiltered(client, user, { type: 'note' })

    assert.deepEqual(apres.body(), { total: 0, media: 0 })
    assert.isEmpty(await visibles())
  })

  /**
   * ⚠️ **Masquer un bouton n'est pas un droit.** Les deux routes écrivent ou arment une écriture :
   * `veille.view` ne suffit pour aucune des deux. Le décompte y est inclus délibérément — sous
   * `veille.view`, un compte en lecture seule pourrait sonder la taille d'un lot qu'il n'a pas le
   * droit de supprimer.
   */
  test('les deux routes exigent la capacité d’écriture', async ({ client }) => {
    const lecteur = await createUserWith(['veille.view'])

    const suppression = await removeFiltered(client, lecteur, { type: 'note' })
    suppression.assertStatus(403)

    const decompte = await countFiltered(client, lecteur, { type: 'note' })
    decompte.assertStatus(403)
  })
})

/**
 * CC-108 — **le découpage en lots**, la partie du service que rien d'autre n'exerce.
 *
 * ⚠️ Aucun test n'insère 200 items : sans abaisser la taille de lot, le `break` au premier échec
 * et le décompte des non-tentés resteraient du code que rien ne relit. La couture est la même
 * qu'`assertReachableTarget` dans `feed_fetcher` — une propriété `protected`, jamais relâchée en
 * production.
 */
class SmallBatchDeletion extends VeilleDeletionService {
  protected readonly batchSize: number = 2
}

test.group('Veille / suppression par lots', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function media(title: string) {
    return VeilleItem.create({
      type: 'image',
      title,
      tags: [],
      metadata: {},
      readingQueue: false,
      dedupKey: immichDedupKey(crypto.randomUUID()),
    })
  }

  test('les lots s’enchaînent jusqu’au bout quand tout va bien', async ({ assert }) => {
    const items = [await media('A'), await media('B'), await media('C'), await media('D')]
    const client = new FakeImmichClient([])

    const outcome = await new SmallBatchDeletion(client).deleteItems(items.map((i) => i.id))

    // Quatre items, des lots de deux : deux passes, et rien de perdu entre les deux.
    assert.equal(outcome.deleted, 4)
    assert.equal(outcome.trashed, 4)
    assert.isNull(outcome.error)
    assert.isEmpty(await VeilleItem.visible())
    // ⚠️ **Deux appels à Immich, pas un.** C'est la seule assertion qui prouve que le découpage
    // a réellement eu lieu : les compteurs ci-dessus seraient identiques sans lui.
    assert.lengthOf(client.trashed, 2)
  })

  /**
   * ⚠️ **LE test du découpage.** Immich refuse dès le premier lot : on s'arrête là plutôt que de
   * rappeler une instance éteinte pour chaque lot restant, **rien n'est marqué en base** (c'est
   * l'invariant de CC-63, qui doit survivre au découpage), et les items non tentés sont comptés
   * dans `failed` — les annoncer comme non concernés ferait croire le geste plus complet qu'il
   * ne l'est.
   */
  test('un lot en échec arrête tout, et rien n’est marqué', async ({ assert }) => {
    const items = [await media('A'), await media('B'), await media('C'), await media('D')]
    // `trashDays: 0` : la corbeille est désactivée, le service refuse **avant même d'appeler**.
    const client = new FakeImmichClient([])
    client.trashDaysValue = 0

    const outcome = await new SmallBatchDeletion(client).deleteItems(items.map((i) => i.id))

    assert.equal(outcome.deleted, 0)
    assert.equal(outcome.trashed, 0)
    assert.equal(outcome.failed, 4, 'les deux non tentés comptent parmi les conservés')
    assert.isNotNull(outcome.error)
    assert.lengthOf(await VeilleItem.visible(), 4)
    // ⚠️ **Aucune suppression n'a été demandée**, et pas seulement « rien n'a été marqué » : sur
    // une instance sans corbeille, l'appel serait définitif. Et on ne l'a pas rejoué pour le
    // second lot — c'est le `break`.
    assert.isEmpty(client.trashed)
  })
})
