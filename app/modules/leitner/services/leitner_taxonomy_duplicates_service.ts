import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import LeitnerCatalogService, {
  normalizeTaxonomyName,
  type TaxonomyNode,
} from '#modules/leitner/services/leitner_catalog_service'
import LlmClient, {
  LlmUnavailableError,
  type LlmMessage,
} from '#modules/leitner/services/llm_client'

export const TAXONOMY_DUPLICATES_TIMEOUT_MS = 30_000

export interface TaxonomyDuplicateEntry {
  category: string
  theme: string | null
}

export interface TaxonomyDuplicateGroup {
  entries: TaxonomyDuplicateEntry[]
  reason: string
}

export interface TaxonomyDuplicatesResult {
  groups: TaxonomyDuplicateGroup[]
}

export function taxonomyDuplicateMessages(taxonomy: TaxonomyNode[]): LlmMessage[] {
  return [
    {
      role: 'system',
      content:
        'Tu analyses une taxonomie. Tu ne proposes aucune fusion et tu ne modifies rien. ' +
        'Réponds uniquement avec un objet JSON de la forme {"groups":[{"entries":' +
        '[{"category":"nom","theme":"nom ou null"}],"reason":"courte raison"}]}. ' +
        'Un groupe doit contenir au moins deux entrées existantes qui désignent probablement ' +
        'le même sujet sur le plan sémantique. Une catégorie entière utilise theme null. ' +
        'Ne crée aucun nom, ne renvoie aucun identifiant et ne signale pas les simples différences de casse ou d’accent.',
    },
    {
      role: 'user',
      content: JSON.stringify({ taxonomy }),
    },
  ]
}

function parseJson(raw: string): unknown {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return JSON.parse(fenced?.[1] ?? trimmed)
}

function canonicalEntry(value: unknown, taxonomy: TaxonomyNode[]): TaxonomyDuplicateEntry | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as { category?: unknown; theme?: unknown }
  if (typeof entry.category !== 'string') return null
  if (entry.theme !== null && typeof entry.theme !== 'string') return null

  const category = taxonomy.find(
    (node) => normalizeTaxonomyName(node.name) === normalizeTaxonomyName(entry.category as string)
  )
  if (!category) return null

  if (entry.theme === null) return { category: category.name, theme: null }
  const theme = category.themes.find(
    (name) => normalizeTaxonomyName(name) === normalizeTaxonomyName(entry.theme as string)
  )
  return theme ? { category: category.name, theme } : null
}

export function parseTaxonomyDuplicateGroups(
  raw: string,
  taxonomy: TaxonomyNode[]
): TaxonomyDuplicateGroup[] | null {
  let payload: unknown
  try {
    payload = parseJson(raw)
  } catch {
    return null
  }

  if (
    !payload ||
    typeof payload !== 'object' ||
    !Array.isArray((payload as { groups?: unknown }).groups)
  ) {
    return null
  }

  const groups: TaxonomyDuplicateGroup[] = []
  for (const candidate of (payload as { groups: unknown[] }).groups) {
    if (!candidate || typeof candidate !== 'object') continue
    const value = candidate as { entries?: unknown; reason?: unknown }
    if (!Array.isArray(value.entries)) continue

    const entries = value.entries
      .map((entry) => canonicalEntry(entry, taxonomy))
      .filter((entry): entry is TaxonomyDuplicateEntry => entry !== null)
      .filter(
        (entry, index, all) =>
          all.findIndex(
            (other) => other.category === entry.category && other.theme === entry.theme
          ) === index
      )
    if (entries.length < 2) continue

    groups.push({
      entries,
      reason: typeof value.reason === 'string' ? value.reason.trim().slice(0, 500) : '',
    })
  }

  return groups
}

/** Analyse la taxonomie visible sans jamais proposer ni appliquer une écriture. */
@inject()
export default class LeitnerTaxonomyDuplicatesService {
  constructor(
    private llm: LlmClient,
    private catalog: LeitnerCatalogService
  ) {}

  async find(userId: number, isAdmin: boolean = false): Promise<TaxonomyDuplicatesResult> {
    const taxonomy = await this.catalog.visibleTaxonomy(userId, isAdmin)
    const startedAt = Date.now()

    try {
      const raw = await this.llm.complete(taxonomyDuplicateMessages(taxonomy), {
        json: true,
        temperature: 0,
        timeoutMs: TAXONOMY_DUPLICATES_TIMEOUT_MS,
      })
      const groups = parseTaxonomyDuplicateGroups(raw, taxonomy)
      if (!groups) {
        logger.warn(
          { elapsedMs: Date.now() - startedAt, raw: raw.slice(0, 300) },
          'Leitner : rapport de doublons de taxonomie illisible, repli silencieux.'
        )
        return { groups: [] }
      }
      return { groups }
    } catch (error) {
      if (error instanceof LlmUnavailableError) {
        logger.warn(
          { err: error, elapsedMs: Date.now() - startedAt },
          'Leitner : rapport de doublons de taxonomie indisponible, repli silencieux.'
        )
        return { groups: [] }
      }
      throw error
    }
  }
}
