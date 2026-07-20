import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#core/auth/models/user'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'

// Le paquet d'une session vit **dans l'URL**, et nulle part ailleurs : rien en base,
// rien en session. Ces tests vérifient les deux bouts de cette promesse — qu'il se
// choisit, et surtout qu'il **survit à une note** (le piège n° 1 : `redirect().back()`
// le porte par le `referer` ; un `redirect().toRoute()` le perdrait en silence, et la
// session repartirait sur toutes les cartes dues sans que rien ne le signale).
test.group('Leitner / paquet de révision', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  function login() {
    return User.create({
      fullName: 'Utilisateur Test',
      email: 'test@example.com',
      password: 'secret123',
    })
  }

  async function taxonomy() {
    const devops = await LeitnerCategory.create({ name: 'DevOps' })
    return {
      devops,
      docker: await LeitnerTheme.create({ leitnerCategoryId: devops.id, name: 'Docker' }),
      kubernetes: await LeitnerTheme.create({ leitnerCategoryId: devops.id, name: 'Kubernetes' }),
    }
  }

  function makeCard(front: string, themeId: number | null, dueInDays = 0) {
    return LeitnerCard.create({
      front,
      back: 'Verso',
      box: 1,
      leitnerThemeId: themeId,
      nextReview: DateTime.now().plus({ days: dueInDays }),
    })
  }

  async function props(client: any, user: User, url: string) {
    const response = await client.get(url).loginAs(user).withInertia()
    response.assertStatus(200)
    return response.inertiaProps as Record<string, any>
  }

  test('/revision rend l’écran de choix, avec les comptes DUS', async ({ client, assert }) => {
    const user = await login()
    const { docker, kubernetes } = await taxonomy()
    await makeCard('Due', docker.id)
    // ⚠️ Le piège de `categoryTree()` : elle compterait celle-ci (total du thème). Un
    // thème de 200 cartes dont 0 est due n'a aucun intérêt ce soir.
    await makeCard('Pas due', docker.id, 7)
    await makeCard('Due, non classée', null)

    const page = await props(client, user, '/revision')

    assert.equal(page.view, 'choice')
    assert.isNull(page.scope)
    assert.notProperty(page, 'dueCards')

    const [category] = page.choices.categories
    assert.equal(category.name, 'DevOps')
    assert.strictEqual(category.dueCount, 1)
    assert.deepEqual(
      category.themes.map((theme: any) => [theme.name, theme.dueCount]),
      [
        ['Docker', 1],
        ['Kubernetes', 0],
      ]
    )
    assert.strictEqual(page.choices.unclassifiedDueCount, 1)
    assert.strictEqual(page.choices.totalDueCount, 2)
    assert.equal(kubernetes.id, category.themes[1].id)
  })

  test('?theme=X ne présente QUE les cartes de ce thème', async ({ client, assert }) => {
    const user = await login()
    const { docker, kubernetes } = await taxonomy()
    await makeCard('Docker', docker.id)
    await makeCard('Kubernetes', kubernetes.id)
    await makeCard('Non classée', null)

    const page = await props(client, user, `/revision?theme=${docker.id}`)

    assert.equal(page.view, 'session')
    assert.equal(page.scope.label, 'DevOps · Docker')
    assert.deepEqual(
      page.dueCards.map((card: any) => card.front),
      ['Docker']
    )
    // `dueCount` et la grille des boîtes suivent le paquet : elles décrivent ce qu'on révise.
    assert.strictEqual(page.stats.dueCount, 1)
    assert.strictEqual(page.boxCounts[1], 1)
    // La série, les révisions du jour et le total, eux, restent globaux.
    assert.strictEqual(page.stats.totalCards, 3)
  })

  test('?category=X prend tous les thèmes de la catégorie', async ({ client, assert }) => {
    const user = await login()
    const { devops, docker, kubernetes } = await taxonomy()
    await makeCard('Docker', docker.id)
    await makeCard('Kubernetes', kubernetes.id)
    await makeCard('Non classée', null)

    const page = await props(client, user, `/revision?category=${devops.id}`)

    assert.equal(page.scope.label, 'DevOps')
    assert.sameMembers(
      page.dueCards.map((card: any) => card.front),
      ['Docker', 'Kubernetes']
    )
  })

  test('?scope=unclassified ne prend que les cartes sans thème', async ({ client, assert }) => {
    const user = await login()
    const { docker } = await taxonomy()
    await makeCard('Docker', docker.id)
    await makeCard('Non classée', null)

    const page = await props(client, user, '/revision?scope=unclassified')

    assert.deepEqual(
      page.dueCards.map((card: any) => card.front),
      ['Non classée']
    )
  })

  test('noter une carte CONSERVE le paquet', async ({ client, assert }) => {
    const user = await login()
    const { docker } = await taxonomy()
    const card = await makeCard('Docker', docker.id)

    const scopedUrl = `/revision?theme=${docker.id}`
    const response = await client
      .post(`/revision/${card.id}/review`)
      .json({ grade: 'good' })
      .header('referer', scopedUrl)
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    // ⚠️ Le piège n° 1, et il n'est pas théorique : `redirect().back()` seul rend ici
    // `/revision` — il ne reprend que le `pathname` du referer et **jette la query
    // string**. C'est `withQs()` qui la conserve. Sans ce test, le paquet se serait
    // perdu à chaque note, en silence, et la session serait repartie sur toute la base.
    //
    // L'assertion porte sur l'en-tête brut : `assertRedirectsTo` ne compare que le
    // chemin — il verrait passer exactement la régression qu'on veut arrêter.
    assert.equal(response.headers().location, scopedUrl)
  })

  test('épuiser le paquet rend l’écran de fin', async ({ client, assert }) => {
    const user = await login()
    const { docker } = await taxonomy()
    const card = await makeCard('Docker', docker.id)

    await client
      .post(`/revision/${card.id}/review`)
      .json({ grade: 'good' })
      .header('referer', `/revision?theme=${docker.id}`)
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    const page = await props(client, user, `/revision?theme=${docker.id}`)

    assert.isEmpty(page.dueCards)
    assert.isTrue(page.scope.finished)
  })

  test('une carte notée `again` ne termine PAS le paquet', async ({ client, assert }) => {
    const user = await login()
    const { docker } = await taxonomy()
    const card = await makeCard('Docker', docker.id)

    await client
      .post(`/revision/${card.id}/review`)
      .json({ grade: 'again' })
      .header('referer', `/revision?theme=${docker.id}`)
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    // `again` laisse la carte due le jour même : la fin d'un paquet n'arrive que
    // quand plus aucune de ses cartes n'est due, y compris celles qu'on vient de rater.
    const page = await props(client, user, `/revision?theme=${docker.id}`)
    assert.lengthOf(page.dueCards, 1)
    assert.isFalse(page.scope.finished)
  })

  test('un paquet vide dès le départ n’est PAS l’écran de fin', async ({ client, assert }) => {
    const user = await login()
    const { docker, kubernetes } = await taxonomy()
    await makeCard('Docker', docker.id)

    // Rien n'a été fait dans ce thème : lui dire « terminé, bravo » serait faux.
    const page = await props(client, user, `/revision?theme=${kubernetes.id}`)

    assert.isEmpty(page.dueCards)
    assert.isFalse(page.scope.finished)
  })

  test('un thème inexistant est refusé — et ne révise PAS tout', async ({ client, assert }) => {
    const user = await login()
    const { docker } = await taxonomy()
    await makeCard('Docker', docker.id)
    await makeCard('Non classée', null)

    const response = await client
      .get('/revision?theme=999999')
      .loginAs(user)
      .withInertia()
      .redirects(0)

    // Le repli muet est le mode d'échec que ce ticket existe pour éviter : un 200 ici,
    // et l'utilisateur réviserait toute sa base en croyant travailler un thème.
    response.assertStatus(302)
    assert.equal(response.headers().location, '/revision')
  })

  test('une catégorie inexistante est refusée', async ({ client, assert }) => {
    const user = await login()

    const response = await client
      .get('/revision?category=999999')
      .loginAs(user)
      .withInertia()
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.headers().location, '/revision')
  })

  test('`category` et `theme` ensemble : refusé', async ({ client, assert }) => {
    const user = await login()
    const { devops, docker } = await taxonomy()
    await makeCard('Docker', docker.id)

    const response = await client
      .get(`/revision?category=${devops.id}&theme=${docker.id}`)
      .loginAs(user)
      .withInertia()
      .redirects(0)

    // Pas de « le dernier gagne », pas de « le plus précis gagne ».
    response.assertStatus(302)
    assert.equal(response.headers().location, '/revision')
  })

  test('un paquet mal formé est refusé, pas 500', async ({ client, assert }) => {
    const user = await login()

    const response = await client.get('/revision?theme=docker').loginAs(user).redirects(0)

    response.assertStatus(302)
    assert.equal(response.headers().location, '/revision')
  })
})
