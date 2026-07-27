/**
 * La logique média de `pages/index.vue` — **du code pur**, sorti du `<script setup>` (CC-60).
 *
 * Japa importe des `.ts` et n'a aucun compilateur Vue : ce qui vit dans un `<script setup>` est
 * **structurellement** hors de portée de la suite. Ces fonctions décident (un lien, un libellé,
 * un prédicat), elles vivent donc ici et la page n'en garde que des enveloppes d'une ligne.
 *
 * ⚠️ **Aucun import par alias `#modules/*` dans ce fichier.** L'alias mappe vers
 * `./app/modules/*.js`, qui n'existe qu'après un build : Vite ne le résout pas et la page casse.
 * D'où les types structurels ci-dessous plutôt qu'un import du modèle. Le garde-fou est
 * `npm run build` — `tsc` ne lit pas les `.vue` et ne peut pas le dire.
 */

/** Ce qu'est l'item. Recopié structurellement : voir l'avertissement sur les alias. */
export type ItemType = 'article' | 'bookmark' | 'note' | 'image' | 'video'

/** Le minimum que ces fonctions ont besoin de connaître d'un item. */
export type MediaItemView = {
  id: number
  type: ItemType
  immichAssetId: string | null
  /** Nul pour un média Immich, l'URL canonique `watch?v=…` pour une vidéo YouTube (CC-87). */
  url: string | null
  metadata: Record<string, unknown> | null
}

/** Un média porte une vignette et un lien de lecture ; un article porte une URL. */
export function isMediaItem(type: ItemType): boolean {
  return type === 'image' || type === 'video'
}

/**
 * La vignette passe par **notre** proxy, jamais par Immich directement.
 *
 * Immich exige la clé d'API pour servir une vignette, et cette clé ne descend jamais au
 * navigateur : un `<img src>` pointant sur Immich supposerait de la lui donner. Le paramètre est
 * l'id d'item — pas l'identifiant Immich, qui ferait de la route un proxy ouvert sur toute la
 * bibliothèque personnelle. Voir `VeilleMediaController`.
 */
export function thumbnailHref(itemId: number): string {
  return `/veille/items/${itemId}/thumbnail`
}

/**
 * Le lien qui ouvre l'asset dans Immich.
 *
 * ⚠️ **Construit à l'affichage, jamais stocké.** `veille_items.url` reste nul pour un média :
 * une URL figée en base pointerait sur l'ancien domaine le jour d'un déménagement d'instance, et
 * tous les liens casseraient en silence. Ici, changer `IMMICH_BASE_URL` suffit.
 *
 * ⚠️ **`/photos/<id>` est la seule chose de ce lot qui n'ait pas pu être vérifiée par l'API.**
 * Immich sert son interface en repli sur *tout* chemin inconnu, avec un 200 et un corps
 * identique : aucune requête ne distingue une route web valide d'une route morte. Ça se vérifie
 * au navigateur, en cliquant une vignette — et nulle part ailleurs.
 */
export function immichHref(webBaseUrl: string | null, assetId: string | null): string | null {
  if (!webBaseUrl || !assetId) return null
  return `${webBaseUrl}/photos/${assetId}`
}

/**
 * Le lien qui ouvre un média — Immich s'il en vient, son URL sinon (CC-88).
 *
 * ⚠️ **Sans ce repli, une vidéo YouTube n'a aucun lien cliquable.** `isMediaItem` répond vrai
 * pour un `type: 'video'` quelle que soit sa provenance, et la page demandait jusqu'ici un lien
 * Immich — donc `null` pour tout ce qui vient d'ailleurs, puisque l'`immichAssetId` est tiré d'un
 * `dedup_key` préfixé `immich:`. La vignette s'affichait, et rien ne s'ouvrait au clic.
 *
 * ⚠️ **L'ordre compte, et il ne s'inverse pas.** Immich d'abord : ses items ont une `url` nulle
 * par conception (le lien se construit à l'affichage, voir `immichHref`), donc le repli ne peut
 * pas leur voler leur lien. Un item YouTube, lui, n'a pas d'`immichAssetId` — chacun tombe dans sa
 * branche sans que l'autre ait à le savoir.
 */
export function mediaHref(webBaseUrl: string | null, item: MediaItemView): string | null {
  return immichHref(webBaseUrl, item.immichAssetId) ?? item.url
}

/**
 * La durée écrite par la collecte, si elle en a écrit une.
 *
 * `metadata` est du `jsonb` : ce qu'il contient dépend de la version qui a écrit la ligne. Un
 * accès défensif plutôt qu'un cast — un item collecté avant ce lot n'a tout simplement pas le
 * champ, et la page ne doit pas s'en émouvoir.
 */
export function durationSecondsOf(metadata: Record<string, unknown> | null): number | null {
  const raw = metadata?.durationSeconds
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null
}

/**
 * La chaîne qui a mis la vidéo en ligne, si la collecte l'a écrite (CC-103).
 *
 * ⚠️ **C'est bien la chaîne de la VIDÉO, pas celle de la playlist.** `youtube_asset.ts` la lit
 * dans `videoOwnerChannelTitle` et non dans `snippet.channelTitle`, qui rend le propriétaire de la
 * playlist — donc nous. Le relevé réel de CC-84 l'a confirmé sur quatre vidéos ; ce libellé est ce
 * qui rend ce piège **visible à l'écran** plutôt que constatable en base.
 *
 * ⚠️ **`null` plutôt qu'une chaîne vide, et ça n'est pas un détail de style** : la page suspend le
 * séparateur au même `v-if` que le nom. Rendre `''` afficherait une puce sans rien après.
 *
 * Accès défensif, comme `durationSecondsOf` : `metadata` est du `jsonb`, son contenu dépend de la
 * version qui a écrit la ligne. Un item Immich n'a pas ce champ, un item collecté avant CC-87 non
 * plus, et une ligne éditée à la main peut y porter n'importe quoi.
 */
export function channelLabel(metadata: Record<string, unknown> | null): string | null {
  const raw = metadata?.channelTitle
  if (typeof raw !== 'string') return null

  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * `1:04`, `12:03`, `1:02:03`.
 *
 * Les secondes sont **toujours** sur deux chiffres, les minutes seulement au-delà de l'heure :
 * c'est la convention de tous les lecteurs vidéo, et `1:4` se lirait comme une erreur.
 * Rend `null` quand il n'y a rien à afficher — une image n'a pas de durée, et « 0:00 » sous une
 * photo serait une mesure là où il n'y a rien à mesurer.
 */
export function durationLabel(metadata: Record<string, unknown> | null): string | null {
  const total = durationSecondsOf(metadata)
  if (total === null) return null

  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60

  const paddedSeconds = String(seconds).padStart(2, '0')
  if (hours === 0) return `${minutes}:${paddedSeconds}`

  return `${hours}:${String(minutes).padStart(2, '0')}:${paddedSeconds}`
}
