import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'
import LeitnerService from '#modules/leitner/services/leitner_service'

// La file de révision vit dans `LeitnerService.dueCards(scope)` — pas dans le contrôleur.
// C'est ce qui rend testable unitairement à la fois **l'ordre** de la file (que seul un
// test fonctionnel verrouillait) et le **paquet** : les deux tiennent ensemble, puisque
// restreindre la file ne doit rien changer à son ordre.
test.group('Leitner / dueCards(scope)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  const service = new LeitnerService()

  async function taxonomy() {
    const devops = await LeitnerCategory.create({ name: 'DevOps' })
    const reseau = await LeitnerCategory.create({ name: 'Réseau' })

    return {
      devops,
      reseau,
      docker: await LeitnerTheme.create({ leitnerCategoryId: devops.id, name: 'Docker' }),
      kubernetes: await LeitnerTheme.create({ leitnerCategoryId: devops.id, name: 'Kubernetes' }),
      tls: await LeitnerTheme.create({ leitnerCategoryId: reseau.id, name: 'TLS' }),
    }
  }

  function makeCard(front: string, themeId: number | null, days = 0) {
    return LeitnerCard.create({
      front,
      back: 'Verso',
      box: 1,
      leitnerThemeId: themeId,
      nextReview: DateTime.now().minus({ days }),
    })
  }

  const fronts = (cards: LeitnerCard[]) => cards.map((card) => card.front)

  test('paquet `all` : toutes les cartes dues, classées ou non', async ({ assert }) => {
    const { docker } = await taxonomy()
    await makeCard('Classée', docker.id)
    await makeCard('Non classée', null)

    assert.sameMembers(fronts(await service.dueCards()), ['Classée', 'Non classée'])
  })

  test('paquet `theme` : une carte d’un autre thème n’apparaît pas', async ({ assert }) => {
    const { docker, kubernetes } = await taxonomy()
    await makeCard('Docker', docker.id)
    await makeCard('Kubernetes', kubernetes.id)
    await makeCard('Non classée', null)

    const cards = await service.dueCards({ kind: 'theme', id: docker.id })
    assert.deepEqual(fronts(cards), ['Docker'])
  })

  test('paquet `category` : tous ses thèmes, et eux seuls', async ({ assert }) => {
    const { devops, docker, kubernetes, tls } = await taxonomy()
    await makeCard('Docker', docker.id)
    await makeCard('Kubernetes', kubernetes.id)
    await makeCard('TLS', tls.id)
    await makeCard('Non classée', null)

    // Une carte ne connaît que son thème : la catégorie passe par une sous-requête sur
    // `leitner_themes` — d'où le fait qu'un thème frère entre dans le paquet.
    const cards = await service.dueCards({ kind: 'category', id: devops.id })
    assert.sameMembers(fronts(cards), ['Docker', 'Kubernetes'])
  })

  test('un thème frère est dans la catégorie, mais pas dans le thème', async ({ assert }) => {
    const { devops, docker, kubernetes } = await taxonomy()
    await makeCard('Kubernetes', kubernetes.id)

    assert.deepEqual(fronts(await service.dueCards({ kind: 'category', id: devops.id })), [
      'Kubernetes',
    ])
    assert.isEmpty(await service.dueCards({ kind: 'theme', id: docker.id }))
  })

  test('paquet `unclassified` : les cartes sans thème, et elles seules', async ({ assert }) => {
    const { docker } = await taxonomy()
    await makeCard('Classée', docker.id)
    await makeCard('Non classée', null)

    assert.deepEqual(fronts(await service.dueCards({ kind: 'unclassified' })), ['Non classée'])
  })

  test('une carte non due est hors de la file, paquet ou pas', async ({ assert }) => {
    const { docker } = await taxonomy()
    await makeCard('Due', docker.id)
    await LeitnerCard.create({
      front: 'Pas due',
      back: 'Verso',
      box: 3,
      leitnerThemeId: docker.id,
      nextReview: DateTime.now().plus({ days: 4 }),
    })

    assert.deepEqual(fronts(await service.dueCards({ kind: 'theme', id: docker.id })), ['Due'])
  })

  test('l’ordre tient à l’intérieur d’un paquet', async ({ assert }) => {
    const { docker, tls } = await taxonomy()
    // Une carte d'un autre thème s'intercale par l'échéance : le paquet doit la retirer
    // sans déranger l'ordre des autres.
    await makeCard('En retard de 3 j', docker.id, 3)
    await makeCard('Hors du paquet, très en retard', tls.id, 10)
    await makeCard('Due aujourd’hui', docker.id, 0)
    await makeCard('En retard de 1 j', docker.id, 1)

    const cards = await service.dueCards({ kind: 'theme', id: docker.id })
    assert.deepEqual(fronts(cards), ['En retard de 3 j', 'En retard de 1 j', 'Due aujourd’hui'])
  })

  test('une carte notée `again` reste dans le paquet, en fin de file', async ({ assert }) => {
    const { docker } = await taxonomy()
    const first = await makeCard('Première', docker.id, 1)
    await makeCard('Seconde', docker.id, 0)

    await service.review(first, 'again')

    // `again` laisse la carte due le jour même : le paquet ne se termine pas tant
    // qu'elle n'est pas passée. Elle repart en fin de file (échéance la plus tardive
    // des cartes dues, et écriture la plus récente) — jamais en tête, malgré sa boîte 1.
    const cards = await service.dueCards({ kind: 'theme', id: docker.id })
    assert.deepEqual(fronts(cards), ['Seconde', 'Première'])
  })

  test('le thème et sa catégorie sont préchargés — la carte affiche son classement', async ({
    assert,
  }) => {
    const { docker } = await taxonomy()
    await makeCard('Classée', docker.id)

    const [card] = await service.dueCards({ kind: 'theme', id: docker.id })
    assert.equal(card.theme.name, 'Docker')
    assert.equal(card.theme.category.name, 'DevOps')
  })
})

test.group('Leitner / resolveScope', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  const service = new LeitnerService()

  test('sans paramètre : toutes les cartes', async ({ assert }) => {
    const resolved = await service.resolveScope({})
    assert.isTrue(resolved.ok)
    assert.deepEqual(resolved, { ok: true, scope: { kind: 'all' }, label: 'Toutes les cartes' })
  })

  test('un thème rend son paquet et son libellé complet', async ({ assert }) => {
    const category = await LeitnerCategory.create({ name: 'DevOps' })
    const theme = await LeitnerTheme.create({ leitnerCategoryId: category.id, name: 'Docker' })

    assert.deepEqual(await service.resolveScope({ theme: theme.id }), {
      ok: true,
      scope: { kind: 'theme', id: theme.id },
      label: 'DevOps · Docker',
    })
  })

  test('un thème inexistant est REFUSÉ, jamais rabattu sur « tout »', async ({ assert }) => {
    // Le repli muet est le mode d'échec que ce ticket existe pour éviter : un thème
    // supprimé depuis un autre onglet, et on réviserait toute sa base en croyant
    // travailler Docker.
    assert.deepEqual(await service.resolveScope({ theme: 999_999 }), {
      ok: false,
      reason: 'unknown-theme',
    })
  })

  test('une catégorie inexistante est refusée', async ({ assert }) => {
    assert.deepEqual(await service.resolveScope({ category: 999_999 }), {
      ok: false,
      reason: 'unknown-category',
    })
  })

  test('`category` et `theme` ensemble : refus, pas de devinette', async ({ assert }) => {
    const category = await LeitnerCategory.create({ name: 'DevOps' })
    const theme = await LeitnerTheme.create({ leitnerCategoryId: category.id, name: 'Docker' })

    // Ni « le dernier gagne », ni « le plus précis gagne » : une combinaison qu'on n'a
    // pas voulue est une erreur.
    assert.deepEqual(await service.resolveScope({ category: category.id, theme: theme.id }), {
      ok: false,
      reason: 'combined',
    })
  })
})

test.group('Leitner / dueScopeChoices', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  const service = new LeitnerService()

  test('compte les cartes DUES, jamais le total du thème', async ({ assert }) => {
    const category = await LeitnerCategory.create({ name: 'DevOps' })
    const docker = await LeitnerTheme.create({ leitnerCategoryId: category.id, name: 'Docker' })
    const kubernetes = await LeitnerTheme.create({
      leitnerCategoryId: category.id,
      name: 'Kubernetes',
    })

    await LeitnerCard.create({
      front: 'Due',
      back: 'Verso',
      box: 1,
      leitnerThemeId: docker.id,
      nextReview: DateTime.now(),
    })
    await LeitnerCard.create({
      front: 'Pas due',
      back: 'Verso',
      box: 4,
      leitnerThemeId: docker.id,
      nextReview: DateTime.now().plus({ days: 7 }),
    })
    await LeitnerCard.create({
      front: 'Due, autre thème',
      back: 'Verso',
      box: 1,
      leitnerThemeId: kubernetes.id,
      nextReview: DateTime.now(),
    })
    await LeitnerCard.create({
      front: 'Due, non classée',
      back: 'Verso',
      box: 1,
      leitnerThemeId: null,
      nextReview: DateTime.now(),
    })

    const choices = await service.dueScopeChoices()
    const [devops] = choices.categories

    assert.deepEqual(
      devops.themes.map((theme) => [theme.name, theme.dueCount]),
      [
        ['Docker', 1],
        ['Kubernetes', 1],
      ]
    )
    // ⚠️ La somme, pas la concaténation : Postgres rend `count(*)` en chaîne, et
    // `'1' + '1'` vaudrait `'11'` — un compte de thème seul ne l'attraperait pas
    // (`assert.equal` de chai est laxiste).
    assert.strictEqual(devops.dueCount, 2)
    assert.strictEqual(choices.unclassifiedDueCount, 1)
    assert.strictEqual(choices.totalDueCount, 3)
  })

  test('un thème sans carte due existe, à 0', async ({ assert }) => {
    const category = await LeitnerCategory.create({ name: 'Réseau' })
    await LeitnerTheme.create({ leitnerCategoryId: category.id, name: 'TLS' })

    const choices = await service.dueScopeChoices()
    assert.deepEqual(choices.categories[0].themes, [
      { id: choices.categories[0].themes[0].id, name: 'TLS', dueCount: 0 },
    ])
    assert.strictEqual(choices.categories[0].dueCount, 0)
    assert.strictEqual(choices.totalDueCount, 0)
  })
})
