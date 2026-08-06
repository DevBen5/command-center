/**
 * L'écran du coffre (`pages/index.vue`) — le regroupement des entrées par nature (CC-204).
 *
 * ⚠️ **Ce fichier vit ici parce qu'un `<script setup>` est hors de portée de Japa.** Même geste
 * que `leitner/shared/review_page.ts` et `inertia/layouts/breadcrumb.ts` : la logique qui régresse
 * en silence sort du composant pour devenir atteignable par un exécuteur.
 *
 * ⚠️ **N'importe jamais par un alias `#modules/*` depuis ce dossier.** L'alias mappe vers
 * `./app/modules/*.js`, qui n'existe qu'après un build — Vite ne le résout pas depuis un `.vue`.
 * Seuls le relatif et les paquets npm purs sont permis ici.
 *
 * Ce fichier est **pur** : ni base, ni horloge, ni DOM, ni Vue.
 */

export type CoffreEntryType = 'note' | 'url' | 'credential'

export type CoffreSectionKey = CoffreEntryType | 'photo'

/** L'ordre d'affichage des sections — c'est aussi l'ordre du ticket : notes · liens ·
 * identifiants · photos. */
const SECTION_ORDER: readonly CoffreSectionKey[] = ['note', 'url', 'credential', 'photo']

/** Ce qu'une entrée doit porter pour être rangée — structurel, pas le DTO complet de la page :
 * ce fichier ne connaît ni le titre ni le contenu, seulement ce qui décide de la section. */
export interface SectionableEntry {
  type: CoffreEntryType
  media: unknown[]
  nasFiles: unknown[]
}

export interface CoffreSection<T> {
  key: CoffreSectionKey
  entries: T[]
}

/**
 * Range des entrées en sections par nature — notes, liens, identifiants, photos.
 *
 * ⚠️ **Une entrée qui porte au moins un média (Immich ou NAS) va en `photo`, JAMAIS dans la
 * section de son `type`** — décision de conception CC-204 : la présence de média prime sur la
 * nature déclarée, et le classement reste exclusif (une entrée n'apparaît que dans une section).
 * `type` n'est pas modifié pour autant — voir `CoffreEntry.type`, toujours `note`/`url`/`credential`.
 *
 * ⚠️ **N'ORDONNE PAS.** L'ordre à l'intérieur d'une section est celui d'arrivée dans `entries` —
 * cette fonction suppose que le serveur a déjà trié `created_at desc` (`VaultService.listQueryFor`).
 * Un tri ici masquerait en silence une régression de l'ordre serveur au lieu de la révéler.
 *
 * ⚠️ **Une section sans entrée est ABSENTE du résultat**, pas rendue avec un tableau vide : c'est
 * ce qui permet au template de ne jamais afficher d'en-tête pour une section vide sans qu'il ait à
 * le vérifier lui-même.
 */
export function groupEntriesByNature<T extends SectionableEntry>(entries: T[]): CoffreSection<T>[] {
  const buckets = new Map<CoffreSectionKey, T[]>()

  for (const entry of entries) {
    const key: CoffreSectionKey =
      entry.media.length > 0 || entry.nasFiles.length > 0 ? 'photo' : entry.type

    const bucket = buckets.get(key)
    if (bucket === undefined) {
      buckets.set(key, [entry])
    } else {
      bucket.push(entry)
    }
  }

  return SECTION_ORDER.filter((key) => buckets.has(key)).map((key) => ({
    key,
    entries: buckets.get(key) as T[],
  }))
}
