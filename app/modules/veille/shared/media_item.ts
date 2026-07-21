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
