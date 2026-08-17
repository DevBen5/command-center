import { createHash } from 'node:crypto'

/**
 * Découpage d'un cours en sections, et tout ce qui en dérive (CC-251) — **PUR**, sans
 * base ni horloge, testable sans conteneur.
 *
 * ⚠️ **Ce n'est PAS `chunkCourse`** (`leitner_ingestion_service.ts`), qui fait chevaucher
 * des morceaux de 400 caractères pour qu'un LLM garde un principe à cheval. Ici, on
 * affiche : des sections qui se répètent seraient absurdes. Deux découpeurs, deux
 * questions — ne les unifie pas.
 */

export interface CourseSection {
  /** Le chemin de titres, stable à la ré-édition — c'est ce qui rend les pierres
   *  tombales possibles : un titre inchangé rend toujours le même slug. */
  slug: string
  /** Le chemin de titres tel qu'affiché, ex. `['Réseaux', 'TLS', 'Handshake']`. */
  headingPath: string[]
  body: string
  /** Les alias déclarés par `> notion: X, Y` sous le titre. `null` = hors glossaire. */
  aliases: string[] | null
}

const HEADING_LINE = /^(#{1,6})\s+(.+?)\s*$/
/** `> notion: TLS, Transport Layer Security` — n'importe où dans le corps de la section. */
const GLOSSARY_LINE = /^>\s*notion:\s*(.+)$/im

function slugifySegment(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'section'
}

function extractGlossaryAliases(body: string): string[] | null {
  const match = body.match(GLOSSARY_LINE)
  if (!match) return null

  const aliases = match[1]
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

  return aliases.length > 0 ? aliases : null
}

/**
 * Découpe un cours en sections **sans recouvrement**, par ses titres Markdown (`#` à
 * `######`). Un passage avant le premier titre devient une section « Introduction » s'il
 * n'est pas vide. Le chemin de titres accumule les ancêtres (`## TLS` sous `# Réseaux`
 * donne `['Réseaux', 'TLS']`) : deux titres identiques sous des parents différents ne se
 * confondent jamais, seuls deux chemins réellement identiques collisionnent — auquel cas
 * le second (et les suivants) reçoit un suffixe numérique déterministe sur son slug.
 */
export function splitCourseIntoSections(markdown: string): CourseSection[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')

  const preamble: string[] = []
  const raws: { level: number; title: string; bodyLines: string[] }[] = []
  let current: { level: number; title: string; bodyLines: string[] } | null = null

  for (const line of lines) {
    const heading = line.match(HEADING_LINE)
    if (heading) {
      if (current) raws.push(current)
      current = { level: heading[1].length, title: heading[2], bodyLines: [] }
      continue
    }
    ;(current ? current.bodyLines : preamble).push(line)
  }
  if (current) raws.push(current)

  const drafts: { headingPath: string[]; body: string; slugBase: string }[] = []

  const preambleBody = preamble.join('\n').trim()
  if (preambleBody) {
    drafts.push({ headingPath: [], body: preambleBody, slugBase: 'introduction' })
  }

  // Pile des ancêtres encore actifs : un titre de niveau N ferme tout ce qui est
  // niveau >= N, comme un plan Markdown classique.
  const stack: { level: number; title: string }[] = []
  for (const raw of raws) {
    while (stack.length > 0 && stack[stack.length - 1].level >= raw.level) stack.pop()
    stack.push({ level: raw.level, title: raw.title })

    const headingPath = stack.map((entry) => entry.title)
    drafts.push({
      headingPath,
      body: raw.bodyLines.join('\n').trim(),
      slugBase: headingPath.map(slugifySegment).join('/'),
    })
  }

  const occurrences = new Map<string, number>()
  return drafts.map(({ headingPath, body, slugBase }) => {
    const count = (occurrences.get(slugBase) ?? 0) + 1
    occurrences.set(slugBase, count)

    return {
      slug: count === 1 ? slugBase : `${slugBase}-${count}`,
      headingPath,
      body,
      aliases: extractGlossaryAliases(body),
    }
  })
}

/**
 * Empreinte de dédup « même texte exactement » — SHA-256 du markdown normalisé (fins de
 * ligne, bords). Portée au propriétaire par la contrainte `unique(owner_id, content_hash)`,
 * jamais globale.
 */
export function hashCourseMarkdown(markdown: string): string {
  const normalized = markdown.replace(/\r\n?/g, '\n').trim()
  return createHash('sha256').update(normalized, 'utf8').digest('hex')
}
