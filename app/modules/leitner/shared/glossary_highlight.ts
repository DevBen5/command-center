/**
 * Les mots-clés du recto (CC-254) — un tokeniseur PUR : `(front, glossaire) → jetons`. Aucun
 * balisage dans la carte (voir le ticket) : le glossaire se reconnaît tout seul contre le texte
 * déjà écrit.
 *
 * ⚠️ **N'importe JAMAIS par un alias `#modules/*` depuis ce dossier** — même raison que
 * `shared/review_page.ts` : l'alias mappe vers `./app/modules/*.js`, des fichiers qui n'existent
 * qu'après un build, et Vite ne les résout pas (ce fichier est importé par `pages/index.vue`).
 * `normalizeForSearch` est importée en RELATIF, jamais recopiée : c'est l'unique copie de la
 * comparaison insensible aux accents/casse, partagée avec la barre de recherche et le
 * court-circuit du juge.
 *
 * Ce fichier est **pur** : ni base, ni horloge, ni DOM, ni Vue.
 *
 * ⚠️ **Depuis CC-276, `tokenizeFront` n'est plus appelée QUE côté serveur** — par
 * `services/leitner_front_html.ts`, qui reparcourt le HTML assaini de `renderMarkdown(front)`
 * nœud de texte par nœud de texte (le Markdown du recto est de nouveau rendu ; voir ce fichier
 * pour le pourquoi). Ce fichier-ci ne change pas de rôle : il reste le tokeniseur pur, réutilisé
 * tel quel, plus jamais importé côté page que pour ses TYPES (`FrontNode`, `FrontToken`).
 */
import { normalizeForSearch } from '../components/leitner_scope_search.js'

/** Un terme du glossaire, tel que servi par `leitner_glossary_service.ts`. */
export interface GlossaryTerm {
  term: string
  sectionId: number
}

/** Un morceau du recto : `sectionId` non nul = cliquable, ouvre la définition. */
export interface FrontToken {
  texte: string
  sectionId: number | null
}

/**
 * L'arbre du recto (CC-276) — ce que `services/leitner_front_html.ts` construit en
 * reparcourant le HTML assaini de `renderMarkdown(front)`, et ce que `pages/index.vue`
 * rejoue en éléments Vue réels (jamais en `v-html`). Un nœud `element` porte le balisage
 * intact (tag + attributs whitelistés par `markdown_renderer.ts`) ; un nœud `text` porte
 * les jetons du glossaire, comme avant CC-276.
 */
export interface FrontElementNode {
  type: 'element'
  tag: string
  attrs: Record<string, string>
  children: FrontNode[]
}

export interface FrontTextNode {
  type: 'text'
  tokens: FrontToken[]
}

export type FrontNode = FrontElementNode | FrontTextNode

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char)
}

/**
 * ⚠️ **`collapsed` n'est pas `front` tel quel.** `normalizeForSearch` collapse les espaces
 * internes (`\s+` → un seul) avant de comparer : pour que les index d'une comparaison
 * normalisée restent alignés avec le texte affiché, on collapse d'abord nous-mêmes (un simple
 * `replace`, pas une seconde copie de la normalisation elle-même) — un recto à double espace
 * s'affiche donc collapsé. Édge case accepté, jamais rencontré sur une carte réelle.
 */
function matchesAt(
  haystack: string,
  collapsed: string,
  index: number,
  candidate: { normalized: string }
): boolean {
  const len = candidate.normalized.length
  if (len === 0 || haystack.slice(index, index + len) !== candidate.normalized) return false
  // Jamais à l'intérieur d'un mot : le caractère avant et après le candidat ne doit pas
  // continuer un mot (« TLSv1.3 » ne souligne jamais « TLS »).
  if (isWordChar(collapsed[index - 1]) || isWordChar(collapsed[index + len])) return false
  return true
}

/**
 * Tokenise le recto contre le glossaire — **plus long d'abord**, jamais à l'intérieur d'un mot,
 * jamais de second essai sur une portée déjà consommée par un match plus long trouvé à la même
 * position (les termes qui se chevauchent ne se rattrapent pas après coup).
 */
export function tokenizeFront(front: string, glossary: GlossaryTerm[]): FrontToken[] {
  const collapsed = front.replace(/\s+/g, ' ')
  const haystack = normalizeForSearch(collapsed)

  const candidates = glossary
    .map((entry) => ({ sectionId: entry.sectionId, normalized: normalizeForSearch(entry.term) }))
    .filter((entry) => entry.normalized.length > 0)
    .sort((a, b) => b.normalized.length - a.normalized.length)

  const tokens: FrontToken[] = []
  let plainStart = 0
  let i = 0
  while (i < collapsed.length) {
    const match = candidates.find((candidate) => matchesAt(haystack, collapsed, i, candidate))
    if (match) {
      if (plainStart < i) tokens.push({ texte: collapsed.slice(plainStart, i), sectionId: null })
      const len = match.normalized.length
      tokens.push({ texte: collapsed.slice(i, i + len), sectionId: match.sectionId })
      i += len
      plainStart = i
    } else {
      i += 1
    }
  }
  if (plainStart < collapsed.length) {
    tokens.push({ texte: collapsed.slice(plainStart), sectionId: null })
  }

  return tokens
}
