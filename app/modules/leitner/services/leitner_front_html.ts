/**
 * Le recto rendu ET souligné (CC-276) — un reparcours PUR : `(html assaini, glossaire) →
 * arbre de nœuds`. `renderMarkdown(front)` (`core/shared`, inchangée) produit le HTML assaini,
 * exactement comme pour le verso ; cette fonction ne fait QUE reparcourir CE HTML pour
 * tokeniser ses nœuds de TEXTE contre le glossaire — jamais le balisage, jamais un attribut.
 *
 * ⚠️ **`htmlparser2` est déjà vendu par `sanitize-html`** (sa propre dépendance de parsing,
 * `node_modules/sanitize-html/package.json`) : zéro octet neuf sur le disque. Il est déclaré en
 * direct dans `package.json` depuis ce lot, pour ne pas dépendre d'un import « fantôme » d'un
 * paquet que rien ne garantit tant qu'il n'est pas dans NOTRE arbre de dépendances déclaré.
 *
 * ⚠️ **Un terme ne s'annonce jamais dans du code** (`<code>`/`<pre>`) : on n'annote pas du code.
 * ⚠️ **Un terme à cheval sur deux nœuds de texte n'est jamais reconnu** — limite ACCEPTÉE,
 * documentée dans `shared/glossary_highlight.ts` (CC-254) : reconstruire le texte complet pour
 * la rattraper romprait l'alignement avec le balisage réel, exactement ce que ce fichier existe
 * pour éviter.
 */
import { ElementType, parseDocument } from 'htmlparser2'
import {
  tokenizeFront,
  type FrontNode,
  type GlossaryTerm,
} from '#modules/leitner/shared/glossary_highlight'

type DocChild = ReturnType<typeof parseDocument>['children'][number]

/** Tags dans lesquels un terme ne s'annonce jamais : on n'annote pas du code. */
const NO_HIGHLIGHT_TAGS = new Set(['code', 'pre'])

function walk(node: DocChild, glossary: GlossaryTerm[], insideCode: boolean): FrontNode | null {
  if (node.type === ElementType.Text) {
    if (node.data.length === 0) return null
    return { type: 'text', tokens: tokenizeFront(node.data, insideCode ? [] : glossary) }
  }
  if (node.type === ElementType.Tag) {
    const nextInsideCode = insideCode || NO_HIGHLIGHT_TAGS.has(node.name)
    const children: FrontNode[] = []
    for (const child of node.children) {
      const built = walk(child, glossary, nextInsideCode)
      if (built) children.push(built)
    }
    return { type: 'element', tag: node.name, attrs: node.attribs, children }
  }
  // Commentaire, directive… : rien de tel ne sort de `renderMarkdown`, mais un nœud inconnu ne
  // produit jamais d'élément plutôt que de deviner ce qu'il faudrait en faire.
  return null
}

/**
 * `html` est déjà le rendu assaini (`renderMarkdown(front)`, appelé par l'appelant — ce fichier
 * ne sait rien du Markdown, seulement de HTML déjà sûr). Une entrée vide rend `[]`.
 */
export function tokenizeFrontHtml(html: string, glossary: GlossaryTerm[]): FrontNode[] {
  if (!html) return []
  const document = parseDocument(html)
  const nodes: FrontNode[] = []
  for (const child of document.children) {
    const built = walk(child, glossary, false)
    if (built) nodes.push(built)
  }
  return nodes
}
