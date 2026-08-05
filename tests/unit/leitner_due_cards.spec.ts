import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'
import LeitnerService from '#modules/leitner/services/leitner_service'
import type LeitnerCard from '#modules/leitner/models/leitner_card'
import { makeCard, setProgress } from '#tests/helpers/leitner'
import { createAdmin } from '#tests/helpers/users'

// La file de révision vit dans `LeitnerService.dueCards(userId, scope)` — pas dans le
// contrôleur. C'est ce qui rend testable unitairement à la fois **l'ordre** de la file
// (que seul un test fonctionnel verrouillait) et le **paquet** : les deux tiennent
// ensemble, puisque restreindre la file ne doit rien changer à son ordre.
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

  /**
   * Une carte due depuis `days` jours **pour cette personne**. À `0`, on ne pose aucune
   * progression : l'absence vaut déjà « due aujourd'hui », et c'est le cas le plus
   * fréquent — semer une ligne ici masquerait le comportement d'un compte neuf.
   */
  async function dueCard(userId: number, front: string, themeId: number | null, days = 0) {
    const card = await makeCard(front, { themeId })
    if (days !== 0) await setProgress(userId, card.id, { dueDaysAgo: days })
    return card
  }

  const fronts = (cards: LeitnerCard[]) => cards.map((card) => card.front)

  test('paquet `all` : toutes les cartes dues, classées ou non', async ({ assert }) => {
    const user = await createAdmin()
    const { docker } = await taxonomy()
    await dueCard(user.id, 'Classée', docker.id)
    await dueCard(user.id, 'Non classée', null)

    assert.sameMembers(fronts(await service.dueCards(user.id)), ['Classée', 'Non classée'])
  })

  test('paquet `theme` : une carte d’un autre thème n’apparaît pas', async ({ assert }) => {
    const user = await createAdmin()
    const { docker, kubernetes } = await taxonomy()
    await dueCard(user.id, 'Docker', docker.id)
    await dueCard(user.id, 'Kubernetes', kubernetes.id)
    await dueCard(user.id, 'Non classée', null)

    const cards = await service.dueCards(user.id, { kind: 'theme', id: docker.id })
    assert.deepEqual(fronts(cards), ['Docker'])
  })

  test('paquet `category` : tous ses thèmes, et eux seuls', async ({ assert }) => {
    const user = await createAdmin()
    const { devops, docker, kubernetes, tls } = await taxonomy()
    await dueCard(user.id, 'Docker', docker.id)
    await dueCard(user.id, 'Kubernetes', kubernetes.id)
    await dueCard(user.id, 'TLS', tls.id)
    await dueCard(user.id, 'Non classée', null)

    // Une carte ne connaît que son thème : la catégorie passe par une sous-requête sur
    // `leitner_themes` — d'où le fait qu'un thème frère entre dans le paquet.
    const cards = await service.dueCards(user.id, { kind: 'category', id: devops.id })
    assert.sameMembers(fronts(cards), ['Docker', 'Kubernetes'])
  })

  test('un thème frère est dans la catégorie, mais pas dans le thème', async ({ assert }) => {
    const user = await createAdmin()
    const { devops, docker, kubernetes } = await taxonomy()
    await dueCard(user.id, 'Kubernetes', kubernetes.id)

    assert.deepEqual(fronts(await service.dueCards(user.id, { kind: 'category', id: devops.id })), [
      'Kubernetes',
    ])
    assert.isEmpty(await service.dueCards(user.id, { kind: 'theme', id: docker.id }))
  })

  test('paquet `unclassified` : les cartes sans thème, et elles seules', async ({ assert }) => {
    const user = await createAdmin()
    const { docker } = await taxonomy()
    await dueCard(user.id, 'Classée', docker.id)
    await dueCard(user.id, 'Non classée', null)

    assert.deepEqual(fronts(await service.dueCards(user.id, { kind: 'unclassified' })), [
      'Non classée',
    ])
  })

  test('une carte non due est hors de la file, paquet ou pas', async ({ assert }) => {
    const user = await createAdmin()
    const { docker } = await taxonomy()
    await dueCard(user.id, 'Due', docker.id)
    const later = await makeCard('Pas due', { themeId: docker.id })
    await setProgress(user.id, later.id, { box: 3, dueDaysAgo: -4 })

    assert.deepEqual(fronts(await service.dueCards(user.id, { kind: 'theme', id: docker.id })), [
      'Due',
    ])
  })

  test('l’ordre tient à l’intérieur d’un paquet', async ({ assert }) => {
    const user = await createAdmin()
    const { docker, tls } = await taxonomy()
    // Une carte d'un autre thème s'intercale par l'échéance : le paquet doit la retirer
    // sans déranger l'ordre des autres.
    await dueCard(user.id, 'En retard de 3 j', docker.id, 3)
    await dueCard(user.id, 'Hors du paquet, très en retard', tls.id, 10)
    await dueCard(user.id, 'Due aujourd’hui', docker.id, 0)
    await dueCard(user.id, 'En retard de 1 j', docker.id, 1)

    const cards = await service.dueCards(user.id, { kind: 'theme', id: docker.id })
    assert.deepEqual(fronts(cards), ['En retard de 3 j', 'En retard de 1 j', 'Due aujourd’hui'])
  })

  test('une carte notée `again` reste dans le paquet, en fin de file', async ({ assert }) => {
    const user = await createAdmin()
    const { docker } = await taxonomy()
    const first = await dueCard(user.id, 'Première', docker.id, 1)
    await dueCard(user.id, 'Seconde', docker.id, 0)

    await service.review(user.id, first, 'again')

    // `again` laisse la carte due le jour même : le paquet ne se termine pas tant
    // qu'elle n'est pas passée. Elle repart en fin de file (échéance la plus tardive
    // des cartes dues, et écriture la plus récente) — jamais en tête, malgré sa boîte 1.
    //
    // ⚠️ **C'est le test qui tient la traduction la plus fragile de CC-119** : le second
    // critère de tri lit l'`updated_at` de la PROGRESSION. Laissé sur celui de la carte —
    // qui ne bouge plus à la note — « Première » resterait en tête et se re-présenterait
    // en boucle, session bloquée, avec un typecheck vert.
    const cards = await service.dueCards(user.id, { kind: 'theme', id: docker.id })
    assert.deepEqual(fronts(cards), ['Seconde', 'Première'])
  })

  test('une carte jamais notée est due, sans aucune ligne de progression', async ({ assert }) => {
    // ⚠️ Le cas d'un compte neuf, et celui d'une carte créée après lui : rien n'est semé,
    // ni à l'inscription ni à la création. Une jointure interne — ou un `where` sur la
    // seule table de progression — rendrait cette file vide, sans la moindre erreur.
    const newcomer = await createAdmin()
    const { docker } = await taxonomy()
    await makeCard('Jamais vue', { themeId: docker.id })

    const cards = await service.dueCards(newcomer.id, { kind: 'theme', id: docker.id })
    assert.deepEqual(fronts(cards), ['Jamais vue'])
  })

  test('le thème et sa catégorie sont préchargés — la carte affiche son classement', async ({
    assert,
  }) => {
    const user = await createAdmin()
    const { docker } = await taxonomy()
    await dueCard(user.id, 'Classée', docker.id)

    const [card] = await service.dueCards(user.id, { kind: 'theme', id: docker.id })
    assert.equal(card.theme.name, 'Docker')
    assert.equal(card.theme.category.name, 'DevOps')
  })

  test('la carte porte SON id, jamais celui de la ligne de progression', async ({ assert }) => {
    // ⚠️ Le pire piège du lot : sans `select('leitner_cards.*')`, Lucid émet `select *` et
    // `leitner_card_progress.id` écrase `leitner_cards.id`. L'écran afficherait des cartes
    // parfaitement plausibles, et noter la carte affichée écrirait sur une autre. Rien —
    // ni typecheck, ni lint — ne le dirait.
    const user = await createAdmin()
    const { docker } = await taxonomy()
    const card = await makeCard('Recto', { themeId: docker.id })
    await setProgress(user.id, card.id, { box: 2, dueDaysAgo: 1 })

    const [due] = await service.dueCards(user.id, { kind: 'theme', id: docker.id })
    assert.strictEqual(due.id, card.id)
    assert.equal(due.front, 'Recto')
  })
})

test.group('Leitner / resolveScope', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  const service = new LeitnerService()

  test('sans paramètre : toutes les cartes', async ({ assert }) => {
    const user = await createAdmin()
    const resolved = await service.resolveScope({}, user.id)
    assert.isTrue(resolved.ok)
    assert.deepEqual(resolved, { ok: true, scope: { kind: 'all' }, label: 'Toutes les cartes' })
  })

  test('un thème rend son paquet et son libellé complet', async ({ assert }) => {
    const user = await createAdmin()
    const category = await LeitnerCategory.create({ name: 'DevOps' })
    const theme = await LeitnerTheme.create({ leitnerCategoryId: category.id, name: 'Docker' })

    assert.deepEqual(await service.resolveScope({ theme: theme.id }, user.id), {
      ok: true,
      scope: { kind: 'theme', id: theme.id },
      label: 'DevOps · Docker',
    })
  })

  test('un thème inexistant est REFUSÉ, jamais rabattu sur « tout »', async ({ assert }) => {
    // Le repli muet est le mode d'échec que ce ticket existe pour éviter : un thème
    // supprimé depuis un autre onglet, et on réviserait toute sa base en croyant
    // travailler Docker.
    const user = await createAdmin()
    assert.deepEqual(await service.resolveScope({ theme: 999_999 }, user.id), {
      ok: false,
      reason: 'unknown-theme',
    })
  })

  test('une catégorie inexistante est refusée', async ({ assert }) => {
    const user = await createAdmin()
    assert.deepEqual(await service.resolveScope({ category: 999_999 }, user.id), {
      ok: false,
      reason: 'unknown-category',
    })
  })

  test('`category` et `theme` ensemble : refus, pas de devinette', async ({ assert }) => {
    const user = await createAdmin()
    const category = await LeitnerCategory.create({ name: 'DevOps' })
    const theme = await LeitnerTheme.create({ leitnerCategoryId: category.id, name: 'Docker' })

    // Ni « le dernier gagne », ni « le plus précis gagne » : une combinaison qu'on n'a
    // pas voulue est une erreur.
    assert.deepEqual(
      await service.resolveScope({ category: category.id, theme: theme.id }, user.id),
      { ok: false, reason: 'combined' }
    )
  })

  test('un thème privé chez un autre compte est refusé comme inexistant', async ({ assert }) => {
    // CC-139 : un id qui existe mais n'est pas visible se comporte exactement comme un
    // id inexistant — jamais un troisième cas qui distinguerait « existe mais caché ».
    const owner = await createAdmin()
    const stranger = await createAdmin()
    const category = await LeitnerCategory.create({
      name: 'Perso',
      ownerId: owner.id,
      isShared: false,
    })
    const theme = await LeitnerTheme.create({
      leitnerCategoryId: category.id,
      name: 'Secret',
      ownerId: owner.id,
      isShared: false,
    })

    assert.deepEqual(await service.resolveScope({ theme: theme.id }, stranger.id), {
      ok: false,
      reason: 'unknown-theme',
    })
    assert.deepEqual(await service.resolveScope({ theme: theme.id }, owner.id), {
      ok: true,
      scope: { kind: 'theme', id: theme.id },
      label: 'Perso · Secret',
    })
  })
})

test.group('Leitner / dueScopeChoices', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  const service = new LeitnerService()

  test('compte les cartes DUES, jamais le total du thème', async ({ assert }) => {
    const user = await createAdmin()
    const category = await LeitnerCategory.create({ name: 'DevOps' })
    const docker = await LeitnerTheme.create({ leitnerCategoryId: category.id, name: 'Docker' })
    const kubernetes = await LeitnerTheme.create({
      leitnerCategoryId: category.id,
      name: 'Kubernetes',
    })

    await makeCard('Due', { themeId: docker.id })
    const later = await makeCard('Pas due', { themeId: docker.id })
    await setProgress(user.id, later.id, { box: 4, dueDaysAgo: -7 })
    await makeCard('Due, autre thème', { themeId: kubernetes.id })
    await makeCard('Due, non classée', { themeId: null })

    const choices = await service.dueScopeChoices(user.id)
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

  test('les comptes suivent la personne, jamais l’installation', async ({ assert }) => {
    // La même carte, deux comptes : celui qui l'a repoussée ne la voit plus, l'autre si.
    // Sans le filtre, l'écran de choix annoncerait à chacun le paquet de l'autre.
    const mine = await createAdmin()
    const theirs = await createAdmin()
    const category = await LeitnerCategory.create({ name: 'DevOps' })
    const docker = await LeitnerTheme.create({ leitnerCategoryId: category.id, name: 'Docker' })

    const card = await makeCard('Partagée', { themeId: docker.id })
    await setProgress(mine.id, card.id, { box: 4, dueDaysAgo: -7 })

    const forMe = await service.dueScopeChoices(mine.id)
    const forThem = await service.dueScopeChoices(theirs.id)
    assert.strictEqual(forMe.totalDueCount, 0)
    assert.strictEqual(forThem.totalDueCount, 1)
  })

  test('un thème sans carte due existe, à 0', async ({ assert }) => {
    const user = await createAdmin()
    const category = await LeitnerCategory.create({ name: 'Réseau' })
    await LeitnerTheme.create({ leitnerCategoryId: category.id, name: 'TLS' })

    const choices = await service.dueScopeChoices(user.id)
    assert.deepEqual(choices.categories[0].themes, [
      { id: choices.categories[0].themes[0].id, name: 'TLS', dueCount: 0 },
    ])
    assert.strictEqual(choices.categories[0].dueCount, 0)
    assert.strictEqual(choices.totalDueCount, 0)
  })
})
