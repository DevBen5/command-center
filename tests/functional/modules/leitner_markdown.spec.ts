import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { makeCard } from '#tests/helpers/leitner'
import { createUserWith } from '#tests/helpers/users'

/** Les tags de tous les éléments de l'arbre `frontNodes` (CC-276), toutes profondeurs. */
function elementTags(nodes: any[]): string[] {
  const tags: string[] = []
  for (const node of nodes) {
    if (node.type === 'element') {
      tags.push(node.tag)
      tags.push(...elementTags(node.children))
    }
  }
  return tags
}

/**
 * Le rendu Markdown **par la route** (CC-133) — ce que l'unitaire de
 * `tests/unit/markdown_renderer.spec.ts` ne peut pas dire.
 *
 * La brique y est prouvée en isolation ; ici, c'est le **branchement** qui est en jeu, et son
 * mode d'échec est silencieux : un `frontHtml` que le contrôleur oublierait de poser rend une
 * carte **vide** à l'écran. `v-html` sur `undefined` n'affiche rien, sans erreur ni log — et
 * `tsc` ne lit pas les `.vue`, donc rien ne l'attraperait ailleurs qu'ici.
 *
 * ⚠️ **La source doit descendre AUSSI**, et c'est asserté : l'édition, l'export JSON, la
 * déduplication `(recto, thème)` et le prompt du juge travaillent tous sur le Markdown source. Un
 * contrôleur qui remplacerait `front` par son HTML les casserait tous les quatre d'un geste.
 */
test.group('Leitner / le Markdown des cartes est rendu', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  function reviseur() {
    return createUserWith(['leitner.view', 'leitner.review'])
  }

  test('la file de révision porte le HTML rendu, en plus de la source', async ({
    client,
    assert,
  }) => {
    const user = await reviseur()
    await makeCard('Commande de **build** ?', { back: '```\ndocker build .\n```' })

    const response = await client.get('/revision?scope=all').loginAs(user).withInertia()
    const props = response.inertiaProps as Record<string, any>

    assert.lengthOf(props.dueCards, 1)
    const card = props.dueCards[0]

    assert.include(card.frontHtml, '<strong>build</strong>')
    assert.include(card.backHtml, '<pre><code>docker build .')

    // Le recto rendu ET souligné (CC-276) : le MÊME balisage, en arbre plutôt qu'en chaîne.
    assert.include(elementTags(card.frontNodes), 'strong')

    // ⚠️ La colonne reste la source — c'est ce qui garde l'édition, l'export et le juge intacts.
    assert.equal(card.front, 'Commande de **build** ?')
    assert.equal(card.back, '```\ndocker build .\n```')
  })

  test('une carte hostile ressort assainie jusque dans les props', async ({ client, assert }) => {
    // Le geste réel : ce vecteur peut arriver par l'ingestion LLM, par un import JSON, ou d'un
    // autre compte porteur de `leitner.cards.write` (les cartes sont communales depuis CC-121).
    const user = await reviseur()
    await makeCard('<img src=x onerror=alert(1)>', {
      back: '<script>alert(1)</script> et ![vol](https://exemple.fr/pixel.png)',
    })

    const response = await client.get('/revision?scope=all').loginAs(user).withInertia()
    const props = response.inertiaProps as Record<string, any>
    const card = props.dueCards[0]

    assert.notInclude(card.frontHtml, '<img')
    assert.notInclude(card.backHtml, '<script')
    assert.notInclude(card.backHtml, '<img')
    assert.notInclude(card.backHtml, 'exemple.fr')

    // ⚠️ Le recto rendu ET souligné (CC-276) : `frontNodes` reparcourt le MÊME HTML assaini
    // — aucun élément `img` ne peut en sortir, quoi que le recto contienne.
    assert.notInclude(elementTags(card.frontNodes), 'img')

    // ⚠️ La source, elle, n'est PAS réécrite : la base garde ce qui a été saisi. C'est le rendu
    // qui protège, pas une destruction à l'écriture — l'inverse du choix de la veille
    // (`htmlToText`, `allowedTags: []`), et pour une raison différente : ici le Markdown doit
    // rester relisible et modifiable.
    assert.equal(card.front, '<img src=x onerror=alert(1)>')
  })

  test('les écrans de liste gardent le texte brut, sans HTML', async ({ client, assert }) => {
    // ⚠️ Le pendant du test ci-dessus, et il vaut autant : le recto est une **clé** sur ces
    // écrans — `cardLink(front)` construit l'URL de recherche de `stats.vue`, et
    // `confirmDeleteCard` en affiche les 60 premiers caractères. Rendre du HTML là casserait une
    // identité, pas une apparence. Le catalogue, lui, tronque en `line-clamp-2` : une coupe au
    // milieu d'une balise donnerait du HTML invalide.
    const user = await createUserWith(['leitner.view', 'leitner.cards.write'])
    await makeCard('Recto en **gras**', { back: 'Verso en *penché*' })

    const response = await client.get('/revision/settings').loginAs(user).withInertia()
    const props = response.inertiaProps as Record<string, any>
    const card = props.cards[0]

    assert.equal(card.front, 'Recto en **gras**')
    assert.isUndefined(card.frontHtml)
    assert.isUndefined(card.backHtml)
  })
})
