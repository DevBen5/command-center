import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import { createUserWith } from '#tests/helpers/users'
import { createVault, createCatalogItem, unlockedSession } from '#tests/helpers/coffre'

/**
 * La grille du catalogue (CC-227) — `GET /coffre/catalog/items`. Le mur (élévation requise) se
 * prouve dans `coffre_wall.spec.ts`, pas ici — même répartition que les autres routes du module.
 *
 * ⚠️ **La pagination, les filtres, le tri et la recherche sont prouvés contre une VRAIE base** :
 * c'est du SQL, c'est là que ça casse. Aucune de ces assertions ne tiendrait sur une fonction pure.
 */
test.group('Coffre / la grille du catalogue', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(async () => {
    await limiter.clear(['memory'])
    return () => limiter.clear(['memory'])
  })

  test('la pagination est bornée à 30 par page, et le total est correct', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const session = await unlockedSession(user, vault)

    for (let i = 0; i < 35; i++) {
      await createCatalogItem(user.id, {
        reference: `root/photo-${i}.jpg`,
        displayName: `photo-${i}`,
      })
    }

    const page1 = await client
      .get('/coffre/catalog/items')
      .loginAs(user)
      .withSession(session)
      .header('accept', 'application/json')

    page1.assertStatus(200)
    const corps1 = page1.body() as {
      items: unknown[]
      page: number
      perPage: number
      total: number
      totalPages: number
    }
    assert.lengthOf(corps1.items, 30)
    assert.equal(corps1.total, 35)
    assert.equal(corps1.totalPages, 2)
    assert.equal(corps1.page, 1)

    const page2 = await client
      .get('/coffre/catalog/items?page=2')
      .loginAs(user)
      .withSession(session)
      .header('accept', 'application/json')

    page2.assertStatus(200)
    const corps2 = page2.body() as { items: unknown[] }
    assert.lengthOf(corps2.items, 5)
  })

  test('une page au-delà de la dernière retombe sur la dernière page réelle', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const session = await unlockedSession(user, vault)
    await createCatalogItem(user.id)

    const response = await client
      .get('/coffre/catalog/items?page=99')
      .loginAs(user)
      .withSession(session)
      .header('accept', 'application/json')

    response.assertStatus(200)
    const corps = response.body() as { page: number; items: unknown[] }
    assert.equal(corps.page, 1)
    assert.lengthOf(corps.items, 1)
  })

  test('une page non finie ("Infinity") ou décimale ne fait pas planter la requête', async ({
    client,
    assert,
  }) => {
    // ⚠️ `Number('Infinity')` est truthy et NON entier : sans le garde `Number.isFinite` +
    // `Number.isInteger`, cette valeur rejoindrait un OFFSET Postgres et lèverait une erreur non
    // rattrapée (500) plutôt que de retomber proprement sur la page 1.
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const session = await unlockedSession(user, vault)
    await createCatalogItem(user.id)

    for (const page of ['Infinity', '1.5', '-3', 'NaN']) {
      const response = await client
        .get(`/coffre/catalog/items?${new URLSearchParams({ page }).toString()}`)
        .loginAs(user)
        .withSession(session)
        .header('accept', 'application/json')

      response.assertStatus(200)
      const corps = response.body() as { page: number }
      assert.equal(corps.page, 1)
    }
  })

  test('le filtre par source ne rend que la source demandée', async ({ client, assert }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const session = await unlockedSession(user, vault)

    await createCatalogItem(user.id, { source: 'nas', reference: 'root/a.jpg' })
    await createCatalogItem(user.id, { source: 'nas', reference: 'root/b.jpg' })
    await createCatalogItem(user.id, {
      source: 'immich_locked',
      reference: '11111111-2222-4333-8444-555555555555',
    })

    const response = await client
      .get('/coffre/catalog/items?source=nas')
      .loginAs(user)
      .withSession(session)
      .header('accept', 'application/json')

    response.assertStatus(200)
    const corps = response.body() as { items: Array<{ source: string }> }
    assert.lengthOf(corps.items, 2)
    assert.isTrue(corps.items.every((item) => item.source === 'nas'))
  })

  test('le filtre par nature ne rend que la nature demandée', async ({ client, assert }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const session = await unlockedSession(user, vault)

    await createCatalogItem(user.id, { reference: 'root/photo.jpg', nature: 'photo' })
    await createCatalogItem(user.id, { reference: 'root/video.mp4', nature: 'video' })

    const response = await client
      .get('/coffre/catalog/items?nature=video')
      .loginAs(user)
      .withSession(session)
      .header('accept', 'application/json')

    response.assertStatus(200)
    const corps = response.body() as { items: Array<{ nature: string }> }
    assert.lengthOf(corps.items, 1)
    assert.equal(corps.items[0].nature, 'video')
  })

  test('la période exclut ce qui est hors bornes ET ce qui n’a pas de date connue', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const session = await unlockedSession(user, vault)

    await createCatalogItem(user.id, {
      reference: 'root/dans.jpg',
      displayName: 'dans-la-fenetre',
      capturedAt: DateTime.fromISO('2026-06-15'),
    })
    await createCatalogItem(user.id, {
      reference: 'root/avant.jpg',
      displayName: 'avant-la-fenetre',
      capturedAt: DateTime.fromISO('2026-01-01'),
    })
    await createCatalogItem(user.id, {
      reference: 'root/sans-date.jpg',
      displayName: 'sans-date',
      capturedAt: null,
    })

    const response = await client
      .get('/coffre/catalog/items?capturedFrom=2026-06-01&capturedTo=2026-06-30')
      .loginAs(user)
      .withSession(session)
      .header('accept', 'application/json')

    response.assertStatus(200)
    const corps = response.body() as { items: Array<{ displayName: string }> }
    assert.lengthOf(corps.items, 1)
    assert.equal(corps.items[0].displayName, 'dans-la-fenetre')
  })

  test('le tri par nom respecte NULLS LAST, dans les deux sens', async ({ client, assert }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const session = await unlockedSession(user, vault)

    await createCatalogItem(user.id, { reference: 'root/b.jpg', displayName: 'banane' })
    await createCatalogItem(user.id, { reference: 'root/a.jpg', displayName: 'abricot' })
    await createCatalogItem(user.id, { reference: 'root/sans-nom.jpg', displayName: null })

    const asc = await client
      .get('/coffre/catalog/items?sort=displayName&order=asc')
      .loginAs(user)
      .withSession(session)
      .header('accept', 'application/json')
    const ascNoms = (asc.body() as { items: Array<{ displayName: string | null }> }).items.map(
      (item) => item.displayName
    )
    assert.deepEqual(ascNoms, ['abricot', 'banane', null])

    const desc = await client
      .get('/coffre/catalog/items?sort=displayName&order=desc')
      .loginAs(user)
      .withSession(session)
      .header('accept', 'application/json')
    const descNoms = (desc.body() as { items: Array<{ displayName: string | null }> }).items.map(
      (item) => item.displayName
    )
    assert.deepEqual(descNoms, ['banane', 'abricot', null])
  })

  test('la recherche trouve une correspondance, littéralement', async ({ client, assert }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const session = await unlockedSession(user, vault)

    await createCatalogItem(user.id, { reference: 'root/a.jpg', displayName: 'vacances-mer' })
    await createCatalogItem(user.id, { reference: 'root/b.jpg', displayName: 'anniversaire' })

    const response = await client
      .get('/coffre/catalog/items?q=vacances')
      .loginAs(user)
      .withSession(session)
      .header('accept', 'application/json')

    response.assertStatus(200)
    const corps = response.body() as { items: Array<{ displayName: string }> }
    assert.lengthOf(corps.items, 1)
    assert.equal(corps.items[0].displayName, 'vacances-mer')
  })

  test('la recherche sur "%" ne matche QUE les noms contenant un vrai "%", jamais tout le catalogue', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const session = await unlockedSession(user, vault)

    await createCatalogItem(user.id, { reference: 'root/a.jpg', displayName: 'a-100%-sur' })
    await createCatalogItem(user.id, { reference: 'root/b.jpg', displayName: 'sans-pourcent' })

    const response = await client
      .get(`/coffre/catalog/items?${new URLSearchParams({ q: '%' }).toString()}`)
      .loginAs(user)
      .withSession(session)
      .header('accept', 'application/json')

    response.assertStatus(200)
    const corps = response.body() as { items: Array<{ displayName: string }> }
    assert.lengthOf(corps.items, 1)
    assert.equal(corps.items[0].displayName, 'a-100%-sur')
  })

  test('la recherche sur "_" ne matche QUE les noms contenant un vrai "_", jamais un caractère quelconque', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const session = await unlockedSession(user, vault)

    await createCatalogItem(user.id, { reference: 'root/a.jpg', displayName: 'sous_tiret' })
    await createCatalogItem(user.id, { reference: 'root/b.jpg', displayName: 'soustiret' })

    const response = await client
      .get(`/coffre/catalog/items?${new URLSearchParams({ q: 'sous_tiret' }).toString()}`)
      .loginAs(user)
      .withSession(session)
      .header('accept', 'application/json')

    response.assertStatus(200)
    const corps = response.body() as { items: Array<{ displayName: string }> }
    assert.lengthOf(corps.items, 1)
    assert.equal(corps.items[0].displayName, 'sous_tiret')
  })

  test('une saisie hostile (guillemets, point-virgule, apostrophe) ne casse rien et ne révèle rien', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const session = await unlockedSession(user, vault)

    await createCatalogItem(user.id, { reference: 'root/a.jpg', displayName: 'photo-normale' })

    for (const hostile of [`"; DROP TABLE coffre_catalog_items; --`, `'`, `"`, `\\`]) {
      const response = await client
        .get(`/coffre/catalog/items?${new URLSearchParams({ q: hostile }).toString()}`)
        .loginAs(user)
        .withSession(session)
        .header('accept', 'application/json')

      response.assertStatus(200)
      const corps = response.body() as { items: unknown[] }
      assert.lengthOf(corps.items, 0)
    }
  })

  test('une recherche très longue ne casse rien', async ({ client, assert }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const session = await unlockedSession(user, vault)
    await createCatalogItem(user.id)

    const response = await client
      .get(`/coffre/catalog/items?${new URLSearchParams({ q: 'a'.repeat(150) }).toString()}`)
      .loginAs(user)
      .withSession(session)
      .header('accept', 'application/json')

    response.assertStatus(200)
    const corps = response.body() as { items: unknown[] }
    assert.lengthOf(corps.items, 0)
  })

  test('une recherche au-delà de la longueur maximale est refusée (400)', async ({ client }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const session = await unlockedSession(user, vault)

    const response = await client
      .get(`/coffre/catalog/items?${new URLSearchParams({ q: 'a'.repeat(201) }).toString()}`)
      .loginAs(user)
      .withSession(session)
      .header('accept', 'application/json')

    response.assertStatus(400)
  })

  test('missing_since est exclu par défaut, inclus avec includeMissing', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const session = await unlockedSession(user, vault)

    await createCatalogItem(user.id, { reference: 'root/present.jpg', displayName: 'present' })
    await createCatalogItem(user.id, {
      reference: 'root/absent.jpg',
      displayName: 'absent',
      missingSince: DateTime.fromISO('2026-05-01'),
    })

    const parDefaut = await client
      .get('/coffre/catalog/items')
      .loginAs(user)
      .withSession(session)
      .header('accept', 'application/json')
    const corpsParDefaut = parDefaut.body() as { items: Array<{ displayName: string }> }
    assert.lengthOf(corpsParDefaut.items, 1)
    assert.equal(corpsParDefaut.items[0].displayName, 'present')

    const avecAbsents = await client
      .get('/coffre/catalog/items?includeMissing=true')
      .loginAs(user)
      .withSession(session)
      .header('accept', 'application/json')
    const corpsAvecAbsents = avecAbsents.body() as {
      items: Array<{ displayName: string; missingSince: string | null }>
    }
    assert.lengthOf(corpsAvecAbsents.items, 2)
    const absent = corpsAvecAbsents.items.find((item) => item.displayName === 'absent')
    assert.isNotNull(absent?.missingSince)
  })

  test('la vignette est choisie PAR SOURCE : NAS+photo seulement, jamais NAS+vidéo/autre', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const session = await unlockedSession(user, vault)

    await createCatalogItem(user.id, { reference: 'root/photo.jpg', nature: 'photo' })
    await createCatalogItem(user.id, { reference: 'root/video.mp4', nature: 'video' })
    await createCatalogItem(user.id, { reference: 'root/archive.zip', nature: 'other' })
    await createCatalogItem(user.id, {
      source: 'immich_locked',
      reference: '11111111-2222-4333-8444-555555555555',
      nature: 'photo',
    })

    const response = await client
      .get('/coffre/catalog/items?sort=displayName')
      .loginAs(user)
      .withSession(session)
      .header('accept', 'application/json')

    response.assertStatus(200)
    const corps = response.body() as {
      items: Array<{ nature: string; source: string; id: number; thumbnailUrl: string | null }>
    }

    const parNature = new Map(corps.items.map((item) => [`${item.source}:${item.nature}`, item]))
    assert.equal(
      parNature.get('nas:photo')?.thumbnailUrl,
      `/coffre/catalog/nas/${parNature.get('nas:photo')?.id}/thumbnail`
    )
    assert.isNull(parNature.get('nas:video')?.thumbnailUrl)
    assert.isNull(parNature.get('nas:other')?.thumbnailUrl)
    assert.equal(
      parNature.get('immich_locked:photo')?.thumbnailUrl,
      '/coffre/immich/dossier/11111111-2222-4333-8444-555555555555/thumbnail'
    )
  })

  test('des paramètres invalides (source, sort, date) sont refusés (400)', async ({ client }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const session = await unlockedSession(user, vault)

    for (const qs of [
      'source=bogus',
      'nature=bogus',
      'sort=bogus',
      'order=bogus',
      'capturedFrom=pas-une-date',
      // ⚠️ Forme valide (`\d{4}-\d{2}-\d{2}`), calendrier invalide — sans validation réelle du
      // calendrier, cette chaîne rejoindrait telle quelle un `.where('captured_at', …)` et
      // Postgres refuserait de la caster en timestamp : une 500 non rattrapée, pas un refus propre.
      'capturedFrom=2026-99-99',
    ]) {
      const response = await client
        .get(`/coffre/catalog/items?${qs}`)
        .loginAs(user)
        .withSession(session)
        .header('accept', 'application/json')

      response.assertStatus(400)
    }
  })

  test('la page-coquille ne rend AUCUNE donnée de catalogue en prop Inertia', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const session = await unlockedSession(user, vault)
    await createCatalogItem(user.id)

    const response = await client
      .get('/coffre/catalog')
      .loginAs(user)
      .withSession(session)
      .withInertia()

    response.assertStatus(200)
    response.assertInertiaComponent('modules/coffre/catalog')
    const props = response.inertiaProps as Record<string, unknown>
    assert.notProperty(props, 'items')
  })

  test('au-delà du seuil, la route répond 429', async ({ client, assert }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const session = await unlockedSession(user, vault)

    let dernierStatut = 200
    for (let i = 0; i < 61; i++) {
      const response = await client
        .get('/coffre/catalog/items')
        .loginAs(user)
        .withSession(session)
        .header('accept', 'application/json')
      dernierStatut = response.status()
    }

    assert.equal(dernierStatut, 429)
  })
})
