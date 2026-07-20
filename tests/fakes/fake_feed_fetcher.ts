import FeedFetcher, {
  FeedUnavailableError,
  type ConditionalHeaders,
  type FeedResponse,
} from '#modules/veille/services/feed_fetcher'

/** Ce qu'une URL renvoie : une réponse, une erreur à lever, ou une fonction qui décide. */
export type FeedScript =
  | FeedResponse
  | Error
  | ((conditional: ConditionalHeaders, call: number) => FeedResponse | Promise<FeedResponse>)

/**
 * Le faux fetcher : **aucun test ne touche le réseau**, comme le faux client LLM du module
 * Leitner. Il hérite du vrai pour être substituable au type sans interface séparée.
 *
 * Une URL absente du script lève — un test qui interroge une source qu'il n'a pas prévue doit
 * le savoir, pas récupérer un flux vide qui ressemblerait à un succès.
 */
export default class FakeFeedFetcher extends FeedFetcher {
  /** Les appels reçus, dans l'ordre. Permet d'asserter *ce qui a été demandé* (dont l'`etag`). */
  readonly calls: { url: string; conditional: ConditionalHeaders }[] = []

  constructor(private script: Record<string, FeedScript>) {
    super()
  }

  async fetch(feedUrl: string, conditional: ConditionalHeaders = {}): Promise<FeedResponse> {
    const call = this.calls.filter((entry) => entry.url === feedUrl).length
    this.calls.push({ url: feedUrl, conditional })

    const scripted = this.script[feedUrl]

    if (scripted === undefined) {
      throw new FeedUnavailableError(`Aucune réponse scriptée pour ${feedUrl}.`)
    }
    if (scripted instanceof Error) throw scripted
    if (typeof scripted === 'function') return scripted(conditional, call)

    return scripted
  }
}

/** Raccourci : une réponse 200 portant ce corps. */
export function ok(body: string, headers: { etag?: string; lastModified?: string } = {}) {
  return {
    status: 'ok' as const,
    body,
    etag: headers.etag ?? null,
    lastModified: headers.lastModified ?? null,
  }
}
