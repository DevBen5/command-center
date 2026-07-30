import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { createUserWith } from '#tests/helpers/users'
import { boxOf, makeCard, setProgress } from '#tests/helpers/leitner'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCardProgress from '#modules/leitner/models/leitner_card_progress'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'
import LeitnerService from '#modules/leitner/services/leitner_service'

// Le contenu Leitner n'est plus semé : il est saisi depuis l'UI. Ces tests
// vérifient le cycle de vie complet d'une carte à travers les routes HTTP —
// ce qui est écrit en base est bien ce que l'utilisateur a saisi.
test.group('Leitner / cartes saisies par l’utilisateur', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function login() {
    return createUserWith(['leitner.view', 'leitner.cards.write'])
  }

  test('crée une carte non classée, en boîte 1 et due immédiatement', async ({
    client,
    assert,
  }) => {
    const user = await login()

    const response = await client
      .post('/revision/cards')
      .json({ front: 'Recto saisi', back: 'Verso saisi' })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const cards = await LeitnerCard.all()
    assert.lengthOf(cards, 1)
    assert.equal(cards[0].front, 'Recto saisi')
    assert.equal(cards[0].back, 'Verso saisi')
    assert.isNull(cards[0].leitnerThemeId)
    // ⚠️ Due immédiatement **pour tout le monde**, et sans qu'aucune ligne ne soit semée
    // (CC-119) : l'absence de progression *est* « boîte 1, due aujourd'hui ». C'est ce
    // qui fait qu'une carte créée aujourd'hui entre dans la file d'un compte créé hier.
    assert.lengthOf(await LeitnerCardProgress.query().where('leitner_card_id', cards[0].id), 0)
    assert.lengthOf(await new LeitnerService().dueCards(user.id), 1)
  })

  test('crée une carte classée sous un thème', async ({ client, assert }) => {
    const user = await login()
    const category = await LeitnerCategory.create({ name: 'Réseau' })
    const theme = await LeitnerTheme.create({ leitnerCategoryId: category.id, name: 'TLS' })

    await client
      .post('/revision/cards')
      .json({
        front: 'Rôle du handshake ?',
        back: 'Négocier clés et algorithmes.',
        leitnerThemeId: theme.id,
      })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    const card = await LeitnerCard.firstOrFail()
    assert.equal(card.leitnerThemeId, theme.id)
  })

  test('refuse une carte au recto vide sans rien écrire en base', async ({ client, assert }) => {
    const user = await login()

    const response = await client
      .post('/revision/cards')
      .json({ front: '   ', back: 'Verso' })
      .header('referrer', '/revision/settings')
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.lengthOf(await LeitnerCard.all(), 0)
  })

  test('édite une carte : recto, verso et classement sont persistés', async ({
    client,
    assert,
  }) => {
    const user = await login()
    const category = await LeitnerCategory.create({ name: 'Base de données' })
    const theme = await LeitnerTheme.create({ leitnerCategoryId: category.id, name: 'PostgreSQL' })
    const card = await makeCard('Avant', { back: 'Avant' })
    await setProgress(user.id, card.id, { box: 3 })

    await client
      .put(`/revision/cards/${card.id}`)
      .json({ front: 'Après', back: 'Corrigé', leitnerThemeId: theme.id })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    await card.refresh()
    assert.equal(card.front, 'Après')
    assert.equal(card.back, 'Corrigé')
    assert.equal(card.leitnerThemeId, theme.id)
    // L'édition du contenu ne rejoue pas la progression : la boîte est intacte. ⚠️ Depuis
    // CC-119 c'est structurel — l'édition ne touche plus la table qui la porte — mais
    // l'assertion reste : c'est ce que l'écran promet, pas ce que le schéma impose.
    assert.equal(await boxOf(user.id, card.id), 3)
  })

  test('la page de révision ne transporte plus la taxonomie, mais garde le thème de la carte', async ({
    client,
    assert,
  }) => {
    const user = await login()
    const category = await LeitnerCategory.create({ name: 'Réseau' })
    const theme = await LeitnerTheme.create({ leitnerCategoryId: category.id, name: 'TLS' })
    await makeCard('Rôle du handshake ?', {
      back: 'Négocier clés et algorithmes.',
      themeId: theme.id,
    })

    // `?scope=all` : `/revision` nu est l'écran de choix d'un paquet (voir CC-36).
    const response = await client.get('/revision?scope=all').loginAs(user).withInertia()

    response.assertStatus(200)
    const props = response.inertiaProps as Record<string, any>

    // La taxonomie n'alimentait que le formulaire d'ajout : la saisie vit sur /revision/settings.
    assert.notProperty(props, 'categories')
    // Le badge thème de la carte en cours vient du preload, pas de cette taxonomie.
    assert.equal(props.dueCards[0].theme.name, 'TLS')
    assert.equal(props.dueCards[0].theme.category.name, 'Réseau')
  })

  test('supprime une carte de la base', async ({ client, assert }) => {
    const user = await login()
    const card = await makeCard('À supprimer')
    await setProgress(user.id, card.id, { box: 4 })

    await client.delete(`/revision/cards/${card.id}`).loginAs(user).withCsrfToken().redirects(0)

    assert.lengthOf(await LeitnerCard.all(), 0)
    // ⚠️ Supprimer une carte emporte la progression de **tout le monde** dessus (CASCADE) :
    // c'est la seule suppression du module qui détruise des données personnelles sans
    // passer par la suppression d'un compte.
    assert.lengthOf(await LeitnerCardProgress.all(), 0)
  })
})
