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
 * identifiants · photos. Exporté depuis CC-208 : `sectionCardsFor` en a besoin pour compléter
 * les sections absentes dans le même ordre. */
export const SECTION_ORDER: readonly CoffreSectionKey[] = ['note', 'url', 'credential', 'photo']

/**
 * Les segments d'URL des pages de section (CC-208) — en français, cohérent avec le reste des
 * routes du module (`/coffre/ouvrir`, `/coffre/creation`…). Seul point qui traduit une
 * `CoffreSectionKey` interne en mot d'URL ; `start/routes.ts` et l'accueil (liens des cartes) s'y
 * réfèrent tous deux pour ne jamais diverger.
 */
export const SECTION_SLUGS: Record<CoffreSectionKey, string> = {
  note: 'notes',
  url: 'liens',
  credential: 'identifiants',
  photo: 'photos',
}

/** L'inverse de `SECTION_SLUGS` — `null` sur un slug inconnu (le contrôleur en fait une erreur
 * explicite : la route ne devrait jamais laisser passer autre chose que ces quatre mots). */
export function sectionKeyFromSlug(slug: string): CoffreSectionKey | null {
  const found = (Object.entries(SECTION_SLUGS) as [CoffreSectionKey, string][]).find(
    ([, value]) => value === slug
  )
  return found?.[0] ?? null
}

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

/**
 * Complète les sections absentes de `groupEntriesByNature` par une carte vide (CC-208) : l'accueil
 * affiche toujours quatre cartes, contrairement à la liste de CC-204 qui omettait une section vide
 * — un en-tête suivi du vide est du bruit sur une liste, mais une carte manquante casse la grille
 * et fait croire que la fonctionnalité n'existe pas.
 *
 * ⚠️ **Le contrat de `groupEntriesByNature` ne change pas** — c'est cet appelant qui complète
 * après coup, décision du ticket CC-208 écrite ici pour que personne ne « répare » l'un des deux
 * en croyant l'autre incohérent.
 */
export function sectionCardsFor<T extends SectionableEntry>(entries: T[]): CoffreSection<T>[] {
  const present = new Map(groupEntriesByNature(entries).map((section) => [section.key, section]))

  return SECTION_ORDER.map((key) => present.get(key) ?? { key, entries: [] })
}
