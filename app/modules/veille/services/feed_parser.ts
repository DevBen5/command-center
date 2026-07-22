import { DateTime } from 'luxon'
import Parser from 'rss-parser'
import sanitizeHtml from 'sanitize-html'

/** Le corps n'est ni du RSS ni de l'Atom exploitable. */
export class FeedParseError extends Error {}

export type ParsedEntry = {
  title: string
  url: string | null
  content: string | null
  publishedAt: DateTime | null
  /** `guid` (RSS) ou `id` (Atom). Sert de repli quand l'entrée n'a pas de lien. */
  guid: string | null
}

export type ParsedFeed = {
  title: string | null
  entries: ParsedEntry[]
}

/**
 * Au-delà, ce n'est plus un résumé. La recherche plein texte se nourrit de `title + content` :
 * 20 000 caractères suffisent largement, et on évite de stocker des articles entiers.
 */
const MAX_CONTENT = 20_000

/**
 * Paramètres de campagne : deux liens vers le même article n'en sont plus qu'un une fois
 * retirés. C'est le cas le plus courant du même contenu arrivant par deux chemins.
 */
const TRACKING_PARAMS =
  /^(utm_|ga_|mc_|pk_|hsa_|_hs)|^(fbclid|gclid|dclid|yclid|igshid|mkt_tok|ref_src|s_cid)$/i

// `rss-parser` gère RSS 2.0 *et* Atom derrière la même sortie : c'est précisément pour ça qu'il
// est là, plutôt qu'un parseur maison. ⚠️ On n'utilise QUE `parseString` — `parseURL` ferait le
// réseau lui-même, hors de la garde SSRF de `feed_fetcher.ts`.
const parser = new Parser()

/**
 * Réduit du HTML de flux à du texte.
 *
 * Le contenu d'un flux est **hostile par défaut** : il est écrit par un tiers et finira dans une
 * page. Plutôt que de nettoyer du HTML pour le rendre ensuite, on n'en garde que le texte —
 * il devient alors impossible qu'un `v-html` posé plus tard rouvre la faille.
 *
 * `sanitize-html` décode les entités mais ré-échappe `&` et `<`. On redécode uniquement celles
 * qui ne peuvent pas reformer de balise, **en une seule passe** (sinon `&amp;lt;` se décoderait
 * deux fois et redeviendrait `<`). Invariant qui en découle, vérifié par les tests :
 * le texte stocké ne contient jamais `<` ni `>`.
 */
const SAFE_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
}

export function htmlToText(html: string): string {
  const stripped = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })

  return stripped
    .replace(/&(?:amp|quot|apos|#39|nbsp);/g, (entity) => SAFE_ENTITIES[entity] ?? entity)
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Forme canonique d'une URL, utilisée **uniquement** pour la clé de déduplication — l'URL
 * stockée reste celle qu'annonce le flux, c'est elle qu'on ouvrira.
 *
 * Le schéma est forcé en `https` et le `www.` retiré : beaucoup de flux servent encore des liens
 * en `http://www.` vers des pages qui vivent en `https://`. Sans ça, le même article compte deux
 * fois selon la source qui l'annonce.
 */
export function canonicalizeUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  const host = url.hostname.toLowerCase().replace(/^www\./, '')

  const params = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAMS.test(key))
    // Tri : `?a=1&b=2` et `?b=2&a=1` désignent la même page.
    .sort(([a], [b]) => a.localeCompare(b))

  const query = params.map(([key, value]) => `${key}=${value}`).join('&')
  // Le slash final ne distingue rien, sauf à la racine où il n'y a rien à retirer.
  const path = url.pathname.replace(/\/+$/, '')

  // Le fragment (`#section`) n'atteint jamais le serveur : il ne peut pas désigner un autre article.
  return `https://${host}${path}${query ? `?${query}` : ''}`
}

/**
 * Clé de déduplication, posée sous index unique.
 *
 * **URL d'abord, `guid` en repli** — l'inverse de ce qu'on lit d'habitude. Le `guid` est propre à
 * chaque flux : le prendre en premier ne dédoublonne *jamais* entre deux sources, alors que c'est
 * le cas le plus fréquent (le blog, l'agrégateur, HN). L'URL couvre les deux situations, y
 * compris la republication à titre corrigé — le `guid` change parfois, l'URL non.
 *
 * Le préfixe évite qu'un `guid` qui ressemble à une URL collisionne avec une vraie URL.
 * Le `guid` est cadré par la source, parce qu'il n'est unique qu'à l'intérieur d'un flux.
 */
export function dedupKeyFor(entry: ParsedEntry, sourceId: number): string {
  const canonical = entry.url ? canonicalizeUrl(entry.url) : null
  if (canonical) return `url:${canonical}`

  if (entry.guid) return `guid:${sourceId}:${entry.guid.trim()}`

  // Ni lien ni identifiant : cas dégénéré, mais il faut *une* clé. Sans elle, l'entrée serait
  // réinsérée à chaque passe et remplirait la boîte toute seule. Le titre suffit ; le prix à
  // payer est qu'une correction de titre produira un doublon — sur une entrée qui n'a déjà ni
  // lien ni `guid`, c'est le moindre mal.
  return `title:${sourceId}:${entry.title.toLowerCase().replace(/\s+/g, ' ').trim()}`
}

function toDateTime(value: string | undefined): DateTime | null {
  if (!value) return null
  const parsed = DateTime.fromJSDate(new Date(value))
  return parsed.isValid ? parsed : null
}

export async function parseFeed(xml: string): Promise<ParsedFeed> {
  let output: Awaited<ReturnType<typeof parser.parseString>>
  try {
    output = await parser.parseString(xml)
  } catch (error) {
    throw new FeedParseError(
      `Le corps de la réponse n'est ni du RSS ni de l'Atom lisible : ` +
        `${error instanceof Error ? error.message : String(error)}`
    )
  }

  const entries: ParsedEntry[] = []

  for (const item of output.items ?? []) {
    // Une entrée sans titre n'est pas affichable : on ne l'invente pas, on la saute.
    const title = item.title?.trim()
    if (!title) continue

    // `content` (RSS et Atom) puis `summary` (Atom) puis `contentSnippet` : le plus riche gagne.
    const rawContent = item.content ?? item.summary ?? item.contentSnippet ?? null
    const content = rawContent ? htmlToText(rawContent).slice(0, MAX_CONTENT) : null

    entries.push({
      title: title.slice(0, 500),
      url: item.link?.trim() || null,
      content: content || null,
      // Atom range sa date dans `pubDate` (depuis `published` ou `updated`) — cf. rss-parser.
      publishedAt: toDateTime(item.isoDate ?? item.pubDate),
      // RSS donne `guid`, Atom donne `id`.
      guid: (item.guid ?? (item as { id?: string }).id)?.trim() || null,
    })
  }

  return { title: output.title?.trim() || null, entries }
}
