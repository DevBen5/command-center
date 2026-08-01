import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import type User from '#core/auth/models/user'
import { createAdmin, createUserWith } from '#tests/helpers/users'
import { boxOf, makeCard as createCard, nextReviewOf, setProgress } from '#tests/helpers/leitner'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import LeitnerSettings from '#modules/leitner/models/leitner_settings'
import LeitnerIngestion from '#modules/leitner/models/leitner_ingestion'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'

/**
 * Ce que les capacités du module **ferment**, éprouvé côté serveur.
 *
 * Ces tests sont TOUS côté serveur, et c'est le point : masquer un bouton n'est pas un
 * droit — une route est un contrat public, et un appel direct muni d'un cookie de session
 * valide n'a que faire du rendu Vue.
 *
 * ⚠️ **L'assertion qui compte n'est pas le code HTTP mais l'état de la base après le
 * refus.** Un 403 rendu après une écriture serait vert ici et catastrophique en vrai.
 *
 * ⚠️ **La justification d'origine (CC-72) est tombée par moitiés, et c'est la distinction
 * que ce fichier existe pour tenir.** Elle disait : « le module est mono-utilisateur, donc
 * `box`, `next_review` et la ligne unique de `leitner_settings` sont partagés ». Depuis
 * CC-119 la première moitié est fausse — la progression et l'historique portent un
 * `user_id`, une note n'atteint plus le planning de personne — et c'est précisément ce qui
 * a autorisé **CC-121** à accorder `leitner.review` au rôle invité. La seconde tient
 * toujours : `leitner_settings` est une ligne unique (`check('id = 1')`), un réglage
 * d'**installation** et non de personne.
 *
 * D'où les **deux** profils ci-dessous, et il faut les deux :
 *
 * - le **lecteur strict** de CC-72 (`leitner.view` + `leitner.stats.view`) prouve que la
 *   capacité `leitner.review` *ferme* encore. Sans ce groupe, plus rien ne le dirait — le
 *   profil courant la porte désormais, et une route dégardée passerait au vert ;
 * - l'**invité** de CC-121 (les deux précédentes + `leitner.review`) prouve que la
 *   révision n'ouvre **rien d'autre**. C'est le filet de ce lot.
 */

/** Le lecteur strict de CC-72 : il voit les cartes et les stats, il ne note pas. */
function strictReader() {
  return createUserWith(['leitner.view', 'leitner.stats.view'])
}

/** Le rôle invité de CC-121, dans son périmètre exact — cf. `leitner_guest.spec.ts`. */
function guest() {
  return createUserWith(['leitner.view', 'leitner.stats.view', 'leitner.review'])
}

/** Une carte, et la progression du **propriétaire** dessus — celle qu'on protège. */
async function makeOwnedCard(owner: User) {
  const card = await createCard('Recto')
  await setProgress(owner.id, card.id, { box: 3, dueDaysAgo: -5 })
  return card
}

test.group('Leitner / le lecteur strict ne révise pas (CC-72)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('noter une carte est refusé, et la carte ne bouge pas en base', async ({
    client,
    assert,
  }) => {
    const user = await strictReader()
    const owner = await createAdmin()
    const card = await makeOwnedCard(owner)
    const dueAvant = (await nextReviewOf(owner.id, card.id))!.toISODate()

    const response = await client
      .post(`/revision/${card.id}/review`)
      .json({ grade: 'easy' })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(403)

    // Depuis CC-119 la progression du propriétaire serait de toute façon hors d'atteinte :
    // ce que ce test verrouille désormais, c'est que la capacité **ferme encore** pour qui
    // ne la porte pas, et que le refus n'écrit **rien du tout** — pas même une ligne de
    // progression pour le lecteur.
    assert.equal(await boxOf(owner.id, card.id), 3)
    assert.equal((await nextReviewOf(owner.id, card.id))!.toISODate(), dueAvant)
    assert.isNull(await nextReviewOf(user.id, card.id))
  })

  test('faire juger une réponse est refusé aussi', async ({ client, assert }) => {
    const user = await strictReader()
    const card = await createCard('Recto')

    // Le juge suit la note, pas la lecture : il n'écrit rien mais fait travailler le LLM
    // local. Sous `leitner.review`, donc fermé au lecteur strict — et fermé en **JSON**,
    // cette route étant appelée en `fetch`.
    const response = await client
      .post(`/revision/${card.id}/judge`)
      .json({ answer: 'Une réponse quelconque.' })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(403)
    assert.property(response.body(), 'error')
  })
})

test.group('Leitner / ce que le rôle invité ne peut toujours pas faire (CC-121)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('un invité peut lister les cartes, le catalogue et les stats', async ({ client }) => {
    const user = await guest()

    // Les trois écrans en lecture : la file, le catalogue (`leitner.view`) et l'effort
    // (`leitner.stats.view`). Aucune n'écrit, toutes doivent répondre 200.
    for (const route of ['/revision', '/revision/settings', '/revision/stats']) {
      const response = await client.get(route).loginAs(user).withInertia()
      response.assertStatus(200)
    }
  })

  test('créer une carte est refusé, et rien n’est écrit', async ({ client, assert }) => {
    const user = await guest()
    const cartesAvant = await LeitnerCard.all()

    const response = await client
      .post('/revision/cards')
      .json({ front: 'Injectée', back: 'par un invité' })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(403)
    const cartesApres = await LeitnerCard.all()
    assert.equal(cartesApres.length, cartesAvant.length)
  })

  test('créer une catégorie ou un thème est refusé, et la taxonomie ne bouge pas', async ({
    client,
    assert,
  }) => {
    const user = await guest()
    const categorie = await LeitnerCategory.create({ name: 'DevOps' })

    // `leitner.taxonomy.write` est séparée de `cards.write` : deux gestes d'écriture
    // distincts, l'un sur le contenu, l'autre sur son classement. Les deux restent fermés,
    // et il faut le vérifier séparément — accorder l'un n'accorde pas l'autre.
    const surLaCategorie = await client
      .post('/revision/categories')
      .json({ name: 'Inventée' })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    const surLeTheme = await client
      .post('/revision/themes')
      .json({ leitnerCategoryId: categorie.id, name: 'Inventé' })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    surLaCategorie.assertStatus(403)
    surLeTheme.assertStatus(403)
    assert.lengthOf(await LeitnerCategory.all(), 1)
    assert.lengthOf(await LeitnerTheme.all(), 0)
  })

  test('régler les intervalles est refusé, et la ligne unique ne bouge pas', async ({
    client,
    assert,
  }) => {
    const user = await guest()
    const avant = await LeitnerSettings.findOrFail(1)
    const box1Avant = avant.box1Days

    const response = await client
      .put('/revision/settings/intervals')
      .json({ box1Days: 99, box2Days: 99, box3Days: 99, box4Days: 99, box5Days: 99 })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(403)

    // ⚠️ **Le refus qui survit à CC-121, et le seul de ce fichier dont la justification
    // d'origine tienne encore mot pour mot.** `leitner_settings` est partagée par toute
    // l'installation : les intervalles décrivent la **méthode** de répétition espacée, pas
    // la personne qui la suit. Un invité ne redéfinit pas l'espacement de tout le monde.
    const apres = await LeitnerSettings.findOrFail(1)
    assert.equal(apres.box1Days, box1Avant)
  })

  test('lancer une ingestion est refusé, et aucun travail n’est créé', async ({
    client,
    assert,
  }) => {
    const user = await guest()
    const travauxAvant = await LeitnerIngestion.all()

    const response = await client
      .post('/revision/ingest')
      .json({ text: 'Un cours de test, collé par quelqu’un qui n’en a pas le droit.' })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(403)
    const travauxApres = await LeitnerIngestion.all()
    assert.equal(travauxApres.length, travauxAvant.length)
  })

  test('l’écran de configuration du LLM est refusé, et la détection avec', async ({
    client,
    assert,
  }) => {
    const user = await guest()

    const ecran = await client.get('/revision/llm').loginAs(user).redirects(0)
    const detection = await client
      .post('/revision/llm/detect')
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    ecran.assertStatus(403)
    detection.assertStatus(403)
    // ⚠️ Aucun état à vérifier ici, et c'est assumé : ces routes n'écrivent rien, ni en
    // base ni sur le disque. Ce qu'elles font, c'est faire **émettre au serveur** des
    // requêtes vers une URL saisie — la surface la plus proche d'une SSRF du dépôt. Le
    // refus est donc tout ce qu'il y a à observer.
    assert.property(detection.body(), 'error')
  })

  test('exporter la base est refusé, et l’importer aussi', async ({ client, assert }) => {
    const user = await guest()
    const cartesAvant = await LeitnerCard.all()

    const sortie = await client.get('/revision/export').loginAs(user).redirects(0)
    const entree = await client
      .post('/revision/import')
      .json({ cards: [{ front: 'Injectée par import', back: 'sans en avoir le droit' }] })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    sortie.assertStatus(403)
    entree.assertStatus(403)

    // ⚠️ **L'import est la vraie raison de garder cette capacité fermée**, et elle ne se
    // devine pas : `leitner.backup` porte l'export *et* l'import, or l'import **crée des
    // cartes et de la taxonomie**. L'accorder contournerait `leitner.cards.write` et
    // `leitner.taxonomy.write` d'un seul geste. Côté export, la crainte d'origine est
    // levée depuis CC-119 — le fichier ne rend que la progression et les réponses écrites
    // de celui qui exporte (`LeitnerBackupService.export`, `preload` filtré sur
    // `user_id`) — mais il emporte tout le **contenu communal** : voir les cartes n'est
    // pas repartir avec la base.
    assert.lengthOf(await LeitnerCard.all(), cartesAvant.length)
  })

  test('un refus sur une route JSON est un 403 JSON, pas une redirection', async ({
    client,
    assert,
  }) => {
    const user = await guest()

    // Les routes JSON nues (extraction, juge, diagnostic LLM) sont appelées en `fetch` :
    // un refus qui redirigerait casserait la page au lieu de dire non. Le middleware de
    // capacité rend un 403 avec corps JSON, uniformément — c'est vérifié ici.
    const response = await client
      .post('/revision/ingest/extract')
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(403)
    assert.property(response.body(), 'error')
  })
})
