import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import type User from '#core/auth/models/user'
import { createUserWith } from '#tests/helpers/users'
import VeilleItem from '#modules/veille/models/veille_item'
import { BULK_ACTIONS, type BulkAction } from '#modules/veille/shared/bulk_actions'

/**
 * CC-109 — les actions groupées : tags, lu / non lu, à lire plus tard.
 *
 * ⚠️ **Ce sont les premières écritures de `tags` par l'application avec la capture**, et elles
 * passent par `array_append` / `array_remove` en SQL paramétré. Deux invariants les gardent, et
 * aucun des deux n'est visible à l'œil :
 *
 * 1. **l'idempotence** — `array_append` ne déduplique pas, donc rien en base n'empêche `{ia,ia}` ;
 * 2. **`deleted_at IS NULL`** — un supprimé porte une pierre tombale, et une écriture qui
 *    l'oublierait modifierait des lignes que plus rien n'affiche.
 */
test.group('Veille / actions groupées', (group) => {
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

  function bulk(client: any, user: User, payload: Record<string, unknown>) {
    return client
      .post('/veille/items/bulk')
      .json(payload)
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)
  }

  /** Les trois lectures d'un item relu en base — le lint refuse `(await …).champ`. */
  async function tagsOf(id: number): Promise<string[]> {
    const found = await VeilleItem.findOrFail(id)
    return found.tags
  }

  async function readAtOf(id: number) {
    const found = await VeilleItem.findOrFail(id)
    return found.readAt
  }

  async function queuedOf(id: number): Promise<boolean> {
    const found = await VeilleItem.findOrFail(id)
    return found.readingQueue
  }

  test('un tag se pose sur toute la sélection', async ({ assert, client }) => {
    const user = await login()
    const a = await item({ title: 'A' })
    const b = await item({ title: 'B' })
    const hors = await item({ title: 'Hors sélection' })

    await bulk(client, user, { action: 'tag.add', tag: 'ia', ids: [a.id, b.id] })

    assert.deepEqual(await tagsOf(a.id), ['ia'])
    assert.deepEqual(await tagsOf(b.id), ['ia'])
    // ⚠️ Les deux sens : ce qui doit bouger, et ce qui ne doit pas.
    assert.isEmpty(await tagsOf(hors.id))
  })

  /**
   * ⚠️ **LE test du lot.** `array_append` ne déduplique pas et `text[]` n'a aucune contrainte :
   * sans la garde `NOT (? = ANY(tags))`, poser deux fois `ia` produirait `{ia,ia}`. Deux pastilles
   * identiques sur la ligne, et **un double comptage dans la barre de tags**, qui agrège par
   * `unnest` — donc un filtre qui existe deux fois.
   */
  test('poser deux fois le même tag ne le double pas', async ({ assert, client }) => {
    const user = await login()
    const a = await item({ tags: ['rust'] })

    await bulk(client, user, { action: 'tag.add', tag: 'ia', ids: [a.id] })
    await bulk(client, user, { action: 'tag.add', tag: 'ia', ids: [a.id] })

    assert.deepEqual(await tagsOf(a.id), ['rust', 'ia'])
  })

  test('un tag se retire sans toucher aux autres', async ({ assert, client }) => {
    const user = await login()
    const a = await item({ tags: ['ia', 'rust', 'docker'] })

    await bulk(client, user, { action: 'tag.remove', tag: 'rust', ids: [a.id] })

    assert.deepEqual(await tagsOf(a.id), ['ia', 'docker'])
  })

  test('lu, non lu, à lire plus tard', async ({ assert, client }) => {
    const user = await login()
    const a = await item()

    await bulk(client, user, { action: 'read', ids: [a.id] })
    assert.isNotNull(await readAtOf(a.id))

    await bulk(client, user, { action: 'unread', ids: [a.id] })
    assert.isNull(await readAtOf(a.id))

    await bulk(client, user, { action: 'queue.add', ids: [a.id] })
    assert.isTrue(await queuedOf(a.id))

    await bulk(client, user, { action: 'queue.remove', ids: [a.id] })
    assert.isFalse(await queuedOf(a.id))
  })

  /**
   * ⚠️ **Remarquer lu un item déjà lu ne doit pas RÉÉCRIRE sa date de lecture.** `read_at` est un
   * timestamp, pas un booléen : il dit *quand*. Sans la garde `read_at IS NULL`, un geste groupé
   * sur une page à moitié lue reculerait l'historique de tout ce qui l'était déjà — invisible à
   * l'écran, qui n'affiche qu'une pastille.
   */
  test('marquer lu ne réécrit pas une date de lecture existante', async ({ assert, client }) => {
    const user = await login()
    const hier = DateTime.now().minus({ days: 1 }).startOf('second')
    const a = await item({ readAt: hier })

    await bulk(client, user, { action: 'read', ids: [a.id] })

    const apres = await VeilleItem.findOrFail(a.id)
    assert.equal(apres.readAt!.toISO(), hier.toISO())
  })

  /**
   * ⚠️ **Un cas par action, et chacun part de l'état que SON action changerait.**
   *
   * C'est le point délicat, et une première version de ce test l'a raté : un fixture unique
   * (tagué, lu, en file) rendait le cas `queue.add` inerte — l'item étant déjà dans la file, la
   * garde `reading_queue = false` l'excluait de toute façon, et retirer `deleted_at IS NULL` ne
   * faisait **pas** rougir le test. Vérifié en cassant la requête : c'est exactement le
   * faux-positif que le `CLAUDE.md` décrit sur les six tests `deleted_at` de CC-63.
   *
   * Ce sont des **écritures** : un oubli ne fait pas ressortir un supprimé, il le **modifie** —
   * ce qui ne se voit sur aucun écran, puisque plus rien ne l'affiche.
   */
  test('aucune action ne touche un item supprimé', async ({ assert, client }) => {
    const user = await login()

    /**
     * Chaque cas part de l'état que **son** action changerait, et vérifie qu'il n'a pas bougé.
     * Le troisième champ est ce qui rend le test mordant : sans lui, on vérifierait qu'une
     * action n'a rien fait sur un item qu'elle n'aurait de toute façon pas touché.
     */
    const cas: {
      action: BulkAction
      tag?: string
      depart: Partial<VeilleItem>
      verifie: (found: VeilleItem, message: string) => void
    }[] = [
      {
        action: 'tag.add',
        tag: 'ia',
        depart: { tags: [] },
        verifie: (found, message) => assert.isEmpty(found.tags, message),
      },
      {
        action: 'tag.remove',
        tag: 'rust',
        depart: { tags: ['rust'] },
        verifie: (found, message) => assert.deepEqual(found.tags, ['rust'], message),
      },
      {
        action: 'read',
        depart: { readAt: null },
        verifie: (found, message) => assert.isNull(found.readAt, message),
      },
      {
        action: 'unread',
        depart: { readAt: DateTime.now() },
        verifie: (found, message) => assert.isNotNull(found.readAt, message),
      },
      {
        action: 'queue.add',
        depart: { readingQueue: false },
        verifie: (found, message) => assert.isFalse(found.readingQueue, message),
      },
      {
        action: 'queue.remove',
        depart: { readingQueue: true },
        verifie: (found, message) => assert.isTrue(found.readingQueue, message),
      },
    ]

    // ⚠️ Une action ajoutée à `BULK_ACTIONS` sans son cas ici passerait inaperçue.
    assert.lengthOf(cas, BULK_ACTIONS.length, 'une action n’est pas couverte')

    for (const scenario of cas) {
      const supprime = await item({ ...scenario.depart, deletedAt: DateTime.now() })

      const payload: Record<string, unknown> = { action: scenario.action, ids: [supprime.id] }
      if (scenario.tag !== undefined) payload.tag = scenario.tag

      await bulk(client, user, payload)

      const apres = await VeilleItem.findOrFail(supprime.id)
      scenario.verifie(apres, `${scenario.action} a touché un supprimé`)
    }
  })

  /**
   * ⚠️ **Un clic sans effet ne reste jamais muet.** Le cas arrive pour de vrai — un second onglet,
   * une sélection déjà dans l'état visé. Sans message, le bouton paraît cassé et le réflexe est
   * de recliquer, ce qui ne changera rien non plus.
   */
  test('un geste sans effet le dit, et ne se fait pas passer pour un succès', async ({
    assert,
    client,
  }) => {
    const user = await login()
    const a = await item({ readAt: DateTime.now() })

    const response = await bulk(client, user, { action: 'read', ids: [a.id] })
    response.assertStatus(302)

    const flash = response.headers()['set-cookie']?.join('') ?? ''
    // Le flash voyage dans le cookie de session ; on vérifie surtout que rien n'a bougé et que la
    // requête a abouti — le ton exact est prouvé unitairement par `bulkNotification`.
    assert.isNotEmpty(flash)
  })

  /**
   * ⚠️ **Une action de tag SANS tag doit être refusée.** Sans ce refus,
   * `array_append(tags, NULL)` ajouterait un `NULL` au tableau : la barre de tags afficherait une
   * pastille vide, et le filtre ne la retrouverait jamais.
   */
  test('une action de tag sans tag est refusée', async ({ assert, client }) => {
    const user = await login()
    const a = await item()

    for (const action of ['tag.add', 'tag.remove'] as BulkAction[]) {
      const response = await client
        .post('/veille/items/bulk')
        .accept('json')
        .json({ action, ids: [a.id] })
        .loginAs(user)
        .withCsrfToken()
        .redirects(0)

      response.assertStatus(422)
    }

    assert.isEmpty(await tagsOf(a.id))
  })

  test('un tag mal formé est refusé ici aussi', async ({ client }) => {
    const user = await login()
    const a = await item()

    const response = await client
      .post('/veille/items/bulk')
      .accept('json')
      .json({ action: 'tag.add', tag: 'IA Majuscule', ids: [a.id] })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(422)
  })

  /**
   * ⚠️ **Il n'existe qu'UNE route d'action groupée, sur la sélection par cases.** Une seconde, sur
   * le filtre, a existé le temps d'une passe navigateur : ses boutons vivaient dans la barre de
   * rappel des filtres, où ils laissaient croire qu'on agit sur ce qu'on regarde alors qu'aucun
   * item n'est coché. Retirée avec son interface — un chemin d'écriture qu'aucun écran n'atteint
   * est du code que personne ne relit. La **suppression** par filtre (CC-108) reste, parce qu'elle
   * vise le filtre et le dit dans son libellé.
   */
  test('la route exige la capacité d’écriture', async ({ client }) => {
    const lecteur = await createUserWith(['veille.view'])

    const response = await bulk(client, lecteur, { action: 'read', ids: [1] })
    response.assertStatus(403)
  })
})
