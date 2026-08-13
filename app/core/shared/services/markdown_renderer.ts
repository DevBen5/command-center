import MarkdownIt from 'markdown-it'
import sanitizeHtml from 'sanitize-html'

/**
 * Markdown → HTML assaini. **La seule fabrique de HTML rendu du dépôt** (CC-133).
 *
 * Elle ne sait rien des cartes, et c'est une contrainte, pas un hasard : CC-251 (le corpus de
 * cours) rendra des documents entiers avec cette même brique. Une méthode sur `LeitnerCard` ou un
 * helper à demeure dans `index.vue` aurait produit **deux** rendus Markdown dans le même module.
 *
 * ⚠️ **Elle vit dans `app/core/shared/`, jamais dans un module, et ce n'est pas une préférence de
 * rangement.** Un service générique logé chez un module détachable est exactement le problème que
 * le point 7 du `CLAUDE.md` racine documente (leçon CC-180, le client Immich) : le jour où un
 * second consommateur arrive, l'importer depuis `#modules/leitner/*` fait qu'éteindre `leitner`
 * dans `MODULES` casse un module qui n'a rien à voir — et rien ne rougit, `.env.test` activant
 * tous les modules connus.
 *
 * ⚠️ **Aucune option, et il ne faut pas en ajouter « au cas où ».** Un point d'extension écrit
 * pour un consommateur qui n'existe pas encore est un contrat qu'aucun test n'exerce. Le jour où
 * CC-251 aura un besoin réel, il se posera avec son cas sous les yeux.
 *
 * ## Le rendu est SERVEUR, et ça achète trois choses
 *
 * Les pages reçoivent du HTML déjà assaini en prop dérivée ; la colonne, elle, reste le **Markdown
 * source** — ce qui laisse l'édition, l'export JSON, la déduplication `(recto, thème)` et le
 * prompt du juge strictement inchangés. En prime, `markdown-it` ne part **jamais** dans le bundle
 * du navigateur, et l'assainissement devient testable par Japa : ce qui vivrait dans un
 * `<script setup>` est structurellement hors de portée de la suite.
 *
 * ## Deux couches, et elles ne font PAS la même chose — mesuré, pas supposé
 *
 * Le contenu **n'est pas de confiance**, sur trois chemins qui existent déjà : l'ingestion LLM
 * écrit des brouillons à partir d'un cours collé, l'import JSON accepte un fichier venu de
 * n'importe où, et les cartes sont communales depuis CC-121 — un compte porteur de
 * `leitner.cards.write` peut donc viser qui révise, administrateur compris.
 *
 * 1. **`html: false`** — markdown-it **échappe** le HTML brut de la source.
 * 2. **`sanitize-html`** sur la sortie — liste blanche stricte de balises, d'attributs et de
 *    schémas d'URL.
 *
 * On croit volontiers à une redondance (« deux ceintures pour la même chute »). Les deux mutations
 * ont été réellement exécutées, et elles disent autre chose :
 *
 * - ⚠️ **C'est la couche 2 qui FERME le vecteur, et elle le ferme seule.** En passant
 *   `html: true`, `<img src=x onerror=alert(1)>` devient une vraie balise — et `sanitize-html` la
 *   jette quand même. Aucune assertion de sécurité ne rougit.
 * - ⚠️ **La couche 1 n'est pas de la sécurité, c'est de la FIDÉLITÉ.** Elle est ce qui fait que
 *   le contenu neutralisé **reste visible en texte** au lieu d'être supprimé en silence : sous
 *   `html: true`, une carte contenant `<img …>` s'affiche `avant  après` — le trou est
 *   indiscernable d'une carte mal saisie. C'est exactement ce qu'assertent les
 *   `include('&lt;img')` de la spec, et c'est **elles** qui rougissent sur cette mutation.
 * - ⚠️ **Corollaire pour qui écrit un test ici : le vecteur XSS évident ne prouve pas
 *   l'assainissement.** `<script>` et `onerror=` restent neutralisés même après avoir retiré
 *   `sanitize-html`, la couche 1 les échappant. Ce que **seule** la couche 2 fait, et qui rougit
 *   donc quand on la retire : le retrait des `<img>`, le `rel="noopener noreferrer nofollow"` des
 *   liens, et le refus du protocole relatif.
 *
 * Ne « simplifie » donc aucune des deux en croyant l'autre suffisante : elles ne couvrent pas le
 * même échec.
 *
 * ## Les images sont RETIRÉES, et c'est un socle, pas un oubli
 *
 * `![alt](https://…)` disparaît. La CSP en place (`imgSrc: ['self', 'data:']`, `config/shield.ts`)
 * refuserait de charger une image externe **en silence** — rien au build, rien aux tests, seule la
 * console du navigateur le dirait. CC-134 (images stockées en base) rouvrira `img` avec sa propre
 * règle de source ; hériter d'un `img` déjà ouvert vers n'importe quel domaine rouvrirait par la
 * porte de derrière l'image externe que CC-134 écarte explicitement.
 *
 * ## Ce que la brique NE fait pas
 *
 * Elle rend un **fragment**, sans conteneur ni classe : l'habillage (`.markdown` de
 * `inertia/css/app.css`) est posé par la page, qui seule sait dans quel bloc elle l'insère.
 */

/**
 * ⚠️ **`breaks: true` est un choix, et il change l'affichage du contenu existant.** Les cartes
 * sont saisies à la main, souvent sur plusieurs lignes ; en CommonMark strict un simple retour à
 * la ligne est un espace, donc un verso tapé sur trois lignes se collapserait en un bloc — ce
 * qu'il fait déjà aujourd'hui, et que ce lot est censé réparer.
 *
 * `linkify: false` : une URL nue reste du texte. Une carte qui *parle* d'une URL n'a aucune raison
 * de la rendre cliquable, et le lien explicite (`[texte](url)`) reste disponible.
 */
const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: false,
  typographer: false,
})

/**
 * La liste blanche. Tout ce qui n'y est pas est **jeté**, contenu textuel conservé.
 *
 * ⚠️ `img` en est absent délibérément — voir l'en-tête du fichier. `class` est absent de
 * `allowedAttributes` alors que markdown-it pose `class="language-…"` sur le `<code>` d'un bloc
 * portant une info de langage : sans coloration syntaxique, cette classe ne pilote rien, et un
 * attribut qu'aucune feuille ne lit est une surface offerte pour rien.
 */
const OPTIONS_ASSAINISSEMENT: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'hr',
    'strong',
    'em',
    's',
    'a',
    'ul',
    'ol',
    'li',
    'blockquote',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'code',
    'pre',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
  ],
  allowedAttributes: { a: ['href', 'rel', 'target'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href'],
  // ⚠️ Sans ça, `//exemple.fr` passe : sanitize-html tolère le protocole relatif par défaut, et un
  // tel lien hérite du schéma de la page — donc échappe à la liste ci-dessus.
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', {
      rel: 'noopener noreferrer nofollow',
      target: '_blank',
    }),
  },
}

/**
 * Rend un fragment HTML assaini à partir de Markdown.
 *
 * Une source vide (ou blanche) rend la chaîne vide plutôt qu'un `<p></p>` : la page n'a alors rien
 * à insérer, et un bloc vide au bord arrondi se verrait.
 */
export function renderMarkdown(source: string): string {
  if (!source.trim()) return ''

  return sanitizeHtml(md.render(source), OPTIONS_ASSAINISSEMENT)
}
