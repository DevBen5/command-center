import youtubeConfig, { type YoutubeConfig } from '#config/youtube'
import {
  parseDurationSeconds,
  parseVideo,
  type YoutubeVideo,
} from '#modules/veille/services/youtube_asset'

/** YouTube ne répond pas, refuse de répondre, ou répond quelque chose qu'on refuse de lire. */
export class YoutubeUnavailableError extends Error {}

const API_BASE = 'https://www.googleapis.com/youtube/v3'

/**
 * ⚠️ **50 est le plafond de l'API, pas un réglage.** `playlistItems.list` et `videos.list`
 * ignorent silencieusement un `maxResults` supérieur et rendent 50 : demander 200 ferait croire à
 * une playlist tronquée alors que c'est la pagination qui n'a pas été suivie.
 */
const PAGE_SIZE = 50

/**
 * ⚠️ **Le plafond de pages est un garde-fou de boucle, pas une limite de volumétrie.** Si l'API
 * rendait un `nextPageToken` qui ne fait pas avancer, la collecte tournerait indéfiniment en
 * tenant la boucle du planificateur — même raisonnement que le `MAX_PAGES` d'Immich. 40 pages =
 * 2 000 vidéos, très au-delà d'une playlist de veille : l'atteindre est un défaut, signalé comme tel.
 */
const MAX_PAGES = 40

/** Une réponse de l'API qui dépasse ça n'est pas une page de playlist : c'est un incident. */
const MAX_JSON_BYTES = 8 * 1024 * 1024

const USER_AGENT = 'command-center/1.0 (+agrégateur de veille personnel)'

/**
 * Le seul point du module qui parle à l'API YouTube.
 *
 * ⚠️ **Aucune URL ne vient jamais d'une requête HTTP.** L'endpoint est figé ici, la playlist et la
 * clé viennent de `config/youtube.ts` (donc de l'environnement), et les identifiants de vidéo
 * envoyés à `videos.list` sortent d'une réponse déjà validée par `isYoutubeVideoId`. C'est ce
 * qui remplace la liste blanche de `feed_fetcher` : il n'y a pas de cible à filtrer, il n'y a
 * qu'une cible. Même raisonnement que pour `ImmichClient`.
 *
 * **Le quota, pour que la cadence se choisisse en connaissance de cause** (CC-87) : une passe
 * coûte `2 × ceil(vidéos / 50)` unités — une par page de playlist, une par lot de durées. Sur une
 * playlist de 100 vidéos, 4 unités ; le quota par défaut d'un projet Google Cloud est de 10 000
 * par jour. Une collecte toutes les 30 minutes en consomme ~200. Il y a de la marge, mais elle
 * n'est pas infinie : un quota épuisé rend 403, et le message le nomme.
 *
 * ⚠️ **LA différence avec Immich, et elle est structurante : la clé voyage dans l'URL.** L'API
 * Data v3 ne l'accepte qu'en paramètre de requête (`?key=…`), là où Immich la met dans un en-tête
 * `x-api-key`. Conséquence directe : **aucun message d'erreur de ce fichier ne porte jamais
 * l'URL appelée**, seulement le nom de l'endpoint. `ImmichClient` compose les siens avec le
 * chemin ; recopier ce patron ici ferait atterrir la clé dans `veille_sources.last_error` —
 * écrite en base, et affichée telle quelle sur `/veille/sources`. L'invariant « la clé ne repart
 * jamais vers le client » tomberait par une porte que personne ne regarde.
 * `veille_youtube_client.spec.ts` l'asserte sur tous les chemins d'échec.
 *
 * Ce qui est bordé par ailleurs, comme pour Immich :
 *
 * 1. **Les redirections sont refusées** (`redirect: 'manual'`). Une API n'a pas de redirection
 *    légitime, et suivre un `Location` ferait sortir de l'hôte configuré — avec la clé dans
 *    l'URL, donc dans le `Referer` potentiel.
 * 2. **Le `content-type` est vérifié** avant de lire quoi que ce soit.
 * 3. **Deux plafonds**, taille et temps.
 */
export default class YoutubeClient {
  constructor(private config: YoutubeConfig = youtubeConfig) {}

  /**
   * Toutes les vidéos lisibles de la playlist de veille, durées comprises.
   *
   * ⚠️ **Tout ou rien.** La moindre page en échec fait lever : l'appelant ne reçoit **jamais** une
   * liste partielle. C'est la même propriété que `ImmichClient.albumAssets()`, et elle a la même
   * raison d'être — le collecteur en tirera un « ce qui n'est plus dans la playlist », qui se
   * calcule par différence. Une liste tronquée ferait marquer disparues des dizaines de vidéos
   * parfaitement présentes, sans qu'aucune erreur ne s'affiche.
   */
  async playlistVideos(): Promise<YoutubeVideo[]> {
    const videos: YoutubeVideo[] = []
    const seenTokens = new Set<string>()
    let pageToken: string | undefined

    for (let visited = 0; ; visited++) {
      if (visited >= MAX_PAGES) {
        throw new YoutubeUnavailableError(
          `La playlist dépasse ${MAX_PAGES} pages de ${PAGE_SIZE} vidéos : la collecte s'arrête ` +
            'là plutôt que de boucler.'
        )
      }

      const body = await this.getJson('playlistItems', {
        // `status` n'est pas décoratif : sans lui, impossible de distinguer une vidéo supprimée
        // ou passée en privé d'une vidéo lisible — la playlist garde les deux.
        part: 'snippet,contentDetails,status',
        playlistId: this.config.playlistId,
        maxResults: String(PAGE_SIZE),
        ...(pageToken ? { pageToken } : {}),
      })

      const items = body.items
      if (!Array.isArray(items)) {
        throw new YoutubeUnavailableError(
          "La réponse de playlistItems ne porte pas de liste « items » : l'API a probablement changé."
        )
      }

      for (const raw of items) {
        // Une entrée illisible (vidéo supprimée, identifiant malformé) est sautée, jamais devinée.
        const video = parseVideo(raw)
        if (video) videos.push(video)
      }

      const next = body.nextPageToken
      if (next === undefined || next === null) break

      if (typeof next !== 'string' || next === '') {
        throw new YoutubeUnavailableError(
          'playlistItems annonce une page suivante illisible : la pagination est interrompue.'
        )
      }

      /**
       * ⚠️ **Un jeton déjà vu ne fait pas avancer.** Le plafond de pages seul finirait par
       * arrêter la boucle, mais après 40 requêtes inutiles et en accusant la taille de la
       * playlist. Détecter la répétition dit la vraie cause, et coûte un `Set`.
       */
      if (seenTokens.has(next)) {
        throw new YoutubeUnavailableError(
          'playlistItems rend deux fois le même jeton de page : la pagination ne progresse pas.'
        )
      }
      seenTokens.add(next)
      pageToken = next
    }

    await this.fillDurations(videos)

    return videos
  }

  /**
   * Les durées, par lots de 50 — `playlistItems.list` ne les rend pas.
   *
   * ⚠️ **L'appariement se fait par identifiant, jamais par position.** `videos.list` rend
   * **moins** d'éléments qu'on en demande dès qu'un identifiant est indisponible, sans trou ni
   * marqueur pour le signaler. Apparier par index attribuerait la durée d'une vidéo à une autre,
   * et décalerait toutes les suivantes : une corruption parfaitement silencieuse, qui ne se
   * verrait qu'à l'œil, vidéo par vidéo.
   */
  private async fillDurations(videos: YoutubeVideo[]): Promise<void> {
    const byId = new Map(videos.map((video) => [video.videoId, video]))

    for (let start = 0; start < videos.length; start += PAGE_SIZE) {
      const batch = videos.slice(start, start + PAGE_SIZE)

      const body = await this.getJson('videos', {
        part: 'contentDetails',
        id: batch.map((video) => video.videoId).join(','),
        maxResults: String(PAGE_SIZE),
      })

      const items = body.items
      if (!Array.isArray(items)) {
        throw new YoutubeUnavailableError(
          "La réponse de videos ne porte pas de liste « items » : l'API a probablement changé."
        )
      }

      for (const raw of items) {
        if (typeof raw !== 'object' || raw === null) continue

        const item = raw as Record<string, unknown>
        const video = typeof item.id === 'string' ? byId.get(item.id) : undefined
        if (!video) continue

        const details = item.contentDetails
        if (typeof details !== 'object' || details === null) continue

        video.durationSeconds = parseDurationSeconds((details as Record<string, unknown>).duration)
      }
    }
  }

  private async getJson(
    endpoint: 'playlistItems' | 'videos',
    params: Record<string, string>
  ): Promise<Record<string, unknown>> {
    if (!this.config.enabled) {
      throw new YoutubeUnavailableError(
        "YouTube n'est pas configuré : YOUTUBE_API_KEY et YOUTUBE_PLAYLIST_ID doivent être " +
          "définies dans l'environnement."
      )
    }

    const query = new URLSearchParams({ ...params, key: this.config.apiKey })

    let response: Response
    try {
      response = await fetch(`${API_BASE}/${endpoint}?${query.toString()}`, {
        method: 'GET',
        headers: { 'accept': 'application/json', 'user-agent': USER_AGENT },
        // ⚠️ Le défaut d'undici est `follow` (20 sauts, sans vérification) : ce choix s'écrit, il
        // ne s'hérite pas. Une API n'a aucune redirection légitime, et la suivre ferait sortir de
        // l'hôte figé — en emportant la clé, qui est dans l'URL.
        redirect: 'manual',
        signal: AbortSignal.timeout(this.config.timeoutMs),
      })
    } catch {
      // ⚠️ L'erreur d'origine n'est pas recopiée : undici met l'URL demandée dans certains de ses
      // messages, et cette URL porte la clé.
      throw new YoutubeUnavailableError(
        `L'API YouTube est injoignable ou n'a pas répondu en moins de ` +
          `${this.config.timeoutMs / 1000} s (${endpoint}).`
      )
    }

    if (response.status >= 300 && response.status < 400) {
      await this.drain(response)
      throw new YoutubeUnavailableError(
        `L'API YouTube redirige (${response.status}) sur ${endpoint} : la redirection n'est pas suivie.`
      )
    }

    return this.readJson(response, endpoint)
  }

  /**
   * Lit une réponse d'API — et vérifie **avant tout** que c'en est une.
   *
   * L'ordre compte : le statut d'abord, puis le `content-type`. Un 200 dans un autre type est le
   * cas vicieux — le serveur a répondu, et il a l'air content. C'est ce qui a mordu sur Immich ;
   * il n'y a pas de raison de l'apprendre deux fois.
   */
  private async readJson(response: Response, endpoint: string): Promise<Record<string, unknown>> {
    if (!response.ok) {
      /**
       * ⚠️ **Quota épuisé et clé invalide rendent tous les deux 403, et appellent deux gestes
       * opposés** : attendre le lendemain, ou corriger `.env`. Google range la vraie cause dans
       * `error.errors[0].reason` — on n'en extrait que ce champ. Le corps n'est **jamais**
       * recopié brut : il est composé par un tiers, et il finirait affiché sur `/veille/sources`.
       */
      const reason = await this.errorReason(response)
      const piste = reason ? ` (${reason})` : ''

      throw new YoutubeUnavailableError(
        `L'API YouTube a répondu ${response.status} sur ${endpoint}${piste}. ⚠️ Une playlist ` +
          'inconnue, une clé invalide et un quota épuisé se ressemblent : vérifie ' +
          'YOUTUBE_PLAYLIST_ID, puis la clé, puis le quota du jour.'
      )
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) {
      await this.drain(response)
      throw new YoutubeUnavailableError(
        `L'API YouTube a répondu « ${contentType || 'aucun type'} » au lieu de JSON sur ` +
          `${endpoint} : la route a probablement changé.`
      )
    }

    const bytes = await this.readBounded(response)
    const raw = bytes.toString('utf8')

    try {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null) {
        throw new TypeError("la réponse JSON n'est pas un objet")
      }
      return parsed as Record<string, unknown>
    } catch (error) {
      throw new YoutubeUnavailableError(
        `La réponse de ${endpoint} est annoncée en JSON mais ne se lit pas : ` +
          `${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /** Le `reason` de Google, et rien d'autre — jamais le corps, jamais l'URL. */
  private async errorReason(response: Response): Promise<string | null> {
    try {
      const bytes = await this.readBounded(response)
      const body: unknown = JSON.parse(bytes.toString('utf8'))
      if (typeof body !== 'object' || body === null) return null

      const error = (body as Record<string, unknown>).error
      if (typeof error !== 'object' || error === null) return null

      const errors = (error as Record<string, unknown>).errors
      if (!Array.isArray(errors) || errors.length === 0) return null

      const first = errors[0]
      if (typeof first !== 'object' || first === null) return null

      const reason = (first as Record<string, unknown>).reason
      // Borné : c'est une chaîne venue d'un tiers, et elle finira sur un écran.
      return typeof reason === 'string' ? reason.slice(0, 80) : null
    } catch {
      // Un corps d'erreur illisible n'est pas une raison d'en fabriquer une : on n'ajoute rien au
      // message, le statut suffit.
      return null
    }
  }

  /**
   * Libère la connexion quand on ne lira pas le corps. Tant qu'un corps n'est pas drainé, undici
   * garde la connexion dans son pool — et les réponses qu'on ne lit pas sont les plus fréquentes
   * sur les chemins d'échec.
   */
  private async drain(response: Response): Promise<void> {
    try {
      await response.body?.cancel()
    } catch {
      /* déjà fermé ou interrompu : rien à libérer */
    }
  }

  /** Lit le corps sans jamais dépasser le plafond — on compte les octets réellement reçus. */
  private async readBounded(response: Response): Promise<Buffer> {
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) {
      await this.drain(response)
      throw new YoutubeUnavailableError(
        `L'API YouTube annonce ${Math.round(declared / 1024 / 1024)} Mo, au-delà du plafond de ` +
          `${Math.round(MAX_JSON_BYTES / 1024 / 1024)} Mo : la réponse n'est pas lue.`
      )
    }

    const reader = response.body?.getReader()
    if (!reader) return Buffer.alloc(0)

    const chunks: Uint8Array[] = []
    let total = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      total += value.byteLength
      if (total > MAX_JSON_BYTES) {
        await reader.cancel()
        throw new YoutubeUnavailableError(
          `La réponse de l'API YouTube dépasse ${Math.round(MAX_JSON_BYTES / 1024 / 1024)} Mo : ` +
            'la lecture est interrompue.'
        )
      }
      chunks.push(value)
    }

    return Buffer.concat(chunks)
  }
}
