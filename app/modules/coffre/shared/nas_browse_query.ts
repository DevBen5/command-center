/**
 * La navigation par dossier NAS (`pages/nas.vue`) — la construction de requêtes et de chemins,
 * extraite pour être atteignable par Vitest sans monter le composant (même geste que
 * `catalog_query.ts`, `entry_sections.ts` : un `<script setup>` est hors de portée de Japa).
 *
 * ⚠️ **N'importe jamais par un alias `#modules/*` depuis ce dossier** — l'alias mappe vers
 * `./app/modules/*.js`, qui n'existe qu'après un build ; Vite ne le résout pas depuis un `.vue`.
 *
 * Ce fichier est **pur** : ni base, ni horloge, ni DOM, ni Vue, ni accès disque — les chemins qu'il
 * manipule sont de simples chaînes, la confinement réel se vérifie côté serveur
 * (`NasRootsService.resolveInRoot`), jamais ici.
 */

export interface NasBreadcrumbSegment {
  /** Le nom affiché — la racine, ou le nom du dossier. */
  label: string
  /** Le `path` à envoyer pour y revenir (chaîne vide pour la racine elle-même). */
  path: string
}

/** La requête envoyée à `/coffre/nas/browse` — `root` absent = lister les racines déclarées. */
export function buildNasBrowseQueryString(root: string | null, path: string): string {
  if (root === null || root === '') return ''

  const params = new URLSearchParams({ root, path })
  return params.toString()
}

/** L'URL de la vignette d'un fichier parcouru — jamais construite ailleurs. */
export function nasThumbnailUrl(root: string, path: string): string {
  const params = new URLSearchParams({ root, path })
  return `/coffre/nas/thumbnail?${params.toString()}`
}

/**
 * Le fil d'Ariane de la navigation — la racine, puis un segment par niveau de `path`.
 *
 * ⚠️ **`path` est déjà séparé par `/`**, jamais par le séparateur de l'OS — c'est le contrat que le
 * serveur tient (`nas_folder_browser.ts` construit ses chemins de la même façon), donc ce fichier
 * n'a besoin de connaître aucune plateforme.
 */
export function nasBreadcrumbFor(root: string, path: string): NasBreadcrumbSegment[] {
  const segments: NasBreadcrumbSegment[] = [{ label: root, path: '' }]
  if (path === '') return segments

  let accumulated = ''
  for (const part of path.split('/')) {
    accumulated = accumulated === '' ? part : `${accumulated}/${part}`
    segments.push({ label: part, path: accumulated })
  }

  return segments
}
