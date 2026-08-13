import { test } from '@japa/runner'
import { renderMarkdown } from '#core/shared/services/markdown_renderer'

/**
 * La brique de rendu Markdown (CC-133) — la seule fabrique de HTML rendu du dépôt, et donc le
 * seul endroit où une erreur se paie en XSS.
 *
 * ⚠️ **Lire l'en-tête de `markdown_renderer.ts` avant de toucher à ce fichier.** Le rendu a
 * **deux couches** (`html: false` puis `sanitize-html`), et la conséquence pour les tests est
 * contre-intuitive : le vecteur XSS évident — `<script>`, `onerror=` — est déjà neutralisé par la
 * première. Un test qui n'assertirait que ça **resterait vert sur une brique dont on a retiré
 * l'assainissement**, c'est-à-dire exactement le décor que la consigne « ne fige jamais un bug
 * connu » interdit, prise par l'autre bout.
 *
 * Les deux mutations ont été **réellement exécutées** (2026-08-13), et leur résultat n'est pas
 * celui qu'on attend d'une simple redondance :
 *
 * - **Retirer `sanitizeHtml`** → 13 verts, **3 rouges**, et ce sont exactement les trois du
 *   groupe « ce que seul l'assainissement fait ». Le groupe « HTML brut échappé » reste vert : la
 *   couche 1 le tient.
 * - **Passer `html: true`** → **aucune assertion de sécurité ne rougit** (`sanitize-html` jette la
 *   balise même devenue réelle). Ce qui rougit, ce sont les `include('&lt;img')` — c'est-à-dire
 *   la **fidélité** : sous `html: true`, le contenu neutralisé disparaît en silence au lieu de
 *   s'afficher en texte. `<img src=x onerror=alert(1)>` rend `<p>avant  après</p>`, un trou
 *   indiscernable d'une carte mal saisie.
 *
 * Donc : la couche 2 ferme le vecteur, la couche 1 garde le contenu lisible. Les deux moitiés
 * d'assertion de chaque test du groupe « HTML brut » ne prouvent pas la même chose, et il ne faut
 * en supprimer aucune.
 */
test.group('Markdown / rendu assaini', () => {
  test('le gras, l’italique et le barré deviennent des balises', ({ assert }) => {
    assert.include(renderMarkdown('**gras**'), '<strong>gras</strong>')
    assert.include(renderMarkdown('*penché*'), '<em>penché</em>')
    assert.include(renderMarkdown('~~barré~~'), '<s>barré</s>')
  })

  test('les titres, listes, citations et tableaux sont rendus', ({ assert }) => {
    assert.include(renderMarkdown('# Titre'), '<h1>Titre</h1>')
    assert.include(renderMarkdown('- un\n- deux'), '<li>un</li>')
    assert.include(renderMarkdown('> citation'), '<blockquote>')
    assert.include(renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |'), '<td>1</td>')
  })

  test('un retour à la ligne simple reste un retour à la ligne', ({ assert }) => {
    // `breaks: true`. En CommonMark strict, ces deux lignes se colleraient en une seule — ce que
    // fait l'affichage d'aujourd'hui, et que ce lot répare.
    assert.include(renderMarkdown('ligne un\nligne deux'), '<br')
  })

  test('une source vide ne rend rien, pas un paragraphe vide', ({ assert }) => {
    assert.equal(renderMarkdown(''), '')
    assert.equal(renderMarkdown('   \n  '), '')
  })
})

/**
 * Le besoin principal du ticket : coller du code de développeur et le relire.
 */
test.group('Markdown / les blocs de code', () => {
  test('un bloc de code garde son indentation', ({ assert }) => {
    const html = renderMarkdown('```\nif True:\n    print("ok")\n```')

    assert.include(html, '<pre><code>')
    // Les quatre espaces survivent : c'est tout l'intérêt du bloc.
    assert.include(html, '\n    print(')
  })

  test('le contenu d’un bloc de code n’est pas ré-interprété', ({ assert }) => {
    const html = renderMarkdown('```\n**pas du gras** et <b>pas une balise</b>\n```')

    assert.notInclude(html, '<strong>')
    assert.notInclude(html, '<b>')
    assert.include(html, '**pas du gras**')
  })

  test('les esperluettes d’un bloc de code ne sont pas doublement échappées', ({ assert }) => {
    // ⚠️ Le piège que `htmlToText` documente dans veille (`feed_parser.ts:45`) :
    // `sanitize-html` décode puis ré-échappe. Un aller-retour fautif rendrait `&amp;amp;`,
    // et l'écran afficherait `a &amp; b` au lieu de `a && b`.
    const html = renderMarkdown('```\ncmd a && b\n```')

    assert.include(html, 'cmd a &amp;&amp; b')
    assert.notInclude(html, '&amp;amp;')
  })

  test('le code en ligne est rendu sans échapper son contenu deux fois', ({ assert }) => {
    assert.include(renderMarkdown('lance `npm test`'), '<code>npm test</code>')
  })
})

/**
 * ⚠️ **Chaque test d'ici porte DEUX assertions qui ne prouvent pas la même chose**, et c'est
 * délibéré : le `notInclude` dit que le vecteur est fermé (tenu par les deux couches), le
 * `include` d'une forme échappée dit que le contenu **reste visible** plutôt que d'être supprimé
 * en silence (tenu par la seule couche 1). Ce groupe n'est donc pas la preuve de
 * l'assainissement — c'est le groupe suivant.
 */
test.group('Markdown / le HTML brut de la source est échappé', () => {
  test('un vecteur `onerror` ne devient jamais une balise', ({ assert }) => {
    const html = renderMarkdown('avant <img src=x onerror=alert(1)> après')

    assert.notInclude(html, '<img')
    // Il ressort en texte visible — c'est ce que l'auteur a tapé, et ça ne s'exécute pas.
    assert.include(html, '&lt;img')
  })

  test('une balise script ne survit pas', ({ assert }) => {
    assert.notInclude(renderMarkdown('<script>alert(1)</script>'), '<script')
  })

  test('un gestionnaire d’événement sur une balise AUTORISÉE ne devient pas un attribut', ({
    assert,
  }) => {
    // ⚠️ `p` est dans la liste blanche : c'est le cas qui pourrait faire croire qu'un attribut
    // passe. Il ne passe pas, parce que la balise elle-même n'en est jamais une — elle est
    // échappée en amont. D'où l'assertion **sur la balise**, pas sur la chaîne `onclick="` :
    // celle-ci est bel et bien présente dans la sortie, en texte visible, et l'assertion naïve
    // rougirait à tort.
    const html = renderMarkdown('<p onclick="alert(1)">texte</p>')

    assert.notInclude(html, '<p onclick')
    assert.include(html, '&lt;p onclick')
  })
})

/**
 * ⚠️ **Le groupe qui PROUVE l'assainissement.** Chacun de ces trois tests rougit quand on retire
 * l'appel à `sanitizeHtml` de `renderMarkdown` — vérifié en le retirant, pas déduit. Ce sont les
 * seuls : tout le reste est couvert deux fois.
 */
test.group('Markdown / ce que seul l’assainissement fait', () => {
  test('une image Markdown est retirée', ({ assert }) => {
    // Socle de CC-134 : la CSP (`imgSrc: ['self', 'data:']`) refuserait une image externe **en
    // silence**. Laisser passer `img` ici rouvrirait par la porte de derrière l'image tierce que
    // CC-134 écarte explicitement.
    const html = renderMarkdown('![schéma](https://exemple.fr/a.png)')

    assert.notInclude(html, '<img')
    assert.notInclude(html, 'exemple.fr')
  })

  test('un lien porte rel et target', ({ assert }) => {
    const html = renderMarkdown('[doc](https://exemple.fr)')

    assert.include(html, 'href="https://exemple.fr"')
    assert.include(html, 'rel="noopener noreferrer nofollow"')
    assert.include(html, 'target="_blank"')
  })

  test('un lien en protocole relatif perd son href', ({ assert }) => {
    // `//exemple.fr` hérite du schéma de la page : sans `allowProtocolRelative: false`, il
    // échapperait à la liste blanche de schémas.
    const html = renderMarkdown('[x](//exemple.fr)')

    assert.notInclude(html, 'href=')
  })
})

/**
 * Fermé par la couche 1 (markdown-it refuse ces schémas avant même d'en faire un lien), gardé
 * parce que c'est le vecteur qu'on cherche d'abord dans une revue.
 */
test.group('Markdown / les schémas d’URL dangereux', () => {
  test('un lien javascript: n’est pas un lien', ({ assert }) => {
    const html = renderMarkdown('[clic](javascript:alert(1))')

    assert.notInclude(html, '<a ')
    assert.notInclude(html, 'href=')
  })

  test('un lien data: n’est pas un lien', ({ assert }) => {
    const html = renderMarkdown('[clic](data:text/html;base64,PHNjcmlwdD4=)')

    assert.notInclude(html, 'href=')
  })
})
