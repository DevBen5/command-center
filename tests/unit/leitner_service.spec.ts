import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import testUtils from '@adonisjs/core/services/test_utils'
import LeitnerReview from '#modules/leitner/models/leitner_review'
import LeitnerService from '#modules/leitner/services/leitner_service'
import type LeitnerCard from '#modules/leitner/models/leitner_card'
import type User from '#core/auth/models/user'
import { makeCard, setProgress } from '#tests/helpers/leitner'
import { createAdmin } from '#tests/helpers/users'

// Les intervalles par défaut (1 · 2 · 4 · 7 · 30) sont posés par la migration et
// dupliqués ici à dessein : un test qui importerait DEFAULT_BOX_INTERVAL_DAYS
// n'asserterait plus rien.
const TODAY = () => DateTime.now().toISODate()
const IN = (days: number) => DateTime.now().plus({ days }).toISODate()

/**
 * Une carte déjà placée en boîte `box` **pour cette personne**. Depuis CC-119 la boîte
 * n'est plus une propriété de la carte : il faut dire pour qui, sans quoi la question
 * n'a pas de réponse.
 */
async function cardInBox(user: User, box: number): Promise<LeitnerCard> {
  const card = await makeCard('Question de test', { back: 'Réponse de test' })
  await setProgress(user.id, card.id, { box })
  return card
}

test.group('LeitnerService / révision', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('`again` laisse la carte dans sa boîte et la laisse due aujourd’hui', async ({ assert }) => {
    const user = await createAdmin()
    const card = await cardInBox(user, 4)

    const progress = await new LeitnerService().review(user.id, card, 'again')

    // `again` ne rétrograde pas : il remet la carte dans la session, c'est tout.
    assert.equal(progress.box, 4)
    // Due le jour même : la carte reste dans la file et revient dans la session.
    assert.equal(progress.nextReview.toISODate(), TODAY())
  })

  test('`again` répété ne fait jamais descendre la carte', async ({ assert }) => {
    const user = await createAdmin()
    const card = await cardInBox(user, 5)
    const service = new LeitnerService()

    await service.review(user.id, card, 'again')
    await service.review(user.id, card, 'again')
    const progress = await service.review(user.id, card, 'again')

    assert.equal(progress.box, 5)
    assert.equal(progress.nextReview.toISODate(), TODAY())
  })

  test('`hard` laisse la carte dans sa boîte, à l’intervalle de cette boîte', async ({
    assert,
  }) => {
    const user = await createAdmin()
    const card = await cardInBox(user, 3)

    const progress = await new LeitnerService().review(user.id, card, 'hard')

    assert.equal(progress.box, 3)
    // Boîte 3 = 4 jours. La carte stagne, mais quitte la session du jour.
    assert.equal(progress.nextReview.toISODate(), IN(4))
  })

  test('deux `hard` d’affilée renvoient la carte en boîte 1, due le lendemain', async ({
    assert,
  }) => {
    const user = await createAdmin()
    const service = new LeitnerService()
    const card = await cardInBox(user, 3)

    const premier = await service.review(user.id, card, 'hard')
    assert.equal(premier.box, 3)

    const progress = await service.review(user.id, card, 'hard')

    assert.equal(progress.box, 1)
    // Boîte 1 = 1 jour : sanctionnée, mais pas ratée — elle ne revient pas dans la session.
    assert.equal(progress.nextReview.toISODate(), IN(1))
  })

  test('la règle du 2ᵉ `hard` ne traverse JAMAIS deux comptes', async ({ assert }) => {
    // ⚠️ **Le test qui prouve que le cloisonnement de l'historique n'était pas séparable
    // de celui de la progression** (CC-119). `lastGrade` lu sans filtre, le `hard` d'un
    // collègue arme la rétrogradation d'un autre : sa carte tomberait en boîte 1 sur un
    // premier `hard`, sans erreur, sans log — juste une progression détruite.
    const mine = await createAdmin()
    const theirs = await createAdmin()
    const service = new LeitnerService()

    const card = await makeCard('Partagée')
    await setProgress(mine.id, card.id, { box: 3 })
    await setProgress(theirs.id, card.id, { box: 3 })

    await service.review(theirs.id, card, 'hard')
    const progress = await service.review(mine.id, card, 'hard')

    // Un seul `hard` du côté de `mine` : la carte stagne, elle ne rétrograde pas.
    assert.equal(progress.box, 3)
  })

  test('un `hard` isolé ne rétrograde pas : seule la note précédente compte', async ({
    assert,
  }) => {
    const user = await createAdmin()
    const service = new LeitnerService()
    const card = await cardInBox(user, 3)

    await service.review(user.id, card, 'hard')
    await service.review(user.id, card, 'good')
    const progress = await service.review(user.id, card, 'hard')

    // hard → good → hard : les deux `hard` ne sont pas consécutifs, pas de rétrogradation.
    assert.equal(progress.box, 4)
    assert.equal(progress.nextReview.toISODate(), IN(7))
  })

  test('`good` fait monter la carte d’une boîte', async ({ assert }) => {
    const user = await createAdmin()
    const card = await cardInBox(user, 2)

    const progress = await new LeitnerService().review(user.id, card, 'good')

    assert.equal(progress.box, 3)
    // Boîte 3 = 4 jours.
    assert.equal(progress.nextReview.toISODate(), IN(4))
  })

  test('`easy` fait monter la carte de deux boîtes', async ({ assert }) => {
    const user = await createAdmin()
    const card = await cardInBox(user, 2)

    const progress = await new LeitnerService().review(user.id, card, 'easy')

    assert.equal(progress.box, 4)
    // Boîte 4 = 7 jours.
    assert.equal(progress.nextReview.toISODate(), IN(7))
  })

  test('la boîte est plafonnée à 5', async ({ assert }) => {
    const user = await createAdmin()
    const card = await cardInBox(user, 4)

    const progress = await new LeitnerService().review(user.id, card, 'easy')

    assert.equal(progress.box, 5)
    // Boîte 5 = révision mensuelle.
    assert.equal(progress.nextReview.toISODate(), IN(30))
  })

  test('une carte jamais notée démarre en boîte 1, sans ligne préalable', async ({ assert }) => {
    // L'absence de progression *est* « boîte 1, due aujourd'hui » : la première note la
    // matérialise, elle ne la trouve pas. Une lecture qui exigerait la ligne planterait
    // sur la toute première révision de chaque carte.
    const user = await createAdmin()
    const card = await makeCard('Jamais notée')

    const progress = await new LeitnerService().review(user.id, card, 'good')

    assert.equal(progress.box, 2)
    assert.equal(progress.nextReview.toISODate(), IN(2))
  })

  test('chaque révision est historisée avec sa note ET son auteur', async ({ assert }) => {
    const user = await createAdmin()
    const card = await cardInBox(user, 1)

    await new LeitnerService().review(user.id, card, 'hard')

    const reviews = await LeitnerReview.query().where('leitner_card_id', card.id)
    assert.lengthOf(reviews, 1)
    assert.equal(reviews[0].grade, 'hard')
    assert.equal(reviews[0].userId, user.id)
  })

  test('les stats comptent les révisions du jour, celles du compte seulement', async ({
    assert,
  }) => {
    const mine = await createAdmin()
    const theirs = await createAdmin()
    const service = new LeitnerService()
    const card = await cardInBox(mine, 1)

    await service.review(mine.id, card, 'good')
    await service.review(theirs.id, card, 'good')

    assert.equal(await service.reviewedToday(mine.id), 1)
    assert.equal(await service.streakDays(mine.id), 1)
  })

  test('noter ne déplace AUCUNE progression d’un autre compte', async ({ assert }) => {
    // ⚠️ **Le test qui compte du lot.** C'est l'invariant qui rend sûr d'accorder la note
    // à un collègue (CC-121) : sa révision n'atteint ni ma boîte, ni mon échéance.
    const mine = await createAdmin()
    const theirs = await createAdmin()
    const service = new LeitnerService()

    const card = await makeCard('Partagée')
    await setProgress(mine.id, card.id, { box: 2, dueDaysAgo: 1 })

    await service.review(theirs.id, card, 'easy')

    const untouched = await service.boxCounts(mine.id)
    assert.deepEqual(untouched, { 1: 0, 2: 1, 3: 0, 4: 0, 5: 0 })
    // Et la carte, elle, n'a pas bougé non plus : c'est du contenu communal.
    assert.lengthOf(await service.dueCards(mine.id), 1)
  })
})

/**
 * Les **marques de maîtrise** au site d'écriture (CC-260) — ce que le test pur de
 * `leitner_mastery.spec.ts` ne peut pas dire : que le critère est réellement branché, sur
 * l'état lu **avant** la note et sur l'intervalle lu **en base**.
 */
test.group('LeitnerService / marques de maîtrise', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  /** La dernière révision enregistrée pour cette personne sur cette carte. */
  async function lastReview(userId: number, cardId: number): Promise<LeitnerReview> {
    return LeitnerReview.query()
      .where('user_id', userId)
      .where('leitner_card_id', cardId)
      .orderBy('id', 'desc')
      .firstOrFail()
  }

  test('la première note d’une carte jamais révisée est `normal`', async ({ assert }) => {
    // ⚠️ **Le piège de l'`undefined`.** `firstOrNew` rend un modèle neuf dont `masteredAt`
    // vaut `undefined`, pas `null` : un `!== null` posé directement dessus classerait
    // **toute première note** en `'maintenance'`, sans erreur ni log. Ce test est le seul
    // qui l'attrape.
    const user = await createAdmin()
    const card = await makeCard('Jamais notée')

    await new LeitnerService().review(user.id, card, 'good')

    const review = await lastReview(user.id, card.id)
    assert.equal(review.kind, 'normal')
  })

  test('`box_before` et `box_after` encadrent réellement le mouvement', async ({ assert }) => {
    const user = await createAdmin()
    const card = await cardInBox(user, 2)

    await new LeitnerService().review(user.id, card, 'good')

    const review = await lastReview(user.id, card.id)
    // ⚠️ `box_before` est lu **avant** `nextBox` : écrit après, il vaudrait 3 des deux
    // côtés et la paire ne dirait plus aucun mouvement.
    assert.equal(review.boxBefore, 2)
    assert.equal(review.boxAfter, 3)
  })

  test('entrer en boîte 5 démarre l’horloge sans maîtriser la carte', async ({ assert }) => {
    const user = await createAdmin()
    const card = await cardInBox(user, 4)

    const progress = await new LeitnerService().review(user.id, card, 'good')

    assert.equal(progress.box, 5)
    assert.isNotNull(progress.box5EnteredAt)
    assert.isNull(progress.masteredAt)
  })

  test('une carte en boîte 5 depuis 40 jours notée `good` devient maîtrisée', async ({
    assert,
  }) => {
    const user = await createAdmin()
    const card = await makeCard('Tenue depuis longtemps')
    await setProgress(user.id, card.id, { box: 5, box5DaysAgo: 40 })

    const progress = await new LeitnerService().review(user.id, card, 'good')

    assert.isNotNull(progress.masteredAt)
    // La révision qui l'a acquise venait de la file **normale** : la carte n'était pas
    // encore maîtrisée au moment où on l'a notée.
    const review = await lastReview(user.id, card.id)
    assert.equal(review.kind, 'normal')
  })

  test('une révision RATÉE d’entretien est enregistrée `maintenance`, et démaîtrise', async ({
    assert,
  }) => {
    // ⚠️ **Le test qui porte le lot.** `kind` dit **de quelle file la carte venait**, pas
    // où elle finit : elle ressort non maîtrisée, et la ligne doit quand même dire
    // `maintenance`. Calculé après la mutation, l'historique affirmerait qu'aucun
    // entretien n'a jamais échoué — et rien ne le signalerait.
    const user = await createAdmin()
    const card = await makeCard('Acquise puis ratée')
    await setProgress(user.id, card.id, { box: 5, box5DaysAgo: 60, masteredDaysAgo: 20 })

    const progress = await new LeitnerService().review(user.id, card, 'again')

    const review = await lastReview(user.id, card.id)
    assert.equal(review.kind, 'maintenance')
    assert.equal(review.boxBefore, 5)
    // `again` ne rétrograde pas : elle sort de l'entretien sans quitter la boîte 5.
    assert.equal(review.boxAfter, 5)
    assert.isNull(progress.masteredAt)
  })

  test('le délai suit l’intervalle RÉGLÉ, lu en base et non la constante', async ({ assert }) => {
    // Ce que le test pur ne peut pas dire : que `boxIntervals()[5]` arrive bien jusqu'au
    // critère. À 365 jours, 40 jours en boîte 5 ne suffisent plus.
    const user = await createAdmin()
    const service = new LeitnerService()
    await service.updateBoxIntervals({ 1: 1, 2: 2, 3: 4, 4: 7, 5: 365 })

    const card = await makeCard('Réglage allongé')
    await setProgress(user.id, card.id, { box: 5, box5DaysAgo: 40 })

    const progress = await service.review(user.id, card, 'good')

    assert.isNull(progress.masteredAt)
  })

  test('le 2ᵉ `hard` d’affilée efface l’horloge ET l’acquis', async ({ assert }) => {
    const user = await createAdmin()
    const service = new LeitnerService()
    const card = await makeCard('Deux fois péniblement')
    await setProgress(user.id, card.id, { box: 5, box5DaysAgo: 90, masteredDaysAgo: 30 })

    await service.review(user.id, card, 'hard')
    const progress = await service.review(user.id, card, 'hard')

    assert.equal(progress.box, 1)
    assert.isNull(progress.box5EnteredAt)
    assert.isNull(progress.masteredAt)
  })
})

test.group('LeitnerService / intervalles des boîtes', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('les intervalles par défaut sont ceux posés par la migration', async ({ assert }) => {
    assert.deepEqual(await new LeitnerService().boxIntervals(), { 1: 1, 2: 2, 3: 4, 4: 7, 5: 30 })
  })

  test('la révision applique les intervalles réglés, pas les valeurs par défaut', async ({
    assert,
  }) => {
    const user = await createAdmin()
    const service = new LeitnerService()
    await service.updateBoxIntervals({ 1: 1, 2: 3, 3: 10, 4: 21, 5: 90 })

    const card = await cardInBox(user, 2)
    const progress = await service.review(user.id, card, 'good')

    assert.equal(progress.box, 3)
    // Boîte 3 réglée à 10 jours (4 par défaut).
    assert.equal(progress.nextReview.toISODate(), IN(10))
  })

  test('les intervalles restent un réglage d’INSTALLATION, partagé', async ({ assert }) => {
    // ⚠️ Décision de CC-119, à ne pas rouvrir sans y penser : les intervalles décrivent la
    // méthode, pas la personne. Une seule ligne (`check('id = 1')`), donc un réglage posé
    // par quelqu'un s'applique à tout le monde — c'est ce que ce test verrouille.
    const service = new LeitnerService()
    await service.updateBoxIntervals({ 1: 1, 2: 3, 3: 10, 4: 21, 5: 90 })

    assert.deepEqual(await new LeitnerService().boxIntervals(), {
      1: 1,
      2: 3,
      3: 10,
      4: 21,
      5: 90,
    })
  })

  test('`again` reste due le jour même quel que soit l’intervalle de sa boîte', async ({
    assert,
  }) => {
    const user = await createAdmin()
    const service = new LeitnerService()
    await service.updateBoxIntervals({ 1: 5, 2: 3, 3: 10, 4: 21, 5: 90 })

    const card = await cardInBox(user, 4)
    const progress = await service.review(user.id, card, 'again')

    assert.equal(progress.box, 4)
    // Aucun intervalle ne s'applique à `again` — surtout pas les 21 jours de sa
    // boîte : la carte revient dans la session en cours.
    assert.equal(progress.nextReview.toISODate(), TODAY())
  })

  test('le réglage ne recalcule pas les échéances déjà posées', async ({ assert }) => {
    const user = await createAdmin()
    const service = new LeitnerService()
    const card = await cardInBox(user, 2)
    const progress = await service.review(user.id, card, 'good')
    const scheduled = progress.nextReview.toISODate()

    await service.updateBoxIntervals({ 1: 1, 2: 2, 3: 60, 4: 7, 5: 30 })

    await progress.refresh()
    assert.equal(progress.nextReview.toISODate(), scheduled)
  })
})

/**
 * Le **régime d'entretien au site d'écriture** (CC-261) — ce que le test pur de
 * `leitner_maintenance.spec.ts` ne peut pas dire : que l'échelle est réellement branchée,
 * qu'elle est choisie par la file où la carte **va**, et que le rang se compte au bon
 * moment.
 */
test.group('LeitnerService / régime d’entretien', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  /** Une carte en boîte 5 depuis longtemps, **pas encore acquise**. */
  async function readyToMaster(user: User): Promise<LeitnerCard> {
    const card = await makeCard('Tenue depuis longtemps')
    await setProgress(user.id, card.id, { box: 5, box5DaysAgo: 40 })
    return card
  }

  test('la note qui ACQUIERT la maîtrise programme déjà le premier palier', async ({ assert }) => {
    // ⚠️ **Le test qui porte l'arbitrage du lot.** Cette note-là porte `kind: 'normal'`
    // (la carte venait bien de la file normale) et repart pourtant à 90 jours : l'échéance
    // suit la file où la carte **va**, jamais celle d'où elle vient. Gaté sur `kind`, on
    // lirait 30 ici — la carte serait « maîtrisée » et reviendrait au rythme d'avant, dans
    // une file que rien n'affiche encore.
    const user = await createAdmin()
    const card = await readyToMaster(user)

    const progress = await new LeitnerService().review(user.id, card, 'good')

    assert.isNotNull(progress.masteredAt)
    assert.equal(progress.nextReview.toISODate(), IN(90))
  })

  test('l’échelle gravit ses paliers note après note : 90, 180, 365, 365', async ({ assert }) => {
    // ⚠️ **Le test qui attrape une dérive du rang d'un cran** — et c'est le seul. Le rang
    // se compte AVANT l'insertion de la note courante (sinon elle se compterait
    // elle-même) et la note d'acquisition occupe le palier 0 (d'où le `>=` et non le `>` :
    // `mastered_at` et son `reviewed_at` sont deux `DateTime.now()` distincts).
    const user = await createAdmin()
    const card = await readyToMaster(user)
    const service = new LeitnerService()

    const acquisition = await service.review(user.id, card, 'good')
    assert.equal(acquisition.nextReview.toISODate(), IN(90))

    const premier = await service.review(user.id, card, 'good')
    assert.equal(premier.nextReview.toISODate(), IN(180))

    const deuxieme = await service.review(user.id, card, 'easy')
    assert.equal(deuxieme.nextReview.toISODate(), IN(365))

    // Le dernier palier se répète : au moins une vérification par an, indéfiniment.
    const troisieme = await service.review(user.id, card, 'good')
    assert.equal(troisieme.nextReview.toISODate(), IN(365))
  })

  test('la note d’entretien est bien historisée `maintenance`', async ({ assert }) => {
    const user = await createAdmin()
    const card = await readyToMaster(user)
    const service = new LeitnerService()

    await service.review(user.id, card, 'good')
    await service.review(user.id, card, 'good')

    const reviews = await LeitnerReview.query()
      .where('user_id', user.id)
      .where('leitner_card_id', card.id)
      .orderBy('id', 'asc')

    // La première venait de la file normale, la seconde de l'entretien.
    assert.deepEqual(
      reviews.map((review) => review.kind),
      ['normal', 'maintenance']
    )
  })

  test('l’intervalle réglé de la boîte 5 relève le plancher de l’entretien', async ({ assert }) => {
    // La seule chose qui prouve que `boxIntervals()[5]` arrive **en base** jusqu'à
    // l'échelle : à 365 j de réglage, le premier palier ne peut plus valoir 90.
    const user = await createAdmin()
    const service = new LeitnerService()
    await service.updateBoxIntervals({ 1: 1, 2: 2, 3: 4, 4: 7, 5: 365 })

    const card = await makeCard('Tenue depuis très longtemps')
    await setProgress(user.id, card.id, { box: 5, box5DaysAgo: 400 })

    const progress = await service.review(user.id, card, 'good')
    assert.isNotNull(progress.masteredAt)
    assert.equal(progress.nextReview.toISODate(), IN(365))
  })

  test('`again` en entretien démaîtrise, laisse la boîte à 5, et rend la carte aujourd’hui', async ({
    assert,
  }) => {
    // ⚠️ **La règle « `again` ne rétrograde JAMAIS » est intacte** : elle porte sur `box`,
    // et `box` ne bouge pas. Ce lot n'ajoute qu'un drapeau, dont la sémantique est
    // précisément d'être vérifiable — sans quoi « maîtrisée » serait un cul-de-sac que
    // plus rien ne contrôle.
    const user = await createAdmin()
    const card = await makeCard('Acquise puis oubliée')
    await setProgress(user.id, card.id, { box: 5, box5DaysAgo: 120, masteredDaysAgo: 90 })

    const progress = await new LeitnerService().review(user.id, card, 'again')

    assert.equal(progress.box, 5)
    assert.isNull(progress.masteredAt)
    assert.equal(progress.nextReview.toISODate(), TODAY())

    // Et elle est bien retombée dans la file normale, pas dans l'entretien.
    assert.lengthOf(await new LeitnerService().dueCards(user.id), 1)
    assert.isEmpty(await new LeitnerService().maintenanceCards(user.id))
  })

  test('le 2ᵉ `hard` d’affilée démaîtrise ET renvoie en boîte 1', async ({ assert }) => {
    // ⚠️ **Le seul endroit où les deux mécaniques se croisent.** Sans l'effacement, une
    // carte en **boîte 1** resterait « maîtrisée » : invisible de la file normale
    // (`whereDue` l'exclut) et présente dans l'entretien, donc perdue des deux côtés.
    const user = await createAdmin()
    const card = await makeCard('Acquise puis stagnante')
    await setProgress(user.id, card.id, { box: 5, box5DaysAgo: 120, masteredDaysAgo: 90 })
    const service = new LeitnerService()

    // Un premier `hard` : la carte reste acquise, et repart au palier d'entretien.
    const premier = await service.review(user.id, card, 'hard')
    assert.equal(premier.box, 5)
    assert.isNotNull(premier.masteredAt)

    const second = await service.review(user.id, card, 'hard')
    assert.equal(second.box, 1)
    assert.isNull(second.masteredAt)
    assert.isNull(second.box5EnteredAt)
    // L'intervalle est celui de sa nouvelle boîte, plus celui de l'entretien.
    assert.equal(second.nextReview.toISODate(), IN(1))
  })

  test('une carte ré-acquise repart au premier palier, jamais là où elle s’était arrêtée', async ({
    assert,
  }) => {
    // ⚠️ **Ce que la borne `reviewed_at >= mastered_at` achète.** `mastered_at` est
    // réécrit à chaque acquisition : les entretiens du cycle précédent tombent hors de la
    // fenêtre. Sans la borne, cette carte repartirait droit au palier d'un an alors qu'on
    // vient de constater qu'elle n'est plus sue.
    const user = await createAdmin()
    const card = await makeCard('Acquise, perdue, reprise')
    await setProgress(user.id, card.id, { box: 5, box5DaysAgo: 120, masteredDaysAgo: 90 })
    const service = new LeitnerService()

    // Deux entretiens réussis, puis l'oubli : la carte est démaîtrisée.
    await service.review(user.id, card, 'good')
    await service.review(user.id, card, 'good')
    await service.review(user.id, card, 'again')

    // L'horloge de boîte 5 a été réarmée par `again` : on la recule pour rendre la carte
    // ré-acquérable sans attendre trente jours.
    await setProgress(user.id, card.id, { box: 5, box5DaysAgo: 40 })

    const reacquise = await service.review(user.id, card, 'good')
    assert.isNotNull(reacquise.masteredAt)
    assert.equal(reacquise.nextReview.toISODate(), IN(90))
  })
})
