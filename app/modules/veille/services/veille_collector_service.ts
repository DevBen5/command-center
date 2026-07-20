import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import VeilleSource from '#modules/veille/models/veille_source'
import FeedFetcher from '#modules/veille/services/feed_fetcher'
import { dedupKeyFor, parseFeed, type ParsedEntry } from '#modules/veille/services/feed_parser'

export type CollectOutcome = {
  sourceId: number
  ok: boolean
  /** Entrées reconnues dans le flux. `0` sur un flux qui répond bien est une anomalie. */
  found: number
  /** Entrées réellement écrites — les autres étaient déjà là. */
  inserted: number
  notModified: boolean
  error: string | null
}

/** Nombre de flux interrogés en même temps. Assez pour ne pas traîner, assez peu pour rester poli. */
const CONCURRENCY = 4

/**
 * Les colonnes écrites par la collecte. Littéral figé dans le code — **jamais** une entrée
 * utilisateur : c'est ce qui rend l'interpolation ci-dessous sûre. Les valeurs, elles, passent
 * toutes par des bindings.
 */
const INSERT_COLUMNS = [
  'type',
  'veille_source_id',
  'dedup_key',
  'url',
  'title',
  'content',
  'tags',
  'metadata',
  'reading_queue',
  'published_at',
  'created_at',
  'updated_at',
] as const

@inject()
export default class VeilleCollectorService {
  constructor(private fetcher: FeedFetcher) {}

  /**
   * Collecte une source. **Ne lève jamais** : un flux cassé rend un `CollectOutcome` en échec,
   * il n'interrompt pas la passe. C'est la garantie centrale du lot — sans elle, un seul flux
   * mort suffit à éteindre tout l'agrégateur.
   */
  async collectSource(source: VeilleSource): Promise<CollectOutcome> {
    try {
      const response = await this.fetcher.fetch(source.url, {
        etag: source.etag,
        lastModified: source.lastModified,
      })

      if (response.status === 'not-modified') {
        await this.markSuccess(source, {})
        return {
          sourceId: source.id,
          ok: true,
          found: source.lastItemCount ?? 0,
          inserted: 0,
          notModified: true,
          error: null,
        }
      }

      const feed = await parseFeed(response.body)
      const inserted = await this.insertEntries(source, feed.entries)

      // ⚠️ `etag` / `last_modified` ne sont écrits qu'ICI, une fois les items en base.
      // Les mémoriser dès la réponse HTTP puis échouer au parse ou à l'insert ferait recevoir
      // un 304 à la passe suivante : les entrées seraient sautées **définitivement**, le flux
      // ne les republiera pas. L'accusé de réception vient après l'effet, jamais avant.
      await this.markSuccess(source, {
        etag: response.etag,
        lastModified: response.lastModified,
        itemCount: feed.entries.length,
      })

      return {
        sourceId: source.id,
        ok: true,
        found: feed.entries.length,
        inserted,
        notModified: false,
        error: null,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.markFailure(source, message)

      return {
        sourceId: source.id,
        ok: false,
        found: 0,
        inserted: 0,
        notModified: false,
        error: message,
      }
    }
  }

  /**
   * Collecte les sources dues. `Promise.allSettled` par vagues : un flux qui pend n'empêche pas
   * les autres d'aboutir, et `collectSource` ne lève de toute façon pas.
   */
  async collectDue(now: DateTime = DateTime.now()): Promise<CollectOutcome[]> {
    const sources = await VeilleSource.query().where('active', true)
    return this.collect(sources.filter((source) => source.isDue(now)))
  }

  /** Collecte toutes les sources actives, cadence ignorée — le bouton « tout rafraîchir ». */
  async collectAll(): Promise<CollectOutcome[]> {
    return this.collect(await VeilleSource.query().where('active', true))
  }

  private async collect(sources: VeilleSource[]): Promise<CollectOutcome[]> {
    const outcomes: CollectOutcome[] = []

    for (let start = 0; start < sources.length; start += CONCURRENCY) {
      const wave = sources.slice(start, start + CONCURRENCY)
      const settled = await Promise.allSettled(wave.map((source) => this.collectSource(source)))

      for (const [index, result] of settled.entries()) {
        if (result.status === 'fulfilled') {
          outcomes.push(result.value)
          continue
        }
        // `collectSource` ne lève pas — sauf si l'écriture de l'échec a elle-même lâché
        // (base coupée). Il ne reste que la trace en mémoire, mais surtout pas le silence.
        outcomes.push({
          sourceId: wave[index].id,
          ok: false,
          found: 0,
          inserted: 0,
          notModified: false,
          error: String(result.reason),
        })
      }
    }

    return outcomes
  }

  /**
   * Écrit les entrées, sans doublon.
   *
   * Deux niveaux, et les deux sont nécessaires :
   * - le `Set` élimine les répétitions **à l'intérieur d'une même passe** (un flux qui liste
   *   deux fois la même entrée) ;
   * - `ON CONFLICT DO NOTHING` tranche **contre la base**, y compris entre deux collectes
   *   concurrentes — un rafraîchissement manuel pendant un tick automatique. Un simple `if`
   *   applicatif ne les couvrirait pas : les deux lisent avant que l'une n'écrive.
   */
  private async insertEntries(source: VeilleSource, entries: ParsedEntry[]): Promise<number> {
    const now = DateTime.now().toSQL()
    const seen = new Set<string>()
    const rows: unknown[][] = []

    for (const entry of entries) {
      const key = dedupKeyFor(entry, source.id)
      if (seen.has(key)) continue
      seen.add(key)

      rows.push([
        'article',
        source.id,
        key,
        entry.url,
        entry.title,
        entry.content,
        // `tags` est un `text[]` Postgres : le driver `pg` prend le tableau JS tel quel.
        [],
        JSON.stringify({ sourceTitle: source.title, guid: entry.guid }),
        false,
        entry.publishedAt?.toSQL() ?? null,
        now,
        now,
      ])
    }

    if (rows.length === 0) return 0

    const placeholders = rows.map(() => `(${INSERT_COLUMNS.map(() => '?').join(', ')})`).join(', ')
    const bindings = rows.flat()

    const result = await db.rawQuery(
      `INSERT INTO veille_items (${INSERT_COLUMNS.join(', ')})
       VALUES ${placeholders}
       ON CONFLICT (dedup_key) DO NOTHING
       RETURNING id`,
      bindings
    )

    // `RETURNING` ne rend que les lignes réellement insérées : les doublons ignorés n'y sont pas.
    return result.rows.length
  }

  private async markSuccess(
    source: VeilleSource,
    changes: { etag?: string | null; lastModified?: string | null; itemCount?: number }
  ): Promise<void> {
    if (changes.etag !== undefined) source.etag = changes.etag
    if (changes.lastModified !== undefined) source.lastModified = changes.lastModified
    if (changes.itemCount !== undefined) source.lastItemCount = changes.itemCount

    source.lastFetchedAt = DateTime.now()
    source.lastError = null
    source.lastErrorAt = null

    await source.save()
  }

  private async markFailure(source: VeilleSource, message: string): Promise<void> {
    source.lastError = message
    source.lastErrorAt = DateTime.now()
    // `last_fetched_at` bouge aussi en cas d'échec : sinon la source reste éternellement « due »
    // et on martèle un serveur en panne à chaque tick.
    source.lastFetchedAt = DateTime.now()
    // `etag` / `last_modified` ne sont **pas** touchés : la prochaine passe redemandera
    // conditionnellement à partir du dernier état réellement collecté.
    await source.save()
  }
}
