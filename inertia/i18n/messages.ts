/**
 * Fusion des messages i18n co-localisés par module.
 *
 * Chaque module dépose ses traductions dans `app/<couche>/<module>/i18n/<locale>.json`
 * (ex. `app/modules/agents/i18n/fr.json`). Ces fichiers sont ramassés au boot par
 * `import.meta.glob` (voir `index.ts`) puis fusionnés ici, sous un namespace égal au
 * **nom du dossier module** : les clés d'`agents` deviennent accessibles via `t('agents.…')`.
 *
 * Le châssis (brand, nav, sidebar, palette, login…) reste dans `inertia/i18n/<locale>.json`
 * et forme la base : il vit sous `inertia/`, hors du glob `/app/**`, donc jamais ramassé ici.
 *
 * La logique est isolée des appels `import.meta.glob` — que seul un bundler résout — pour
 * être prouvée en unité (`__tests__/messages.spec.ts`) sur des entrées synthétiques. Même
 * motif que `scripts/lib/dumps.js` : le code qui, s'il se trompe, route du contenu au
 * mauvais endroit est le seul qu'on tient à tester.
 */

/** Messages d'une locale : un arbre de clés dont les feuilles sont des chaînes. */
export type Messages = Record<string, unknown>

/**
 * Dérive le namespace d'un fichier i18n de module depuis son chemin.
 * `/app/modules/agents/i18n/fr.json` → `agents` · `/app/core/dashboard/i18n/en.json` → `dashboard`.
 *
 * Un chemin qui ne suit pas la convention lève : mieux vaut un échec bruyant au boot qu'un
 * module silencieusement rangé sous un mauvais namespace — donc jamais traduit sans qu'on le voie.
 */
export function namespaceFromPath(path: string): string {
  const match = path.match(/\/app\/(?:modules|core)\/([^/]+)\/i18n\/[^/]+\.json$/)
  if (!match) {
    throw new Error(`Chemin i18n de module non reconnu : "${path}"`)
  }
  return match[1]
}

/**
 * Fusionne les fichiers i18n de modules sur la base du châssis.
 *
 * `files` est la map `chemin → messages` renvoyée par
 * `import.meta.glob(..., { eager: true, import: 'default' })`. Chaque module est rangé sous
 * son namespace ; une collision — avec une clé du châssis ou avec un autre module — lève,
 * plutôt que d'écraser en silence les traductions d'un voisin.
 */
export function mergeModuleMessages(base: Messages, files: Record<string, Messages>): Messages {
  const merged: Messages = { ...base }
  for (const [path, messages] of Object.entries(files)) {
    const namespace = namespaceFromPath(path)
    if (namespace in merged) {
      throw new Error(
        `Collision de namespace i18n : "${namespace}" (${path}) écraserait une clé déjà présente`
      )
    }
    merged[namespace] = messages
  }
  return merged
}
