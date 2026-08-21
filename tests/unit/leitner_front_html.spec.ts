import { test } from '@japa/runner'
import { tokenizeFrontHtml } from '#modules/leitner/services/leitner_front_html'
import { renderMarkdown } from '#core/shared/services/markdown_renderer'
import type {
  FrontElementNode,
  FrontNode,
  GlossaryTerm,
} from '#modules/leitner/shared/glossary_highlight'

/** Rétrécit un nœud en `element`, ou lève — les tests savent déjà quelle forme attendre. */
function asElement(node: FrontNode | undefined | null): FrontElementNode {
  if (!node || node.type !== 'element') throw new Error('nœud element attendu')
  return node
}

/**
 * Le recto rendu ET souligné (CC-276) — `tokenizeFrontHtml` prend en entrée le HTML DÉJÀ
 * assaini par `renderMarkdown` (même brique, même sortie que le verso) et rend l'arbre que
 * la page rejoue en éléments Vue réels. Ce fichier prouve le reparcours ; l'assainissement
 * lui-même reste couvert par `tests/unit/markdown_renderer.spec.ts`, et le tokeniseur pur
 * par `tests/unit/leitner_glossary_highlight.spec.ts`.
 */
function html(source: string): string {
  return renderMarkdown(source)
}

test.group('Leitner / le recto rendu et souligné (CC-276)', () => {
  test('le balisage sort intact : gras, liste et bloc de code', ({ assert }) => {
    const nodes = tokenizeFrontHtml(
      html('Le **protocole** :\n\n- un\n- deux\n\n```\ncode\n```'),
      []
    )

    // Un `<strong>`, une `<ul>` de deux `<li>`, un `<pre><code>` — le même balisage que le
    // verso produirait pour la même source.
    const tags = new Set<string>()
    function collectTags(list: typeof nodes) {
      for (const node of list) {
        if (node.type === 'element') {
          tags.add(node.tag)
          collectTags(node.children)
        }
      }
    }
    collectTags(nodes)
    assert.isTrue(tags.has('strong'))
    assert.isTrue(tags.has('ul'))
    assert.isTrue(tags.has('li'))
    assert.isTrue(tags.has('pre'))
    assert.isTrue(tags.has('code'))
  })

  test('un terme dans un bloc de code n’est jamais souligné', ({ assert }) => {
    const glossary: GlossaryTerm[] = [{ term: 'TLS', sectionId: 7 }]
    const nodes = tokenizeFrontHtml(html('```\nTLS\n```'), glossary)

    const tokens: Array<{ texte: string; sectionId: number | null }> = []
    function collectTokens(list: typeof nodes) {
      for (const node of list) {
        if (node.type === 'text') tokens.push(...node.tokens)
        else collectTokens(node.children)
      }
    }
    collectTokens(nodes)

    assert.isTrue(tokens.some((t) => t.texte.includes('TLS')))
    assert.isFalse(tokens.some((t) => t.sectionId !== null))
  })

  test('un terme reconnu hors code devient un jeton cliquable, balisage préservé', ({ assert }) => {
    const glossary: GlossaryTerm[] = [{ term: 'TLS', sectionId: 7 }]
    const nodes = tokenizeFrontHtml(html('**protocole TLS** négocie.'), glossary)

    // <p> > <strong> > texte contenant le jeton TLS avec sectionId 7
    const paragraph = asElement(nodes[0])
    const strong = asElement(paragraph.children[0])
    const textNode = strong.children[0]
    assert.isNotNull(textNode)
    assert.equal(textNode!.type, 'text')
    const tokens = textNode!.type === 'text' ? textNode.tokens : []
    assert.isTrue(tokens.some((t) => t.texte === 'TLS' && t.sectionId === 7))
  })

  test('un attribut n’est jamais scanné : le href d’un lien reste intact, son texte se souligne', ({
    assert,
  }) => {
    const glossary: GlossaryTerm[] = [{ term: 'TLS', sectionId: 7 }]
    const nodes = tokenizeFrontHtml(html('[TLS](https://exemple.fr/tls)'), glossary)

    const paragraph = asElement(nodes.find((n) => n.type === 'element' && n.tag === 'p'))
    const anchor = asElement(paragraph.children.find((c) => c.type === 'element'))
    assert.equal(anchor.tag, 'a')
    // L'attribut porte l'URL telle quelle — jamais réinterprétée comme du texte à tokeniser.
    assert.equal(anchor.attrs.href, 'https://exemple.fr/tls')
    const anchorText = anchor.children[0]
    assert.isNotNull(anchorText)
    assert.equal(anchorText!.type, 'text')
    const tokens = anchorText!.type === 'text' ? anchorText.tokens : []
    assert.isTrue(tokens.some((t) => t.texte === 'TLS' && t.sectionId === 7))
  })

  test('limite acceptée : un terme composé à cheval sur deux nœuds n’est pas reconnu', ({
    assert,
  }) => {
    const glossary: GlossaryTerm[] = [{ term: 'TLS négocie', sectionId: 7 }]
    const nodes = tokenizeFrontHtml(html('**TLS** négocie'), glossary)

    const tokens: Array<{ texte: string; sectionId: number | null }> = []
    function collectTokens(list: typeof nodes) {
      for (const node of list) {
        if (node.type === 'text') tokens.push(...node.tokens)
        else collectTokens(node.children)
      }
    }
    collectTokens(nodes)

    assert.isFalse(tokens.some((t) => t.sectionId !== null))
  })

  test('mutation : un recto hostile ne devient jamais un élément exécutable', ({ assert }) => {
    const nodes = tokenizeFrontHtml(html('Que fait <script>alert(1)</script> ?'), [])

    function collectTagsAndTexts(list: typeof nodes, tags: string[], texts: string[]): void {
      for (const node of list) {
        if (node.type === 'element') {
          tags.push(node.tag)
          collectTagsAndTexts(node.children, tags, texts)
        } else {
          texts.push(...node.tokens.map((t) => t.texte))
        }
      }
    }
    const tags: string[] = []
    const texts: string[] = []
    collectTagsAndTexts(nodes, tags, texts)

    assert.isFalse(tags.includes('script'))
    assert.isTrue(texts.some((t) => t.includes('<script>alert(1)</script>')))
  })

  test('un recto vide rend un arbre vide', ({ assert }) => {
    assert.deepEqual(tokenizeFrontHtml(html(''), []), [])
    assert.deepEqual(tokenizeFrontHtml(html('   '), []), [])
  })
})
