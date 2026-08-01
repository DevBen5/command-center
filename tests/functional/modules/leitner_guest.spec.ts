import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import type User from '#core/auth/models/user'
import { createAdmin, createUserWith } from '#tests/helpers/users'
import { boxOf, makeCard, nextReviewOf, setProgress } from '#tests/helpers/leitner'
import LeitnerCardProgress from '#modules/leitner/models/leitner_card_progress'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'
import LlmClient, { LlmUnavailableError } from '#modules/leitner/services/llm_client'
import FakeLlmClient from '#tests/fakes/fake_llm_client'

/**
 * CC-121 — le rôle invité révise, de bout en bout.
 *
 * ⚠️ **Ce fichier n'existe que pour ce que les autres ne disent pas.** Toute la suite du
 * module tourne déjà sous des comptes non-admin porteurs de `leitner.review`
 * (`leitner_review.spec.ts`, `leitner_scope.spec.ts`) : « un invité peut noter une carte »
 * y est vrai par construction. Ce qu'aucun d'eux ne fait, c'est **plus d'un tour de
 * boucle** — ils notent une carte et s'arrêtent.
 *
 * Or c'est exactement là que vivait le symptôme rapatrié de CC-81 : l'écran de révision
 * est **sans état**, `currentCard` vaut `dueCards[0]`, et la file n'avance **que** par la
 * note (`POST /:id/review` → redirection → re-requête). CC-119 a rendu la file personnelle,
 * donc non vide pour un invité, mais tant que `leitner.review` restait fermée il n'existait
 * **aucun mécanisme d'avancement** : l'invité voyait la carte 1, la retournait, et restait
 * dessus. Le vérifier est la raison d'être de ce ticket.
 *
 * ⚠️ **Chaque tour navigue vers `response.headers().location`, jamais vers une URL écrite
 * ici.** C'est ce qui distingue ce test d'une suite d'appels : il déroule la session par ce
 * que le serveur renvoie, donc il éprouve le `withQs()` (le piège n° 1 du module) à
 * *chaque* note plutôt qu'une fois, et il rougirait si la redirection cessait de ramener
 * dans le paquet.
 */
test.group('Leitner / le rôle invité révise (CC-121)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  /**
   * Le rôle invité **exact** de CC-121 : lecture, stats, révision. Ni `cards.write`, ni
   * `settings`, ni `backup` — ce que ce profil ne peut toujours pas faire est le sujet de
   * `leitner_readonly.spec.ts`, et les deux fichiers doivent porter la même liste.
   */
  function guest() {
    return createUserWith(['leitner.view', 'leitner.stats.view', 'leitner.review'])
  }

  async function theme() {
    const devops = await LeitnerCategory.create({ name: 'DevOps' })
    return LeitnerTheme.create({ leitnerCategoryId: devops.id, name: 'Docker' })
  }

  async function props(client: any, user: User, url: string) {
    const response = await client.get(url).loginAs(user).withInertia()
    response.assertStatus(200)
    return response.inertiaProps as Record<string, any>
  }

  function grade(client: any, user: User, cardId: number, note: string, referer: string) {
    return client
      .post(`/revision/${cardId}/review`)
      .json({ grade: note })
      .header('referer', referer)
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)
  }

  test('un invité déroule une session entière, du choix du paquet à la file vide', async ({
    client,
    assert,
  }) => {
    const owner = await createAdmin()
    const invite = await guest()
    const docker = await theme()

    const premiere = await makeCard('Première', { themeId: docker.id })
    await makeCard('Deuxième', { themeId: docker.id })
    await makeCard('Troisième', { themeId: docker.id })

    // Le propriétaire a déjà travaillé ces cartes : c'est SA progression qu'on protège,
    // et c'est le cas réel du ticket — un admin propriétaire, un collègue invité.
    await setProgress(owner.id, premiere.id, { box: 4, dueDaysAgo: -10 })
    const dueAvant = (await nextReviewOf(owner.id, premiere.id))!.toISODate()

    /*
    | 1. L'écran de choix. Il annonce des cartes **dues**, donc trois : l'invité n'a
    | aucune progression, et l'absence de ligne vaut « boîte 1, due aujourd'hui ».
    | Sans cette assertion, une file vide dès le départ ferait sortir la boucle au
    | premier tour et ce test passerait au vert sans avoir rien déroulé.
    */
    const choix = await props(client, invite, '/revision')
    assert.equal(choix.view, 'choice')
    const propose = choix.choices.categories[0].themes[0]
    assert.equal(propose.name, 'Docker')
    assert.strictEqual(propose.dueCount, 3)

    /*
    | 2. La session, tour par tour. On note la carte en tête, on suit la redirection, on
    | recharge — c'est exactement ce que fait le navigateur, et le seul enchaînement qui
    | puisse montrer que la file avance.
    */
    let url = `/revision?theme=${propose.id}`
    const vues: string[] = []
    let finished: boolean | null = null

    // ⚠️ Bornée, et l'échec est explicite : le mode d'échec qu'on éprouve ici est
    // précisément une session qui ne progresse pas. Un `while` nu pendrait au lieu de
    // rougir, et personne ne saurait pourquoi.
    for (let tour = 0; tour < 10; tour++) {
      const page = await props(client, invite, url)

      // ⚠️ Lu **avant** `dueCards`, et pour une seule raison : c'est la ligne qui rougit
      // lisiblement si le `withQs()` de `review()` disparaît. La redirection ramènerait
      // alors sur `/revision` nu — l'écran de choix, qui n'a pas de `dueCards` du tout —
      // et le test échouerait sur un accès à `undefined` au lieu de nommer la régression.
      assert.equal(page.view, 'session')

      if (page.dueCards.length === 0) {
        finished = page.scope.finished
        break
      }

      const carte = page.dueCards[0]
      vues.push(carte.front)

      // Le premier tour est un échec assumé : `again` laisse la carte due le jour même,
      // donc la session ne peut pas se terminer sur un compteur — elle se termine sur une
      // file vide, la carte ratée comprise.
      const response = await grade(client, invite, carte.id, tour === 0 ? 'again' : 'good', url)
      response.assertStatus(302)
      url = response.headers().location
    }

    // Quatre présentations pour trois cartes : « Première » ratée revient en fin de file,
    // jamais en tête — sans quoi elle se re-présenterait en boucle et la session serait
    // bloquée, l'écran mort de CC-81 sous une autre forme.
    assert.deepEqual(vues, ['Première', 'Deuxième', 'Troisième', 'Première'])
    // `true`, pas `false` : la file est vide **et** l'invité a travaillé ce paquet
    // aujourd'hui. « Terminé, bravo » et « rien à réviser » sont la même file vide.
    assert.isTrue(finished)

    /*
    | 3. Ce que sa session n'a pas fait. C'est l'invariant de CC-119 qui rendait sûr
    | d'ouvrir cette capacité — repris ici sur le couple réel du ticket.
    */
    assert.equal(await boxOf(owner.id, premiere.id), 4)
    assert.equal((await nextReviewOf(owner.id, premiere.id))!.toISODate(), dueAvant)
    // Et il a bien écrit, lui : trois lignes de progression, une par carte notée.
    assert.lengthOf(await LeitnerCardProgress.query().where('user_id', invite.id), 3)
  })

  test('ses stats sont les siennes, celles du propriétaire n’ont pas bougé', async ({
    client,
    assert,
  }) => {
    const owner = await createAdmin()
    const invite = await guest()
    const docker = await theme()
    const card = await makeCard('Partagée', { themeId: docker.id })

    await grade(client, invite, card.id, 'good', `/revision?theme=${docker.id}`)

    // ⚠️ L'assertion **positive** est la nouveauté : `leitner_multi_user.spec.ts` vérifie
    // qu'un observateur ne voit pas le travail d'un autre (des zéros partout), pas qu'une
    // session d'invité remonte vraiment jusqu'à son propre écran de stats. Un cloisonnement
    // qui rendrait zéro **des deux côtés** passerait ce test-là et échouerait celui-ci.
    const siennes = await props(client, invite, '/revision/stats')
    assert.strictEqual(siennes.habits.currentStreak, 1)

    const celles = await props(client, owner, '/revision/stats')
    assert.strictEqual(celles.habits.currentStreak, 0)
    assert.strictEqual(celles.habits.bestStreak, 0)
  })

  test('le juge suit la note : l’invité fait juger sa réponse écrite', async ({ client }) => {
    const invite = await guest()
    const card = await makeCard('Recto', { back: 'Verso' })

    // ⚠️ Le faux client **lève** : la réponse étant exactement le verso, le court-circuit
    // de `LeitnerJudgeService` tranche sans réseau. Un verdict `juste` prouve donc deux
    // choses d'un coup — que `POST /:id/judge` est bien ouvert sous `leitner.review`, et
    // qu'aucun appel n'est parti vers un LM Studio réellement allumé sur la machine
    // (`isLocalLlmUrl` borne le rayon, elle ne rend pas le test déterministe).
    app.container.swap(
      LlmClient,
      () =>
        new FakeLlmClient(() => {
          throw new LlmUnavailableError('Aucun appel ne doit partir sur un court-circuit.')
        })
    )

    try {
      const response = await client
        .post(`/revision/${card.id}/judge`)
        .json({ answer: 'Verso' })
        .loginAs(invite)
        .withCsrfToken()

      response.assertStatus(200)
      response.assertBodyContains({ verdict: 'juste', unavailable: false })
    } finally {
      app.container.restore(LlmClient)
    }
  })
})
