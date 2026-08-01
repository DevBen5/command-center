import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import type User from '#core/auth/models/user'
import { createAdmin, createUserWith } from '#tests/helpers/users'
import { boxOf, makeCard, nextReviewOf, setProgress } from '#tests/helpers/leitner'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCardProgress from '#modules/leitner/models/leitner_card_progress'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import LeitnerReview from '#modules/leitner/models/leitner_review'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'

/**
 * CC-119 — le cloisonnement, éprouvé **par les routes**.
 *
 * Le principe directeur de l'épique CC-77 tient en une phrase : **le contenu ne connaît
 * aucun utilisateur**. Cartes, catégories et thèmes n'ont pas de `user_id` et survivent à
 * la suppression d'un compte ; progression et historique en ont un, et partent avec leur
 * propriétaire. Tout ce fichier vérifie cette ligne de partage, des deux côtés.
 *
 * ⚠️ **Un test multi-utilisateur passe très bien sans aucun cloisonnement** dès lors que
 * les deux comptes ne se marchent jamais dessus. Chacun de ceux-ci a donc été vérifié en
 * retirant le filtre `user_id` du code qu'il vise, et rougit dans ce cas.
 */
test.group('Leitner / cloisonnement par personne', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  function reviewer() {
    return createUserWith(['leitner.view', 'leitner.review', 'leitner.stats.view'])
  }

  function review(client: any, user: User, cardId: number, grade: string, judgment: any = {}) {
    return client
      .post(`/revision/${cardId}/review`)
      .json({ grade, ...judgment })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)
  }

  async function dueFronts(client: any, user: User): Promise<string[]> {
    const response = await client.get('/revision?scope=all').loginAs(user).withInertia()
    response.assertStatus(200)
    const props = response.inertiaProps as Record<string, any>
    return props.dueCards.map((card: { front: string }) => card.front)
  }

  test('noter une carte ne déplace la file de personne d’autre', async ({ client, assert }) => {
    // Le test qui compte : c'est cet invariant qui a rendu sûr d'ouvrir `leitner.review`
    // au rôle invité (CC-121). Avant CC-119, `easy` envoyait la carte deux boîtes plus
    // loin **pour tout le monde** — c'est précisément ce que CC-72 avait dû fermer.
    const mine = await reviewer()
    const theirs = await reviewer()
    const card = await makeCard('Partagée')
    await setProgress(mine.id, card.id, { box: 2 })

    await review(client, theirs, card.id, 'easy')

    assert.equal(await boxOf(mine.id, card.id), 2)
    // ⚠️ **3, pas 4** : il est parti de la boîte 1 — la sienne, celle de l'absence de
    // ligne — et non de ma boîte 2. C'est la démonstration la plus nette du lot : sa note
    // ne lit pas plus ma progression qu'elle ne l'écrit.
    assert.equal(await boxOf(theirs.id, card.id), 3)
    // Ma file est intacte : la carte m'est toujours due.
    assert.deepEqual(await dueFronts(client, mine), ['Partagée'])
    // La sienne s'est vidée : `easy` l'a repoussée de quatre jours, chez lui seul.
    assert.deepEqual(await dueFronts(client, theirs), [])
  })

  test('un compte neuf voit TOUT le paquet, sans qu’on lui ait rien semé', async ({
    client,
    assert,
  }) => {
    // ⚠️ Le point que le commentaire de CC-77 demandait de trancher explicitement : « un
    // compte non-admin fraîchement créé n'a aucune progression, sa file de départ doit
    // être définie ». Elle l'est par l'absence de ligne — boîte 1, due aujourd'hui.
    // Sans ça, l'invité retrouvait la file vide et l'écran mort de CC-81.
    const owner = await reviewer()
    const premiere = await makeCard('Première')
    const seconde = await makeCard('Seconde')
    // Le propriétaire a tout révisé aujourd'hui : SA file est vide.
    await setProgress(owner.id, premiere.id, { box: 5, dueDaysAgo: -30 })
    await setProgress(owner.id, seconde.id, { box: 5, dueDaysAgo: -30 })

    const newcomer = await reviewer()

    assert.deepEqual(await dueFronts(client, owner), [])
    assert.sameMembers(await dueFronts(client, newcomer), ['Première', 'Seconde'])
    // Rien n'a été écrit pour lui : la ligne naîtra à sa première note.
    assert.lengthOf(await LeitnerCardProgress.query().where('user_id', newcomer.id), 0)
  })

  test('une carte créée après un compte lui est due aussitôt', async ({ client, assert }) => {
    // Corollaire du précédent, et la raison de ne rien semer : un semis à l'inscription
    // exigerait un re-semis à chaque carte ajoutée, et une carte créée entre les deux
    // resterait invisible — sans erreur, sans log.
    const user = await reviewer()
    await makeCard('Créée après lui')

    assert.deepEqual(await dueFronts(client, user), ['Créée après lui'])
  })

  test('une carte notée `again` repart en fin de MA file, pas de celle du voisin', async ({
    client,
    assert,
  }) => {
    // ⚠️ Le test de la traduction la plus fragile du lot : l'ordre de la file lit
    // l'`updated_at` de la **progression**. Laissé sur celui de la carte — qui ne bouge
    // plus à la note — « Ratée » resterait en tête et se re-présenterait en boucle.
    const mine = await reviewer()
    const theirs = await reviewer()
    const ratee = await makeCard('Ratée')
    await makeCard('Suivante')
    await setProgress(mine.id, ratee.id, { dueDaysAgo: 1 })
    await setProgress(theirs.id, ratee.id, { dueDaysAgo: 1 })

    assert.deepEqual(await dueFronts(client, mine), ['Ratée', 'Suivante'])

    await review(client, mine, ratee.id, 'again')

    assert.deepEqual(await dueFronts(client, mine), ['Suivante', 'Ratée'])
    // Chez lui, rien n'a bougé : sa progression n'a pas été écrite.
    assert.deepEqual(await dueFronts(client, theirs), ['Ratée', 'Suivante'])
  })

  test('« terminé, bravo » ne se déclenche pas sur le travail d’un autre', async ({
    client,
    assert,
  }) => {
    // `hasReviewedTodayInScope` distingue « paquet terminé » de « vide dès le départ ».
    // Sans filtre, la révision d'un collègue me félicite pour un travail que je n'ai pas
    // fait — et masque le fait que ce paquet ne contenait rien pour moi.
    const mine = await reviewer()
    const theirs = await reviewer()
    const category = await LeitnerCategory.create({ name: 'DevOps' })
    const theme = await LeitnerTheme.create({ leitnerCategoryId: category.id, name: 'Docker' })
    const card = await makeCard('Partagée', { themeId: theme.id })

    // Il révise et vide sa file ; la mienne, je la vide en repoussant la carte sans la noter.
    await review(client, theirs, card.id, 'good')
    await setProgress(mine.id, card.id, { box: 5, dueDaysAgo: -30 })

    const response = await client.get(`/revision?theme=${theme.id}`).loginAs(mine).withInertia()
    const props = response.inertiaProps as Record<string, any>

    assert.lengthOf(props.dueCards, 0)
    // Vide, mais pas « terminé » : je n'ai rien révisé aujourd'hui.
    assert.isFalse(props.scope.finished)
  })

  test('série, journée et rétention ne comptent que MES révisions', async ({ client, assert }) => {
    const mine = await reviewer()
    const theirs = await reviewer()
    const card = await makeCard('Partagée')

    await review(client, theirs, card.id, 'again')
    await review(client, theirs, card.id, 'again')

    const response = await client.get('/revision?scope=all').loginAs(mine).withInertia()
    const props = response.inertiaProps as Record<string, any>

    assert.strictEqual(props.stats.reviewedToday, 0)
    assert.strictEqual(props.stats.streak, 0)
    // `null`, jamais 0 : « rien à mesurer » n'est pas « rétention effondrée ». Ses deux
    // `again` ne doivent pas m'afficher 0 %.
    assert.isNull(props.stats.retention)
    // L'inventaire, lui, reste commun : le contenu n'appartient à personne.
    assert.strictEqual(props.stats.totalCards, 1)
  })

  test('l’onglet Stats ne montre que le travail de celui qui le regarde', async ({
    client,
    assert,
  }) => {
    const mine = await reviewer()
    const theirs = await reviewer()
    const card = await makeCard('Partagée')

    await review(client, theirs, card.id, 'again')

    const response = await client.get('/revision/stats').loginAs(mine).withInertia()
    const props = response.inertiaProps as Record<string, any>

    assert.strictEqual(props.habits.currentStreak, 0)
    assert.strictEqual(props.habits.bestStreak, 0)
    assert.isEmpty(props.weakness)
    assert.isEmpty(props.problemCards.mostAgain)
    assert.deepEqual(
      props.retention.map((window: { rate: number | null }) => window.rate),
      [null, null, null]
    )
  })

  test('le compteur de la barre latérale et la carte d’accueil suivent MA file', async ({
    client,
    assert,
  }) => {
    // ⚠️ Les deux fichiers **hors module** du lot. Ils passent le nom de colonne en
    // chaîne : leur oubli ne casse pas le typecheck, il casse au runtime. Et une
    // seconde définition de « dû » ferait diverger la pastille de l'écran.
    const mine = await createAdmin()
    const card = await makeCard('Partagée')
    await setProgress(mine.id, card.id, { box: 5, dueDaysAgo: -30 })

    const theirs = await createAdmin()

    const forMe = await client.get('/').loginAs(mine).withInertia()
    const forThem = await client.get('/').loginAs(theirs).withInertia()

    assert.strictEqual((forMe.inertiaProps as any).nav.leitner.due, 0)
    assert.strictEqual((forMe.inertiaProps as any).cards.leitner.due, 0)
    assert.strictEqual((forThem.inertiaProps as any).nav.leitner.due, 1)
    assert.strictEqual((forThem.inertiaProps as any).cards.leitner.due, 1)
    // L'inventaire reste commun des deux côtés.
    assert.strictEqual((forMe.inertiaProps as any).cards.leitner.total, 1)
  })

  test('le catalogue est commun, la boîte de chaque ligne ne l’est pas', async ({
    client,
    assert,
  }) => {
    const mine = await createUserWith(['leitner.view'])
    const theirs = await createUserWith(['leitner.view'])
    const card = await makeCard('Partagée')
    await setProgress(mine.id, card.id, { box: 4 })

    const forMe = await client.get('/revision/settings').loginAs(mine).withInertia()
    const forThem = await client.get('/revision/settings').loginAs(theirs).withInertia()

    assert.strictEqual((forMe.inertiaProps as any).cards[0].box, 4)
    // Jamais notée par lui : boîte 1, par la seule absence de ligne.
    assert.strictEqual((forThem.inertiaProps as any).cards[0].box, 1)
    // Et c'est bien la même carte des deux côtés — le contenu est communal.
    assert.strictEqual((forMe.inertiaProps as any).cards[0].id, card.id)
    assert.strictEqual((forThem.inertiaProps as any).cards[0].id, card.id)
  })
})

/**
 * L'autre moitié du principe directeur, et sa conséquence recherchée : **supprimer un
 * compte redevient une opération sûre** — non pas parce qu'on a vérifié ses dépendances,
 * mais parce que rien de partagé ne le référence par construction (CC-77, consommé par
 * CC-80).
 */
test.group('Leitner / suppression d’un compte', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('emporte la progression et l’historique, jamais le contenu', async ({ assert }) => {
    const partant = await createAdmin()
    const restant = await createAdmin()

    const category = await LeitnerCategory.create({ name: 'DevOps' })
    const theme = await LeitnerTheme.create({ leitnerCategoryId: category.id, name: 'Docker' })
    const card = await makeCard('Sa carte', { themeId: theme.id })

    await setProgress(partant.id, card.id, { box: 4 })
    await setProgress(restant.id, card.id, { box: 2 })
    await LeitnerReview.create({
      userId: partant.id,
      leitnerCardId: card.id,
      grade: 'good',
      reviewedAt: (await nextReviewOf(partant.id, card.id))!,
    })
    await LeitnerReview.create({
      userId: restant.id,
      leitnerCardId: card.id,
      grade: 'hard',
      reviewedAt: (await nextReviewOf(restant.id, card.id))!,
    })

    // Aucune vérification de dépendances : c'est tout l'intérêt.
    await partant.delete()

    // Le contenu survit **intact** — carte, thème, catégorie.
    assert.lengthOf(await LeitnerCard.all(), 1)
    assert.lengthOf(await LeitnerTheme.all(), 1)
    assert.lengthOf(await LeitnerCategory.all(), 1)

    // Ses données personnelles sont parties, et elles seules.
    assert.lengthOf(await LeitnerCardProgress.query().where('user_id', partant.id), 0)
    assert.lengthOf(await LeitnerReview.query().where('user_id', partant.id), 0)
    assert.equal(await boxOf(restant.id, card.id), 2)
    assert.lengthOf(await LeitnerReview.query().where('user_id', restant.id), 1)
  })
})
