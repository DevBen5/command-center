import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { PREVIEW_MAX_CHARS } from '#modules/leitner/shared/card_preview'
import { makeCard } from '#tests/helpers/leitner'
import { createUserWith } from '#tests/helpers/users'

/**
 * L'aperçu du rendu Markdown pendant la saisie (CC-257) — **par les routes**.
 *
 * Le ticket est né du passage navigateur de CC-133 : une clôture ```` ``` ```` non refermée fait
 * basculer tout le reste de la carte dans un bloc de code — comportement CommonMark correct — et
 * ça ne se découvrait qu'en révision, des jours plus tard. Ce lot rend le comportement
 * **visible** ; il ne le change pas.
 *
 * ⚠️ **Ce que ce fichier doit prouver, et qu'aucun commentaire ne peut affirmer : l'aperçu et la
 * révision sortent de la MÊME fonction.** C'est le seul garde-fou contre la dérive que le ticket
 * redoute — un second rendu, côté client ou derrière une enveloppe, dont la sortie divergerait
 * sans que rien ne les compare. L'assertion est une **égalité stricte** entre le `frontHtml` que
 * `/revision` pose en prop et celui que la route d'aperçu rend : une option ajoutée d'un seul
 * côté la fait rougir, une couche d'assainissement retirée aussi.
 *
 * ⚠️ **Deux routes, et il en faut deux.** `middleware.can()` n'accepte qu'une capacité, et les
 * deux écrans concernés n'ont pas la même : `leitner.cards.write` pour la modale de saisie,
 * `leitner.ingest` pour la relecture des brouillons — laquelle laisse déjà créer des cartes par
 * `drafts/accept`, donc lui refuser l'aperçu serait arbitraire. Les droits sont donc éprouvés sur
 * **les deux**, dans les deux sens, sans quoi une route pourrait s'ouvrir pendant que l'autre
 * reste fermée.
 */
test.group('Leitner / aperçu du rendu Markdown', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  const CARDS_PREVIEW = '/revision/cards/preview'
  const DRAFTS_PREVIEW = '/revision/ingest/drafts/preview'

  /**
   * Le contrat exact de la page : `POST` + `x-xsrf-token` + **`accept: application/json`**.
   *
   * ⚠️ **Ce dernier en-tête n'est pas de la décoration de test, et l'oublier ment.** Sans lui,
   * AdonisJS traite un échec de validation comme le ferait un formulaire : `redirect().back()`
   * avec les erreurs flashées. Le client de test **suit** la redirection, retombe sur `/` — qui
   * exige `dashboard.view` — et le test lit un **403 « Accès refusé »** là où le serveur voulait
   * dire 422. Mesuré ici, sur le premier jet de ce fichier : on croit à un défaut de capacité et
   * on part corriger une route qui n'a rien. La page court le même risque, à ceci près qu'elle
   * lirait de l'HTML au lieu d'un message — d'où l'en-tête dans le `fetch` du composable.
   */
  function askPreview(client: any, route: string, body: object, user: unknown) {
    return client
      .post(route)
      .json(body)
      .header('accept', 'application/json')
      .loginAs(user)
      .withCsrfToken()
  }

  test("l'aperçu rend exactement ce que la révision rendra — la même fonction", async ({
    client,
    assert,
  }) => {
    // Le cas qui a motivé le ticket est dans le verso : une clôture ouverte, jamais refermée.
    const front = 'Commande de **build** ?'
    const back = "```\ndocker build .\nle reste de la carte part dans le bloc, et c'est correct"

    const user = await createUserWith(['leitner.view', 'leitner.review', 'leitner.cards.write'])
    await makeCard(front, { back })

    const session = await client.get('/revision?scope=all').loginAs(user).withInertia()
    const revision = (session.inertiaProps as Record<string, any>).dueCards[0]

    const response = await askPreview(client, CARDS_PREVIEW, { front, back }, user)
    response.assertStatus(200)

    // L'égalité, pas une inclusion : c'est elle qui interdit à l'un des deux rendus de dériver.
    assert.equal(response.body().frontHtml, revision.frontHtml)
    assert.equal(response.body().backHtml, revision.backHtml)

    // Et le témoin qui empêche l'égalité d'être vraie sur deux chaînes vides — sans lui, un
    // contrôleur qui rendrait `''` des deux côtés passerait ce test au vert.
    assert.include(response.body().frontHtml, '<strong>build</strong>')
    assert.include(response.body().backHtml, '<pre><code>docker build .')
  })

  test('la route des brouillons rend la même chose que celle des cartes', async ({
    client,
    assert,
  }) => {
    const source = { front: '# Titre', back: '- un\n- deux' }
    const user = await createUserWith(['leitner.cards.write', 'leitner.ingest'])

    const cards = await askPreview(client, CARDS_PREVIEW, source, user)
    const drafts = await askPreview(client, DRAFTS_PREVIEW, source, user)

    cards.assertStatus(200)
    drafts.assertStatus(200)
    assert.deepEqual(drafts.body(), cards.body())
    assert.include(cards.body().backHtml, '<ul>')
  })

  test('un contenu hostile ressort assaini', async ({ client, assert }) => {
    // Le contenu d'une carte n'est pas de confiance : ingestion LLM, import JSON, et cartes
    // communales depuis CC-121. L'aperçu ne fait pas exception — il alimente un `v-html`.
    const user = await createUserWith(['leitner.cards.write'])

    const response = await askPreview(
      client,
      CARDS_PREVIEW,
      {
        front: '<img src=x onerror=alert(1)>',
        back: '<script>alert(1)</script> [lien](//exemple.fr)',
      },
      user
    )

    response.assertStatus(200)
    assert.notInclude(response.body().frontHtml, '<img')
    assert.notInclude(response.body().backHtml, '<script')
    // Le protocole relatif est refusé (`allowProtocolRelative: false`) : le lien est neutralisé.
    assert.notInclude(response.body().backHtml, 'href="//exemple.fr"')
    // ⚠️ Neutralisé ne veut pas dire disparu : le contenu reste **visible en texte**, sans quoi
    // le trou serait indiscernable d'une carte mal saisie (voir l'en-tête de `renderMarkdown`).
    assert.include(response.body().frontHtml, '&lt;img')
  })

  test('un corps vide rend 200 et deux chaînes vides', async ({ client, assert }) => {
    // L'état normal du panneau à l'ouverture d'une modale de création : on prévisualise en cours
    // de frappe, donc un champ encore vide n'est pas une erreur. Un `minLength(1)` recopié de
    // `cardValidator` ferait échouer l'aperçu à la seconde exacte où l'auteur commence à écrire.
    const user = await createUserWith(['leitner.cards.write'])

    const response = await askPreview(client, CARDS_PREVIEW, {}, user)

    response.assertStatus(200)
    assert.equal(response.body().frontHtml, '')
    assert.equal(response.body().backHtml, '')
  })

  test('la borne de taille est appliquée, et elle laisse passer ce qui tient dessous', async ({
    client,
    assert,
  }) => {
    // `front`/`back` n'ont aucun plafond côté carte : sans cette borne, rien ne limiterait ce
    // qu'on peut poster à une route qui rend du HTML.
    const user = await createUserWith(['leitner.cards.write'])

    const refuse = await askPreview(
      client,
      CARDS_PREVIEW,
      { front: 'a'.repeat(PREVIEW_MAX_CHARS + 1) },
      user
    )
    refuse.assertStatus(422)

    // Le pendant, et il compte autant : une borne trop serrée refuserait ce que l'écran laisse
    // écrire, et le panneau resterait vide sans dire pourquoi. Les deux côtés du seuil, donc.
    const accepte = await askPreview(
      client,
      CARDS_PREVIEW,
      { front: 'a'.repeat(PREVIEW_MAX_CHARS) },
      user
    )
    accepte.assertStatus(200)
    assert.include(accepte.body().frontHtml, 'aaa')
  })

  test('la borne vaut aussi pour la route des brouillons, et sur les deux champs', async ({
    client,
  }) => {
    const user = await createUserWith(['leitner.ingest'])

    const response = await askPreview(
      client,
      DRAFTS_PREVIEW,
      { back: 'a'.repeat(PREVIEW_MAX_CHARS + 1) },
      user
    )

    response.assertStatus(422)
  })

  test('chaque route exige la capacité de SON écran', async ({ client }) => {
    // ⚠️ Le test qui compte : chacune est fermée à qui a l'autre. Une route d'aperçu « générique »
    // — ou les deux sous la même capacité — passerait un test de droit à moitié, et ouvrirait un
    // rendu de HTML à un compte qui n'a ni l'un ni l'autre des deux écrans.
    const lecteur = await createUserWith(['leitner.view'])
    const saisie = await createUserWith(['leitner.cards.write'])
    const ingestion = await createUserWith(['leitner.ingest'])

    for (const route of [CARDS_PREVIEW, DRAFTS_PREVIEW]) {
      const response = await askPreview(client, route, { front: 'x' }, lecteur)
      response.assertStatus(403)
    }

    const saisieSurBrouillons = await askPreview(client, DRAFTS_PREVIEW, { front: 'x' }, saisie)
    saisieSurBrouillons.assertStatus(403)

    const ingestionSurCartes = await askPreview(client, CARDS_PREVIEW, { front: 'x' }, ingestion)
    ingestionSurCartes.assertStatus(403)
  })

  test("l'aperçu n'écrit rien", async ({ client, assert }) => {
    // Elle prend du texte arbitraire : la seule chose qui la rende inoffensive est qu'elle ne
    // laisse aucune trace — ni carte, ni brouillon. Même doctrine que `/revision/ingest/extract`.
    const user = await createUserWith(['leitner.cards.write', 'leitner.view'])

    await askPreview(
      client,
      CARDS_PREVIEW,
      { front: 'Une carte qui ne doit pas exister', back: 'Verso' },
      user
    )

    const catalogue = await client.get('/revision/settings').loginAs(user).withInertia()
    assert.lengthOf((catalogue.inertiaProps as Record<string, any>).cards, 0)
  })
})
