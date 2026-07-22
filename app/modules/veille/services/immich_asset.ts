import { DateTime } from 'luxon'

/**
 * La lecture d'un asset Immich — **du code pur**, sans réseau ni base.
 *
 * Tout ce qui interprète la réponse d'Immich vit ici : c'est ce qui rend testable la partie du
 * lot où l'on peut réellement se tromper (les deux formes de durée, le tag déduit d'un nom de
 * fichier, la forme d'un asset qu'on refuse). `immich_client.ts` ne fait que du transport.
 *
 * Relevé contre une instance **v2.6.1** — voir le `CLAUDE.md` du module.
 */

/** Ce qu'un asset devient dans `veille_items.type`. */
export type MediaType = 'image' | 'video'

export type ImmichAsset = {
  /** L'UUID Immich. C'est la **seule** chose qu'on garde de l'asset : Immich possède les octets. */
  id: string
  type: MediaType
  /** Le nom d'origine, tel qu'il sert de titre. */
  fileName: string
  /** Date de prise de vue (`fileCreatedAt`). */
  takenAt: DateTime | null
  /** Durée en secondes, **vidéos seulement** — `null` sur une image, dont Immich rend `0`. */
  durationSeconds: number | null
  /** Le réseau déduit du nom de fichier, ou `null` : on ne devine jamais. */
  network: string | null
}

/**
 * Les réseaux reconnus dans un nom de fichier, et **rien d'autre**.
 *
 * ⚠️ **Liste fermée, et comparaison par jeton entier.** BlackHole et les captures d'écran Android
 * mettent souvent le réseau dans le nom (`Screenshot_20260721_105950_TikTok.jpg`, constaté sur
 * l'album réel) — mais un `includes()` sur des fragments courts étiquetterait n'importe quoi.
 * Le nom est découpé sur tout ce qui n'est pas alphanumérique, et chaque jeton est cherché ici.
 *
 * Le ticket est explicite : si le nom n'est pas exploitable, **on ne devine pas**. Pas de repli,
 * pas de correspondance approchée. Un tag faux est pire qu'un tag absent — il se retrouverait
 * dans la barre de tags et dans les filtres.
 */
const NETWORKS: Record<string, string> = {
  tiktok: 'tiktok',
  instagram: 'instagram',
  insta: 'instagram',
  youtube: 'youtube',
  shorts: 'youtube',
  twitter: 'twitter',
  reddit: 'reddit',
  facebook: 'facebook',
  snapchat: 'snapchat',
  linkedin: 'linkedin',
  threads: 'threads',
  pinterest: 'pinterest',
  twitch: 'twitch',
  vimeo: 'vimeo',
  dailymotion: 'dailymotion',
  mastodon: 'mastodon',
  bluesky: 'bluesky',
}

/**
 * ⚠️ **`x` (Twitter) n'est volontairement pas dans la liste.** Un jeton d'une lettre apparaît dans
 * quantité de noms de fichiers (`IMG_x2`, `video-x`), et le tag serait faux la plupart du temps.
 * `twitter` reste reconnu ; le reste n'est pas devinable depuis un nom de fichier.
 */
export function networkTagFor(fileName: string): string | null {
  for (const token of fileName.toLowerCase().split(/[^a-z0-9]+/)) {
    const network = NETWORKS[token]
    if (network) return network
  }
  return null
}

/**
 * La durée d'Immich, `null` si elle ne dit rien.
 *
 * ⚠️ **Deux formes coexistent**, relevées sur l'instance : `"00:01:04.362"` sur une vidéo et
 * `"0:00:00.00000"` sur une image — heures sur un ou deux chiffres, fraction de longueur libre.
 * Une regex trop stricte lirait `null` sur la moitié des assets, et la durée disparaîtrait sans
 * qu'aucune erreur ne le signale.
 *
 * Une durée nulle rend `null` : Immich écrit `0` sur toutes les images, et « 0 s » affiché sous
 * une photo serait une mesure là où il n'y a rien à mesurer.
 */
export function parseDurationSeconds(raw: unknown): number | null {
  if (typeof raw !== 'string') return null

  const parts = raw.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?$/)
  if (!parts) return null

  const [hours, minutes, seconds] = parts.slice(1, 4).map(Number)
  const total = hours * 3600 + minutes * 60 + seconds

  return total > 0 ? total : null
}

/**
 * L'UUID d'Immich, vérifié pour sa **forme**.
 *
 * ⚠️ Ce contrôle est une défense en profondeur, pas la garantie principale : l'identifiant finit
 * dans un chemin d'URL (`/api/assets/<id>/thumbnail`), et un identifiant fantaisiste y ferait de
 * la traversée de chemin. La garantie réelle est ailleurs — le proxy de vignette relit l'UUID
 * **depuis notre base**, jamais depuis la requête. Celui-ci garantit qu'un identifiant malformé
 * n'entre pas en base au départ, et donc que les deux bouts tiennent.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isImmichAssetId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

/** Le préfixe de la clé de dédup, comme `url:` / `guid:` / `title:` côté flux. */
const DEDUP_PREFIX = 'immich:'

/**
 * La clé de déduplication d'un asset.
 *
 * L'UUID d'Immich est unique dans l'instance : contrairement au `guid` d'un flux, il n'a pas
 * besoin d'être cadré par sa source. Le préfixe le distingue d'une URL d'article.
 *
 * ⚠️ **Cette clé est aussi l'index d'autorisation du proxy de vignette** : `dedup_key` est déjà
 * sous index UNIQUE, ce qui donne une recherche exacte et indexée pour « cet asset fait-il partie
 * de la veille ? ». Si un jour un second module référence des assets Immich, c'est là qu'il faudra
 * une colonne dédiée plutôt qu'un second préfixe.
 */
export function immichDedupKey(assetId: string): string {
  return `${DEDUP_PREFIX}${assetId}`
}

/** L'UUID porté par une clé de dédup Immich, ou `null` si la clé n'en est pas une. */
export function assetIdFromDedupKey(key: string | null): string | null {
  if (!key || !key.startsWith(DEDUP_PREFIX)) return null

  const assetId = key.slice(DEDUP_PREFIX.length)
  return isImmichAssetId(assetId) ? assetId : null
}

/**
 * Un asset de la réponse Immich, ou `null` si on ne sait pas quoi en faire.
 *
 * ⚠️ **Un asset refusé est sauté, jamais deviné.** Immich connaît aussi `AUDIO` et `OTHER` : les
 * inventer en `image` remplirait la liste d'items dont la vignette n'existerait pas. Le compteur
 * de la passe porte donc sur les assets **retenus** — un album de fichiers audio se lira « 0 »
 * dans le bandeau d'anomalie du lot 1, ce qui est exactement le bon signal.
 */
export function parseAsset(raw: unknown): ImmichAsset | null {
  if (typeof raw !== 'object' || raw === null) return null

  const asset = raw as Record<string, unknown>
  if (!isImmichAssetId(asset.id)) return null

  const type = asset.type === 'IMAGE' ? 'image' : asset.type === 'VIDEO' ? 'video' : null
  if (type === null) return null

  // Un asset sans nom d'origine reste affichable : il aura un titre neutre plutôt que rien. On
  // n'invente pas de tag pour autant — `networkTagFor` ne trouvera simplement rien.
  const fileName =
    typeof asset.originalFileName === 'string' && asset.originalFileName.trim() !== ''
      ? asset.originalFileName.trim().slice(0, 500)
      : `Asset ${asset.id.slice(0, 8)}`

  const takenAt =
    typeof asset.fileCreatedAt === 'string' ? DateTime.fromISO(asset.fileCreatedAt) : null

  return {
    id: asset.id,
    type,
    fileName,
    takenAt: takenAt?.isValid ? takenAt : null,
    // Une image porte `"0:00:00.00000"` chez Immich : `parseDurationSeconds` le rend `null`.
    durationSeconds: type === 'video' ? parseDurationSeconds(asset.duration) : null,
    network: networkTagFor(fileName),
  }
}
