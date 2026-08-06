/**
 * L'allow-list des formats de médias NAS du coffre (CC-181) — **source unique**, partagée entre le
 * validateur d'écriture (`validators/coffre.ts`) et la résolution de `content-type` en lecture
 * (`coffre_nas_controller.ts`). Une seule liste évite la dérive que CC-147 a fermée ailleurs
 * pour `MIN_PASSWORD_LENGTH` : deux définitions qui divergent sans qu'aucun test ne rougisse.
 *
 * ⚠️ **Le `content-type` est déterminé D'ICI, jamais déduit de ce que le client annonce** — c'est
 * la troisième règle du ticket. Une extension hors de cette liste ne rend rien : ni un type
 * deviné, ni `application/octet-stream` — le fichier est traité comme introuvable, même doctrine
 * que le reste du module (« illisible » n'est jamais « pas de contenu »).
 *
 * ⚠️ **Deux allow-lists, jamais une seule fusionnée sans distinction** (CC-181, amendement
 * photos) : le `kind` qui en dérive (`nasFileKindFor`) est ce qui permet à l'écran de choisir
 * `<video controls>` ou `<img>` **sans jamais lire le chemin réel**, qui ne redescend jamais vers
 * le client (voir `CoffreEntryView.nasFiles`).
 */
export const VIDEO_CONTENT_TYPES: Readonly<Record<string, string>> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
}

export const PHOTO_CONTENT_TYPES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
}

export const NAS_CONTENT_TYPES: Readonly<Record<string, string>> = {
  ...VIDEO_CONTENT_TYPES,
  ...PHOTO_CONTENT_TYPES,
}

export const NAS_EXTENSIONS = Object.keys(NAS_CONTENT_TYPES)

export type NasFileKind = 'video' | 'photo'

/** L'extension d'un chemin, en minuscules — sans le point. */
function extensionOf(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? ''
}

/**
 * Le `content-type` pour un chemin déjà résolu — `null` si l'extension n'est pas dans l'allow-list.
 *
 * ⚠️ **Défense en profondeur, pas la garde principale.** Le validateur d'écriture refuse déjà
 * toute extension hors liste ; celle-ci s'applique en plus au moment de servir, pour qu'une
 * donnée en base qui aurait échappé au validateur (migration, écriture directe) ne rende jamais un
 * type deviné.
 *
 * ⚠️ **`Object.hasOwn`, jamais un accès direct par crochets.** `NAS_CONTENT_TYPES['constructor']`
 * ne rend PAS `undefined` — il rend la fonction `Object` héritée du prototype, que `?? null`
 * laisserait passer telle quelle comme `content-type`. Un chemin dont l'extension serait
 * `constructor` ou `toString` (impossible via le validateur, mais c'est précisément ce que cette
 * défense en profondeur couvre) doit rendre `null`, pas une valeur héritée du prototype.
 */
export function nasContentTypeFor(path: string): string | null {
  const extension = extensionOf(path)
  return Object.hasOwn(NAS_CONTENT_TYPES, extension) ? NAS_CONTENT_TYPES[extension] : null
}

/**
 * La nature du fichier — `null` si l'extension n'est pas dans l'allow-list.
 *
 * ⚠️ **Calculée à l'ÉCRITURE et stockée en clair (colonne `kind`), jamais recalculée depuis le
 * chemin déchiffré pour construire une liste.** Le chemin n'est jamais chargé pour une liste
 * (`COLONNES_DE_LISTE`, doctrine CC-179) ; `kind`, lui, est un CHECK en base, pas
 * du contenu sensible — il ne révèle que « vidéo ou photo », déjà su de l'allow-list publique.
 */
export function nasFileKindFor(path: string): NasFileKind | null {
  const extension = extensionOf(path)

  // ⚠️ `Object.hasOwn`, pas `in` : `in` remonte le prototype (`'constructor' in {}` vaut `true`),
  // ce qui classerait un chemin hostile comme vidéo au lieu de le rejeter — même raison que
  // `nasContentTypeFor` ci-dessus.
  if (Object.hasOwn(VIDEO_CONTENT_TYPES, extension)) return 'video'
  if (Object.hasOwn(PHOTO_CONTENT_TYPES, extension)) return 'photo'
  return null
}
