import { DateTime } from 'luxon'

/**
 * La lecture d'une vidéo YouTube — **du code pur**, sans réseau ni base.
 *
 * Tout ce qui interprète la réponse de l'API Data v3 vit ici, sur le modèle d'`immich_asset.ts` :
 * c'est la partie du lot où l'on peut réellement se tromper, et c'est donc la partie qui se teste.
 * `youtube_client.ts` ne fait que du transport.
 *
 * ⚠️ **Écrit contre la documentation de l'API Data v3, pas contre un relevé d'instance** —
 * contrairement au connecteur Immich, relevé contre une v2.6.1. La première collecte réelle
 * (CC-87) est le vrai relevé.
 */

/** Ce qu'une vidéo devient dans `veille_items.tags`. */
export const YOUTUBE_TAG = 'youtube'

export type YoutubeVideo = {
  /** L'identifiant de la vidéo. C'est la seule chose qu'on garde : YouTube possède les octets. */
  videoId: string
  title: string
  description: string
  /**
   * ⚠️ **La date de publication de la VIDÉO** (`contentDetails.videoPublishedAt`), pas celle de
   * son entrée dans la playlist. Voir `addedToPlaylistAt` — les confondre est le piège n° 1 de
   * cette API, et il est parfaitement silencieux.
   */
  publishedAt: DateTime | null
  /**
   * ⚠️ **La date d'AJOUT à la playlist** (`snippet.publishedAt`). Le nom que l'API donne à ce
   * champ est trompeur : sur un `playlistItem`, `snippet.publishedAt` est la date à laquelle
   * l'entrée a été créée dans la liste, jamais celle de la vidéo.
   *
   * Les deux sont exposées parce que **le choix appartient au collecteur** (CC-87) : trier une
   * file de veille par date d'ajout ou par date de publication ne donne pas le même écran, et ce
   * n'est pas au parseur d'en décider.
   */
  addedToPlaylistAt: DateTime | null
  /**
   * ⚠️ **`videoOwnerChannelTitle`, jamais `snippet.channelTitle`** : le second est la chaîne
   * **propriétaire de la playlist**, donc la nôtre. Le confondre ferait afficher notre propre nom
   * de chaîne sous chaque vidéo, sans qu'aucune erreur ne le signale.
   */
  channelTitle: string | null
  /** L'URL de miniature la plus large disponible, ou `null` si l'API n'en propose aucune. */
  thumbnailUrl: string | null
  /**
   * Renseignée par un second appel (`videos.list`) : `playlistItems.list` ne rend pas les durées.
   * `null` tant que ce second appel n'a pas eu lieu, ou sur un direct.
   */
  durationSeconds: number | null
}

/**
 * L'identifiant d'une vidéo YouTube, vérifié pour sa **forme**.
 *
 * ⚠️ Ce contrôle est une défense en profondeur, comme `isImmichAssetId`. L'identifiant finit dans
 * un paramètre de requête et dans une URL de miniature (`i.ytimg.com/vi/<id>/…`) : un identifiant
 * fantaisiste y ferait de l'injection de chemin. Onze caractères de l'alphabet base64url — c'est
 * la forme stable des identifiants de vidéo depuis l'origine de l'API.
 */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

export function isYoutubeVideoId(value: unknown): value is string {
  return typeof value === 'string' && VIDEO_ID.test(value)
}

/** Le préfixe de la clé de dédup, comme `url:` / `guid:` / `title:` / `immich:`. */
const DEDUP_PREFIX = 'youtube:'

/**
 * La clé de déduplication d'une vidéo.
 *
 * L'identifiant est unique dans tout YouTube : comme l'UUID d'Immich et contrairement au `guid`
 * d'un flux, il n'a pas besoin d'être cadré par sa source. Le préfixe le distingue d'une URL
 * d'article — et **c'est aussi lui qui aiguillera le proxy de vignette** (CC-88), qui route selon
 * le préfixe du `dedup_key`.
 */
export function youtubeDedupKey(videoId: string): string {
  return `${DEDUP_PREFIX}${videoId}`
}

/** L'identifiant porté par une clé de dédup YouTube, ou `null` si la clé n'en est pas une. */
export function videoIdFromDedupKey(key: string | null): string | null {
  if (!key || !key.startsWith(DEDUP_PREFIX)) return null

  const videoId = key.slice(DEDUP_PREFIX.length)
  return isYoutubeVideoId(videoId) ? videoId : null
}

/**
 * La durée ISO 8601 de `contentDetails.duration`, en secondes — `null` si elle ne dit rien.
 *
 * ⚠️ **Les jours existent** (`P1DT2H`) : une conférence de plus de 24 h les emploie, et une regex
 * qui ne lirait que `PT#H#M#S` rendrait `null` dessus. La durée disparaîtrait sans qu'aucune
 * erreur ne le signale — même mode d'échec que les deux formes de durée d'Immich.
 *
 * ⚠️ **Un direct et une vidéo à venir rendent `P0D`**, soit zéro seconde. On rend `null` plutôt
 * que `0`, exactement comme `parseDurationSeconds` d'Immich sur les images : « 0 s » affiché sous
 * une vidéo serait une mesure là où il n'y a rien à mesurer.
 *
 * Les composantes de date au-delà du jour (`P1M`, `P1Y`) ne sont pas lues : l'API ne les emploie
 * pas pour une durée de vidéo, et un mois n'a pas de longueur fixe — les convertir serait inventer.
 */
export function parseDurationSeconds(raw: unknown): number | null {
  if (typeof raw !== 'string') return null

  const parts = raw.trim().match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/)
  if (!parts) return null

  const [days, hours, minutes, seconds] = parts.slice(1, 5).map((v) => (v ? Number(v) : 0))
  const total = days * 86_400 + hours * 3_600 + minutes * 60 + seconds

  return total > 0 ? total : null
}

/**
 * L'URL de miniature la plus large que l'API propose.
 *
 * ⚠️ **L'ordre n'est pas décoratif, et le repli n'est pas facultatif.** `maxres` n'existe que
 * pour les vidéos téléversées en HD, `standard` manque sur les plus anciennes ; seules `default`
 * et `medium` sont toujours là. Prendre `maxres` sans repli laisserait sans vignette une part des
 * vidéos, et l'écran afficherait une image cassée sans dire pourquoi.
 */
const THUMBNAIL_PREFERENCE = ['maxres', 'standard', 'high', 'medium', 'default'] as const

export function bestThumbnailUrl(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null

  const thumbnails = raw as Record<string, unknown>

  for (const size of THUMBNAIL_PREFERENCE) {
    const candidate = thumbnails[size]
    if (typeof candidate !== 'object' || candidate === null) continue

    const url = (candidate as Record<string, unknown>).url
    // ⚠️ `https` exigé, pas seulement « une chaîne » : cette URL est destinée à être servie au
    // navigateur (CC-88), et une valeur inattendue n'a pas à y arriver.
    if (typeof url === 'string' && url.startsWith('https://')) return url
  }

  return null
}

/**
 * Les statuts de confidentialité dont on sait qu'ils désignent une vidéo lisible.
 *
 * ⚠️ **Une playlist conserve ses vidéos supprimées et privées.** L'API rend alors une entrée
 * complète, titrée « Deleted video » ou « Private video », avec un `privacyStatus` qui n'est plus
 * `public`/`unlisted` — le plus souvent `privacyStatusUnspecified`. Sans ce filtre, la veille se
 * remplirait d'items sans miniature et sans rien à ouvrir, et rien à l'écran ne dirait pourquoi.
 *
 * Liste **fermée**, comme celle des réseaux d'`immich_asset.ts` : ce qui n'est pas reconnu est
 * sauté, jamais deviné.
 */
const READABLE_PRIVACY = new Set(['public', 'unlisted'])

/**
 * Une entrée de `playlistItems.list`, ou `null` si on ne sait pas quoi en faire.
 *
 * ⚠️ **Une entrée refusée est sautée, jamais devinée** — même règle que `parseAsset` pour les
 * types `AUDIO` et `OTHER` d'Immich. Le compteur de la passe porte donc sur les vidéos
 * **retenues** : une playlist entièrement faite de vidéos supprimées se lira « 0 » dans le
 * bandeau d'anomalie, ce qui est exactement le bon signal.
 */
export function parseVideo(raw: unknown): YoutubeVideo | null {
  if (typeof raw !== 'object' || raw === null) return null

  const item = raw as Record<string, unknown>
  const snippet = asRecord(item.snippet)
  const contentDetails = asRecord(item.contentDetails)
  const status = asRecord(item.status)

  // ⚠️ `contentDetails.videoId` d'abord : c'est le champ documenté comme portant l'identifiant de
  // la vidéo. `snippet.resourceId.videoId` porte la même valeur et sert de repli, au cas où la
  // partie `contentDetails` n'aurait pas été demandée.
  const resourceId = asRecord(snippet.resourceId)
  const videoId = isYoutubeVideoId(contentDetails.videoId)
    ? contentDetails.videoId
    : isYoutubeVideoId(resourceId.videoId)
      ? resourceId.videoId
      : null
  if (videoId === null) return null

  // Une vidéo supprimée ou passée en privé garde son entrée dans la playlist : on la saute.
  const privacyStatus = status.privacyStatus
  if (typeof privacyStatus === 'string' && !READABLE_PRIVACY.has(privacyStatus)) return null

  const title =
    typeof snippet.title === 'string' && snippet.title.trim() !== ''
      ? snippet.title.trim().slice(0, 500)
      : `Vidéo ${videoId}`

  return {
    videoId,
    title,
    description: typeof snippet.description === 'string' ? snippet.description.trim() : '',
    publishedAt: parseDate(contentDetails.videoPublishedAt),
    addedToPlaylistAt: parseDate(snippet.publishedAt),
    channelTitle:
      typeof snippet.videoOwnerChannelTitle === 'string' &&
      snippet.videoOwnerChannelTitle.trim() !== ''
        ? snippet.videoOwnerChannelTitle.trim()
        : null,
    thumbnailUrl: bestThumbnailUrl(snippet.thumbnails),
    // Renseignée par `videos.list`, jamais par cette réponse-ci.
    durationSeconds: null,
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function parseDate(value: unknown): DateTime | null {
  if (typeof value !== 'string') return null

  const parsed = DateTime.fromISO(value)
  return parsed.isValid ? parsed : null
}
