import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#core/auth/models/user'
import { createAdmin, createUserWith } from '#tests/helpers/users'
import { makeCard } from '#tests/helpers/leitner'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'

/**
 * Le cloisonnement par **propriétaire** (CC-139) — distinct du cloisonnement par
 * **personne** de CC-119 que couvre `leitner_multi_user.spec.ts` (progression, historique).
 * Ici : qui peut VOIR du contenu, et qui peut l'ÉCRIRE, selon `owner_id`/`is_shared`.
 *
 * ⚠️ **Comme `leitner_readonly.spec.ts`, l'assertion qui compte n'est jamais le seul code
 * HTTP, c'est l'état de la base après le refus** : un 403 rendu après une écriture serait
 * vert ici et catastrophique en vrai.
 */
function writer() {
  return createUserWith(['leitner.view', 'leitner.stats.view', 'leitner.cards.write'])
}

test.group('Leitner / visibilité en lecture (CC-139)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('une carte privée est invisible du catalogue d’un autre compte', async ({
    client,
    assert,
  }) => {
    const owner = await writer()
    const stranger = await writer()
    const mine = await makeCard('Ma carte privée', { ownerId: owner.id, isShared: false })

    const response = await client.get('/revision/settings').loginAs(stranger).withInertia()
    const props = response.inertiaProps as { cards: { front: string }[] }

    assert.isFalse(props.cards.some((card) => card.front === mine.front))
  })

  test('une carte partagée est visible du catalogue d’un autre compte', async ({
    client,
    assert,
  }) => {
    const owner = await writer()
    const stranger = await writer()
    const shared = await makeCard('Ma carte partagée', { ownerId: owner.id, isShared: true })

    const response = await client.get('/revision/settings').loginAs(stranger).withInertia()
    const props = response.inertiaProps as { cards: { front: string }[] }

    assert.isTrue(props.cards.some((card) => card.front === shared.front))
  })

  test('une carte privée n’entre jamais dans la file de révision d’un autre compte', async ({
    client,
    assert,
  }) => {
    const owner = await writer()
    const stranger = await writer()
    await makeCard('Privée, jamais due chez l’autre', { ownerId: owner.id, isShared: false })

    const response = await client.get('/revision?scope=all').loginAs(stranger).withInertia()
    const props = response.inertiaProps as { dueCards: { front: string }[] }

    assert.lengthOf(props.dueCards, 0)
  })

  test('un thème privé ne fuite pas dans l’arbre de choix d’un autre compte, même à 0 carte due', async ({
    client,
    assert,
  }) => {
    const owner = await writer()
    const stranger = await writer()
    const category = await LeitnerCategory.create({
      name: 'Taxonomie perso',
      ownerId: owner.id,
      isShared: false,
    })
    await LeitnerTheme.create({
      leitnerCategoryId: category.id,
      name: 'Secret',
      ownerId: owner.id,
      isShared: false,
    })

    const response = await client.get('/revision').loginAs(stranger).withInertia()
    const props = response.inertiaProps as {
      choices: { categories: { name: string }[] }
    }

    assert.isFalse(props.choices.categories.some((c) => c.name === 'Taxonomie perso'))
  })

  test('le compte « dû » d’un thème partagé n’additionne pas les cartes privées d’un autre compte', async ({
    client,
    assert,
  }) => {
    const owner = await writer()
    const stranger = await writer()
    const category = await LeitnerCategory.create({ name: 'DevOps', isShared: true })
    const theme = await LeitnerTheme.create({
      leitnerCategoryId: category.id,
      name: 'Docker',
      isShared: true,
    })
    await makeCard('Partagée', { themeId: theme.id, isShared: true })
    // Trois cartes privées de `owner` sous le même thème partagé : `stranger` ne doit
    // en compter aucune, sous peine d'annoncer un chiffre plausible et faux.
    await makeCard('Privée 1', { themeId: theme.id, ownerId: owner.id, isShared: false })
    await makeCard('Privée 2', { themeId: theme.id, ownerId: owner.id, isShared: false })
    await makeCard('Privée 3', { themeId: theme.id, ownerId: owner.id, isShared: false })

    const response = await client.get('/revision').loginAs(stranger).withInertia()
    const props = response.inertiaProps as {
      choices: { categories: { themes: { name: string; dueCount: number }[] }[] }
    }

    const docker = props.choices.categories
      .flatMap((c) => c.themes)
      .find((t) => t.name === 'Docker')
    assert.equal(docker?.dueCount, 1)
  })
})

test.group('Leitner / garde d’écriture par propriétaire (CC-139)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('éditer la carte privée d’un autre compte est refusé, et rien ne bouge', async ({
    client,
    assert,
  }) => {
    const owner = await writer()
    const stranger = await writer()
    const card = await makeCard('Intacte', { back: 'Verso', ownerId: owner.id, isShared: false })

    const response = await client
      .put(`/revision/cards/${card.id}`)
      .json({ front: 'Modifiée par un autre', back: 'Verso' })
      .loginAs(stranger)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(403)
    await card.refresh()
    assert.equal(card.front, 'Intacte')
  })

  test('éditer la carte PARTAGÉE d’un autre compte est refusé aussi : `is_shared` n’ouvre que la lecture', async ({
    client,
    assert,
  }) => {
    const owner = await writer()
    const stranger = await writer()
    const card = await makeCard('Partagée mais pas éditable', {
      back: 'Verso',
      ownerId: owner.id,
      isShared: true,
    })

    const response = await client
      .put(`/revision/cards/${card.id}`)
      .json({ front: 'Modifiée par un autre', back: 'Verso' })
      .loginAs(stranger)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(403)
    await card.refresh()
    assert.equal(card.front, 'Partagée mais pas éditable')
  })

  test('supprimer la carte d’un autre compte est refusé, et elle reste en base', async ({
    client,
    assert,
  }) => {
    const owner = await writer()
    const stranger = await writer()
    const card = await makeCard('Increvable', { ownerId: owner.id, isShared: false })

    const response = await client
      .delete(`/revision/cards/${card.id}`)
      .loginAs(stranger)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(403)
    assert.isNotNull(await LeitnerCard.find(card.id))
  })

  test('un administrateur peut éditer une carte privée d’un autre compte', async ({
    client,
    assert,
  }) => {
    // Le pendant du garde ci-dessus : `assertOwnedOrAdmin` laisse passer l'admin, sans
    // quoi refuser la suppression d'un compte propriétaire de partagé (voir plus bas)
    // n'aurait pas d'issue — l'admin doit pouvoir démarquer le contenu de quelqu'un
    // d'autre.
    const owner = await createAdmin()
    const admin = await createAdmin()
    const card = await makeCard('Modifiable par un admin', {
      back: 'Verso',
      ownerId: owner.id,
      isShared: false,
    })

    const response = await client
      .put(`/revision/cards/${card.id}`)
      .json({ front: 'Modifiée par l’admin', back: 'Verso' })
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    await card.refresh()
    assert.equal(card.front, 'Modifiée par l’admin')
  })

  test('reclasser en lot s’arrête net si une seule carte du lot n’est pas possédée', async ({
    client,
    assert,
  }) => {
    const owner = await writer()
    const stranger = await writer()
    const category = await LeitnerCategory.create({ name: 'DevOps' })
    const theme = await LeitnerTheme.create({ leitnerCategoryId: category.id, name: 'Docker' })
    const mine = await makeCard('À moi', { ownerId: stranger.id, isShared: false })
    const theirs = await makeCard('Pas à moi', { ownerId: owner.id, isShared: false })

    const response = await client
      .post('/revision/cards/theme')
      .json({ ids: [mine.id, theirs.id], leitnerThemeId: theme.id })
      .loginAs(stranger)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(403)
    await mine.refresh()
    await theirs.refresh()
    // ⚠️ Tout ou rien : la carte possédée ne doit pas non plus avoir bougé, sinon un
    // lot partiellement accepté fait croire à l'appelant que tout a réussi.
    assert.isNull(mine.leitnerThemeId)
    assert.isNull(theirs.leitnerThemeId)
  })
})

test.group('Leitner / suppression de compte et contenu partagé (CC-139)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('refuse de supprimer un compte qui possède encore du contenu partagé', async ({
    client,
    assert,
  }) => {
    const admin = await createAdmin()
    const owner = await writer()
    await makeCard('Le paquet du foyer', { ownerId: owner.id, isShared: true })

    const response = await client.delete(`/admin/users/${owner.id}`).loginAs(admin).withCsrfToken()

    response.assertStatus(400)
    assert.isNotNull(await User.find(owner.id))
  })

  test('supprime un compte dont tout le contenu est privé, qui devient orphelin', async ({
    client,
    assert,
  }) => {
    const admin = await createAdmin()
    const owner = await writer()
    const card = await makeCard('Privée, jamais partagée', { ownerId: owner.id, isShared: false })

    const response = await client
      .delete(`/admin/users/${owner.id}`)
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    assert.isNull(await User.find(owner.id))

    // Le contenu survit, orphelin — jamais de CASCADE sur du contenu.
    await card.refresh()
    assert.isNull(card.ownerId)
    assert.isFalse(card.isShared)
  })

  test('un contenu orphelin n’est visible que d’un administrateur', async ({ client, assert }) => {
    const admin = await createAdmin()
    const owner = await writer()
    const stranger = await writer()
    const card = await makeCard('Orpheline', { ownerId: owner.id, isShared: false })

    await client.delete(`/admin/users/${owner.id}`).loginAs(admin).withCsrfToken()
    await card.refresh()
    assert.isNull(card.ownerId)

    const forStranger = await client.get('/revision/settings').loginAs(stranger).withInertia()
    const strangerProps = forStranger.inertiaProps as { cards: { front: string }[] }
    assert.isFalse(strangerProps.cards.some((c) => c.front === 'Orpheline'))

    const forAdmin = await client.get('/revision/settings').loginAs(admin).withInertia()
    const adminProps = forAdmin.inertiaProps as { cards: { front: string }[] }
    assert.isTrue(adminProps.cards.some((c) => c.front === 'Orpheline'))
  })

  test('décocher « Partagé » débloque la suppression du compte', async ({ client }) => {
    const admin = await createAdmin()
    const owner = await writer()
    const card = await makeCard('Redevenue privée', { ownerId: owner.id, isShared: true })

    const blocked = await client.delete(`/admin/users/${owner.id}`).loginAs(admin).withCsrfToken()
    blocked.assertStatus(400)

    // Le propriétaire lui-même démarque son contenu.
    await client
      .put(`/revision/cards/${card.id}`)
      .json({ front: card.front, back: card.back, isShared: false })
      .loginAs(owner)
      .withCsrfToken()
      .redirects(0)

    const unblocked = await client
      .delete(`/admin/users/${owner.id}`)
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)
    unblocked.assertStatus(302)
  })
})
