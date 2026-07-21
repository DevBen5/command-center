import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import VeilleSource from '#modules/veille/models/veille_source'
import FeedFetcher from '#modules/veille/services/feed_fetcher'
import ImmichCollector from '#modules/veille/services/immich_collector'
import { dedupKeyFor, parseFeed, type ParsedEntry } from '#modules/veille/services/feed_parser'
import { insertNewItems, type NewItem } from '#modules/veille/services/veille_item_writer'

export type CollectOutcome = {
  sourceId: number
  ok: boolean
  /** Entrées reconnues dans la source. `0` sur une source qui répond bien est une anomalie. */
  found: number
  /** Entrées réellement écrites — les autres étaient déjà là. */
  inserted: number
  notModified: boolean
  /** Assets qui ont quitté l'album (Immich seulement ; toujours `0` pour un flux). */
  disappeared: number
  error: string | null
}

/** Ce qu'un collecteur rapporte avant que la source ne soit marquée. */
type SourceResult = {
  found: number
  inserted: number
  notModified: boolean
  disappeared: number
  /** Cache HTTP à mémoriser — flux seulement, et **seulement** après insertion réussie. */
  etag?: string | null
  lastModified?: string | null
}

/** Nombre de sources interrogées en même temps. Assez pour ne pas traîner, assez peu pour rester poli. */
const CONCURRENCY = 4

@inject()
export default class VeilleCollectorService {
  constructor(
    private fetcher: FeedFetcher,
    private immich: ImmichCollector
  ) {}

  /**
   * Collecte une source. **Ne lève jamais** : une source cassée rend un `CollectOutcome` en
   * échec, elle n'interrompt pas la passe. C'est la garantie centrale du module — sans elle, un
   * seul flux mort suffit à éteindre tout l'agrégateur.
   *
   * ⚠️ **L'aiguillage sur `kind` n'est pas cosmétique** : sans lui, une source `immich` partirait
   * au `FeedFetcher`, qui irait chercher `immich:album:<uuid>` comme une URL de flux. Elle
   * échouerait à chaque passe avec un message parlant d'URL publique — un faux problème, et le
   * vrai invisible.
   */
  async collectSource(source: VeilleSource): Promise<CollectOutcome> {
    try {
      const result =
        source.kind === 'immich' ? await this.collectImmich(source) : await this.collectFeed(source)

      // ⚠️ Le marquage vient **après** l'effet, jamais avant — voir `markSuccess`.
      await this.markSuccess(source, {
        etag: result.etag,
        lastModified: result.lastModified,
        // Un 304 ne rapporte rien : on garde le compte de la dernière collecte réelle.
        itemCount: result.notModified ? undefined : result.found,
      })

      return { sourceId: source.id, ok: true, error: null, ...result }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.markFailure(source, message)

      return {
        sourceId: source.id,
        ok: false,
        found: 0,
        inserted: 0,
        notModified: false,
        disappeared: 0,
        error: message,
      }
    }
  }

  /** L'album Immich (CC-55). Tout ou rien : `ImmichCollector` lève, il ne rend rien de partiel. */
  private async collectImmich(source: VeilleSource): Promise<SourceResult> {
    const { found, inserted, disappeared } = await this.immich.collect(source)
    return { found, inserted, disappeared, notModified: false }
  }

  /** Un flux RSS 2.0 ou Atom — le collecteur du lot 1, inchangé. */
  private async collectFeed(source: VeilleSource): Promise<SourceResult> {
    const response = await this.fetcher.fetch(source.url, {
      etag: source.etag,
      lastModified: source.lastModified,
    })

    if (response.status === 'not-modified') {
      return {
        found: source.lastItemCount ?? 0,
        inserted: 0,
        notModified: true,
        disappeared: 0,
      }
    }

    const feed = await parseFeed(response.body)
    const inserted = await insertNewItems(feed.entries.map((entry) => this.toItem(source, entry)))

    return {
      found: feed.entries.length,
      inserted,
      notModified: false,
      disappeared: 0,
      // ⚠️ `etag` / `last_modified` ne remontent qu'ICI, une fois les items en base. Les mémoriser
      // dès la réponse HTTP puis échouer au parse ou à l'insert ferait recevoir un 304 à la passe
      // suivante : les entrées seraient sautées **définitivement**, le flux ne les republiera pas.
      // L'accusé de réception vient après l'effet, jamais avant.
      etag: response.etag,
      lastModified: response.lastModified,
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
          disappeared: 0,
          error: String(result.reason),
        })
      }
    }

    return outcomes
  }

  /**
   * Ce qu'une entrée de flux devient en base.
   *
   * L'écriture elle-même — et donc **toute** la déduplication — vit dans `veille_item_writer`,
   * partagé avec le collecteur Immich : deux listes de colonnes et deux `ON CONFLICT` auraient
   * fini par diverger, et une divergence sur la dédup ne se voit pas.
   */
  private toItem(source: VeilleSource, entry: ParsedEntry): NewItem {
    return {
      type: 'article',
      sourceId: source.id,
      dedupKey: dedupKeyFor(entry, source.id),
      url: entry.url,
      title: entry.title,
      content: entry.content,
      tags: [],
      metadata: { sourceTitle: source.title, guid: entry.guid },
      publishedAt: entry.publishedAt,
    }
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
