import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import type User from '#core/auth/models/user'
import { createUserWith } from '#tests/helpers/users'
import { makeCard, setProgress } from '#tests/helpers/leitner'
import LeitnerCardProgress from '#modules/leitner/models/leitner_card_progress'
import LeitnerReview from '#modules/leitner/models/leitner_review'
import LeitnerService from '#modules/leitner/services/leitner_service'

/**
 * CC-262 — **l'inventaire d'acquis, éprouvé par les routes**.
 *
 * Ce que ce fichier garde, et que l'unitaire ne peut pas garder :
 *
 * - la file d'entretien a enfin **un chemin** (`?queue=maintenance`) — CC-261 l'avait
 *   laissée sans appelant, donc une carte acquise n'était atteignable par aucun écran ;
 * - `queue` compte dans « un paquet a-t-il été demandé ? ». **L'oublier ne lève rien** :
 *   l'écran de choix s'afficherait à la place de la session, et le bouton d'entretien
 *   paraîtrait « ne rien faire » ;
 * - noter **conserve** la file, exactement comme elle conserve le paquet (`withQs()`, le
 *   piège n° 1 du module) ;
 * - un second compte ne voit ni les acquis ni les cartes du premier.
 */
test.group('Leitner / inventaire d’acquis', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  function reviewer() {
    return createUserWith(['leitner.view', 'leitner.review', 'leitner.stats.view'])
  }

  /** Une carte acquise il y a `masteredDaysAgo` jours, dont l'entretien est dû ou non. */
  async function masteredCard(
    user: User,
    front: string,
    options: { masteredDaysAgo: number; dueDaysAgo?: number; shared?: boolean; ownerId?: number }
  ) {
    const card = await makeCard(front, {
      ownerId: options.ownerId,
      isShared: options.shared ?? options.ownerId === undefined,
    })
    await setProgress(user.id, card.id, {
      box: 5,
      dueDaysAgo: options.dueDaysAgo ?? -30,
      box5DaysAgo: options.masteredDaysAgo + 30,
      masteredDaysAgo: options.masteredDaysAgo,
    })
    return card
  }

  async function props(client: any, user: User, url = '/revision') {
    const response = await client.get(url).loginAs(user).withInertia()
    response.assertStatus(200)
    return response.inertiaProps as Record<string, any>
  }

  test('l’écran de choix porte l’inventaire, daté et compté', async ({ client, assert }) => {
    const user = await reviewer()
    await masteredCard(user, 'Acquise ce mois-ci', { masteredDaysAgo: 2 })
    await masteredCard(user, 'Acquise il y a longtemps', { masteredDaysAgo: 200 })
    // Une carte en cours : elle ne doit pas entrer dans l'inventaire.
    const inProgress = await makeCard('En cours')
    await setProgress(user.id, inProgress.id, { box: 3 })

    const { mastery } = await props(client, user)

    assert.equal(mastery.total, 2)
    assert.lengthOf(mastery.cards, 2)
    // La plus récemment acquise d'abord — c'est l'ordre de l'inventaire.
    assert.equal(mastery.cards[0].front, 'Acquise ce mois-ci')
    // ⚠️ « dont N ce mois-ci » : le chiffre qui fait la différence entre un compteur et un
    // inventaire d'acquis. Il vaut 1 ici, jamais 2.
    assert.equal(mastery.thisMonth, 1)
    assert.equal(mastery.cards[0].path, 'Non classées')
  })

  test('la 6ᵉ case compte les acquis, que la boîte 5 ne compte plus', async ({
    client,
    assert,
  }) => {
    const user = await reviewer()
    await masteredCard(user, 'Acquise', { masteredDaysAgo: 10 })
    const stillLearning = await makeCard('Encore en boîte 5')
    await setProgress(user.id, stillLearning.id, { box: 5, box5DaysAgo: 3 })

    const { boxCounts, masteredCount } = await props(client, user)

    assert.equal(masteredCount, 1)
    // ⚠️ **Les deux compteurs sont disjoints par construction** (CC-261) : la carte acquise
    // a quitté la boîte 5, elle ne peut pas être comptée deux fois. Sans la 6ᵉ case, elle
    // disparaissait simplement de l'écran.
    assert.equal(boxCounts[5], 1)
  })

  test('l’entretien est signalé sur /revision, avec sa prochaine échéance', async ({
    client,
    assert,
  }) => {
    const user = await reviewer()
    await masteredCard(user, 'À vérifier', { masteredDaysAgo: 120, dueDaysAgo: 1 })
    await masteredCard(user, 'Pas encore', { masteredDaysAgo: 10, dueDaysAgo: -60 })

    const { mastery } = await props(client, user)

    assert.equal(mastery.maintenanceDue, 1)
    // ⚠️ Elle est annoncée même quand rien n'est dû : un panneau qui disparaîtrait à zéro
    // laisserait croire que l'entretien n'existe pas — le reproche que CC-261 se faisait.
    assert.isNotNull(mastery.nextMaintenanceAt)
  })

  test('`?queue=maintenance` ouvre une SESSION sur la file d’entretien', async ({
    client,
    assert,
  }) => {
    const user = await reviewer()
    await masteredCard(user, 'Entretien dû', { masteredDaysAgo: 120, dueDaysAgo: 1 })
    const normal = await makeCard('File normale')
    await setProgress(user.id, normal.id, { box: 2 })

    const page = await props(client, user, '/revision?queue=maintenance')

    // ⚠️ **Le mode d'échec silencieux du lot** : si `queue` ne comptait pas dans `asked`,
    // on obtiendrait ici l'écran de choix — sans erreur, sans log, avec un bouton qui
    // « ne fait rien ».
    assert.equal(page.view, 'session')
    assert.equal(page.queue, 'maintenance')
    assert.deepEqual(
      page.dueCards.map((card: { front: string }) => card.front),
      ['Entretien dû']
    )
    assert.isTrue(page.dueCards[0].mastered)
  })

  /**
   * CC-265 — **les deux mondes, par les props réelles**. L'unitaire prouve que
   * `gradeOutcomes` sait rendre deux sorties ; celui-ci prouve que c'est bien ce que
   * l'écran reçoit, sur les deux files, avec le contrôleur et la base dans la boucle.
   */
  test('l’entretien ne propose que DEUX réponses ; la file normale en garde QUATRE', async ({
    client,
    assert,
  }) => {
    const user = await reviewer()
    const acquise = await masteredCard(user, 'Entretien dû', {
      masteredDaysAgo: 120,
      dueDaysAgo: 1,
    })
    const normal = await makeCard('En cours')
    await setProgress(user.id, normal.id, { box: 5 })

    // ⚠️ La visite d'entretien précédente a été notée « Difficile » : c'est le SEUL état
    // qui armait l'exception cachée (2ᵉ `hard` d'affilée ⇒ boîte 1 **et** perte de
    // l'acquis), et il est parfaitement invisible à l'écran — 90 à 365 jours plus tard,
    // personne ne se souvient de sa note précédente.
    await LeitnerReview.create({
      userId: user.id,
      leitnerCardId: acquise.id,
      grade: 'hard',
      kind: 'maintenance',
      reviewedAt: DateTime.now().minus({ days: 10 }),
    })

    const entretien = await props(client, user, '/revision?queue=maintenance')
    assert.deepEqual(
      entretien.dueCards[0].outcomes.map((o: { grade: string }) => o.grade),
      ['again', 'good'],
      'un entretien VÉRIFIE : il n’y a aucune boîte à gagner, donc rien à nuancer en quatre'
    )
    // Et le piège a disparu de l'écran, alors même que son état d'armement est là.
    assert.equal(await new LeitnerService().lastGrade(user.id, acquise), 'hard')

    const normale = await props(client, user, '/revision?scope=all')
    assert.deepEqual(
      normale.dueCards[0].outcomes.map((o: { grade: string }) => o.grade),
      ['again', 'hard', 'good', 'easy'],
      'là, les quatre notes produisent bien quatre effets distincts'
    )
  })

  test('les deux files sont disjointes : la normale ignore les acquis', async ({
    client,
    assert,
  }) => {
    const user = await reviewer()
    await masteredCard(user, 'Acquise', { masteredDaysAgo: 120, dueDaysAgo: 1 })
    const normal = await makeCard('En cours')
    await setProgress(user.id, normal.id, { box: 2 })

    const page = await props(client, user, '/revision?scope=all')

    assert.deepEqual(
      page.dueCards.map((card: { front: string }) => card.front),
      ['En cours']
    )
    assert.isFalse(page.dueCards[0].mastered)
  })

  test('noter en entretien CONSERVE la file d’entretien', async ({ client, assert }) => {
    const user = await reviewer()
    const card = await masteredCard(user, 'Entretien dû', { masteredDaysAgo: 120, dueDaysAgo: 1 })

    const response = await client
      .post(`/revision/${card.id}/review`)
      .json({ grade: 'good' })
      .header('referer', '/revision?queue=maintenance')
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    // ⚠️ `back()` renvoie sur le seul `pathname` du referer : sans `withQs()`, la session
    // d'entretien retomberait sur la file normale **à la première note**, en affichant des
    // cartes parfaitement plausibles. Même piège que `?theme=`, même garde.
    response.assertStatus(302)
    assert.include(response.headers().location, 'queue=maintenance')
  })

  test('la note d’entretien programme le palier, pas l’intervalle de la boîte 5', async ({
    client,
    assert,
  }) => {
    const user = await reviewer()
    const card = await masteredCard(user, 'Entretien dû', { masteredDaysAgo: 120, dueDaysAgo: 1 })

    // Ce que l'écran annonce sous le bouton…
    const page = await props(client, user, '/revision?queue=maintenance')
    const promised = page.dueCards[0].outcomes.find((o: { grade: string }) => o.grade === 'good')

    await client
      .post(`/revision/${card.id}/review`)
      .json({ grade: 'good' })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    // … est exactement ce que la base programme. ⚠️ C'est le seul test qui compare les
    // deux : une divergence donnerait un écran qui promet 90 jours pendant qu'on en
    // programme 30, et rien ne le signalerait avant l'échéance suivante.
    const progress = await LeitnerCardProgress.query()
      .where('user_id', user.id)
      .where('leitner_card_id', card.id)
      .firstOrFail()
    assert.equal(promised.days, 90)
    assert.equal(
      progress.nextReview.toISODate(),
      DateTime.now().plus({ days: promised.days }).toISODate()
    )
  })

  test('un `again` en entretien sort la carte des acquis et la compte comme perdue', async ({
    client,
    assert,
  }) => {
    const user = await reviewer()
    const card = await masteredCard(user, 'Oubliée', { masteredDaysAgo: 120, dueDaysAgo: 1 })

    await client
      .post(`/revision/${card.id}/review`)
      .json({ grade: 'again' })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    const { mastery } = await props(client, user)
    assert.equal(mastery.total, 0)
    // ⚠️ Le chiffre qui rend l'inventaire crédible plutôt qu'auto-congratulant. Il vient de
    // l'historique (`kind`), pas de l'état courant.
    assert.equal(mastery.lostThisYear, 1)
    // Et la carte est bien revenue dans la file normale, en boîte 5.
    const page = await props(client, user, '/revision?scope=all')
    assert.deepEqual(
      page.dueCards.map((c: { front: string }) => c.front),
      ['Oubliée']
    )
  })

  test('« perdue » compte des CARTES, pas des accidents', async ({ client, assert }) => {
    const user = await reviewer()
    const card = await masteredCard(user, 'Oubliée deux fois', { masteredDaysAgo: 120 })

    // Deux pertes sur la même carte dans l'année : une carte perdue, pas deux.
    for (const rang of [1, 2]) {
      await LeitnerReview.create({
        userId: user.id,
        leitnerCardId: card.id,
        grade: 'again',
        kind: 'maintenance',
        boxBefore: 5,
        boxAfter: 5,
        reviewedAt: DateTime.now().minus({ days: 10 * rang }),
      })
    }

    const { mastery } = await props(client, user)
    assert.equal(mastery.lostThisYear, 1)
  })

  test('le catalogue MARQUE les acquis sans les filtrer, même en « boîte 5 »', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['leitner.view'])
    await masteredCard(user, 'Acquise', { masteredDaysAgo: 40 })

    const response = await client.get('/revision/settings?box=5').loginAs(user).withInertia()
    response.assertStatus(200)
    const cards = (response.inertiaProps as Record<string, any>).cards

    // ⚠️ **Décidé, pas oublié** : la tuile « boîte 5 » de `/revision` annonce 0 pendant que
    // ce filtre-ci la liste. Le catalogue est un inventaire de **contenu** et l'écran qui
    // sert à corriger une carte : l'y faire disparaître la rendrait inatteignable.
    assert.lengthOf(cards, 1)
    assert.equal(cards[0].box, 5)
    assert.isNotNull(cards[0].masteredAt)
  })

  test('l’onglet Stats porte l’acquis comme mesure', async ({ client, assert }) => {
    const user = await reviewer()
    await masteredCard(user, 'Acquise', { masteredDaysAgo: 3 })
    const other = await makeCard('En cours')
    await setProgress(user.id, other.id, { box: 1 })

    const response = await client.get('/revision/stats').loginAs(user).withInertia()
    response.assertStatus(200)
    const { mastery } = response.inertiaProps as Record<string, any>

    assert.equal(mastery.total, 1)
    assert.equal(mastery.thisMonth, 1)
    assert.equal(mastery.lostThisYear, 0)
    // Une carte acquise sur deux visibles.
    assert.equal(mastery.share, 50)
  })

  test('l’inventaire d’un compte ne fuite pas chez un autre', async ({ client, assert }) => {
    const mine = await reviewer()
    const theirs = await reviewer()

    // Une carte **privée** chez l'autre compte, qu'il a acquise.
    const privateCard = await makeCard('Privée chez eux', { ownerId: theirs.id, isShared: false })
    await setProgress(theirs.id, privateCard.id, {
      box: 5,
      dueDaysAgo: -30,
      box5DaysAgo: 90,
      masteredDaysAgo: 60,
    })
    // Une carte partagée, acquise par l'autre compte seulement : le contenu est visible,
    // la progression ne l'est pas.
    const shared = await makeCard('Partagée')
    await setProgress(theirs.id, shared.id, {
      box: 5,
      dueDaysAgo: -30,
      box5DaysAgo: 90,
      masteredDaysAgo: 60,
    })

    const { mastery } = await props(client, mine)

    // ⚠️ Deux cloisons à la fois : la **visibilité** (CC-139) écarte la carte privée, et le
    // `user_id` de la progression (CC-119) écarte l'acquis de l'autre sur la carte
    // partagée. Retirer l'une des deux laisse ce test rouge.
    assert.equal(mastery.total, 0)
    assert.lengthOf(mastery.cards, 0)
  })

  test('sans acquis, l’écran de choix ne ment pas : tout est à zéro', async ({
    client,
    assert,
  }) => {
    const user = await reviewer()
    const card = await makeCard('En cours')
    await setProgress(user.id, card.id, { box: 1 })

    const { mastery, masteredCount } = await props(client, user)

    assert.equal(mastery.total, 0)
    assert.equal(mastery.maintenanceDue, 0)
    assert.isNull(mastery.nextMaintenanceAt)
    assert.equal(masteredCount, 0)
  })
})
