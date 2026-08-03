import env from '#start/env'

/**
 * Les modules activables de l'installation (CC-137).
 *
 * ⚠️ **Le noyau (`core/`) n'est pas dans cette liste** : `auth`, `dashboard`, `i18n`, `settings`
 * et `shared` sont toujours présents, ils ne se désactivent pas. Ce fichier ne connaît que les
 * quatre modules détachables, dans l'ordre canonique déjà utilisé par `config/database.ts` pour
 * les migrations (contraintes FK).
 */
export const KNOWN_MODULES = ['services', 'agents', 'veille', 'leitner'] as const

export type ModuleName = (typeof KNOWN_MODULES)[number]

/**
 * Transforme la valeur brute de `MODULES` (liste séparée par des virgules) en ensemble de
 * modules activés. Fonction **pure**, séparée de la lecture d'`env` pour rester testable sans
 * dépendre du `.env` de la machine qui lance les tests — même raison que `dockerDisponible`.
 *
 * ⚠️ **Vide ou absente → aucun module.** Défaut retenu du ticket : « vide = noyau seul »,
 * l'oubli va vers le refus — la doctrine des routes (CLAUDE.md, point 5), appliquée un cran
 * plus haut.
 *
 * ⚠️ **Un nom qui n'est pas dans `KNOWN_MODULES` fait ÉCHOUER LE DÉMARRAGE**, plutôt que d'être
 * ignoré. Une faute de frappe (`MODULES=leitnre`) désactiverait silencieusement le module visé
 * si elle était simplement écartée — exactement le mode d'échec qu'`APP_TIMEZONE` refuse déjà
 * de laisser passer (`config/veille.ts`). Refuser de démarrer est le seul endroit où cet échec
 * a un lecteur.
 */
export function parseModules(raw: string | undefined): Set<ModuleName> {
  const noms = (raw ?? '')
    .split(',')
    .map((nom) => nom.trim())
    .filter((nom) => nom.length > 0)

  const inconnus = noms.filter((nom) => !KNOWN_MODULES.includes(nom as ModuleName))

  if (inconnus.length > 0) {
    throw new Error(
      `MODULES cite des modules inconnus : ${inconnus.join(', ')}. ` +
        `Modules valides : ${KNOWN_MODULES.join(', ')}.`
    )
  }

  return new Set(noms as ModuleName[])
}

const MODULE_MIGRATION_PATHS: Record<ModuleName, string> = {
  services: 'app/modules/services/migrations',
  agents: 'app/modules/agents/migrations',
  veille: 'app/modules/veille/migrations',
  leitner: 'app/modules/leitner/migrations',
}

/**
 * Les modules qui portent un seeder — services et agents seulement (CC-106 : ni veille ni
 * leitner n'en ont, le contenu est saisi à la main).
 */
const MODULE_SEEDER_PATHS: Partial<Record<ModuleName, string>> = {
  services: 'app/modules/services/seeders',
  agents: 'app/modules/agents/seeders',
}

/**
 * Les chemins de migrations des modules activés, dans l'ordre canonique de `KNOWN_MODULES`.
 * Pure : `config/database.ts` n'a plus qu'à préfixer `app/core/auth/migrations`.
 */
export function migrationPathsFor(enabled: ReadonlySet<ModuleName>): string[] {
  return KNOWN_MODULES.filter((module) => enabled.has(module)).map(
    (module) => MODULE_MIGRATION_PATHS[module]
  )
}

/** Le pendant pour les seeders — mêmes règles, sous-ensemble des modules qui en ont un. */
export function seederPathsFor(enabled: ReadonlySet<ModuleName>): string[] {
  return KNOWN_MODULES.filter((module) => enabled.has(module) && MODULE_SEEDER_PATHS[module]).map(
    (module) => MODULE_SEEDER_PATHS[module]!
  )
}

/**
 * ⚠️ **Mutable, et lu à CHAQUE appel de `isModuleEnabled` — jamais destructuré à l'import.**
 * Même contrat que `dockerConfig.disponible` (CC-116) : c'est ce qui permet aux tests de forcer
 * un module « éteint » sans redémarrer le process, pour tout ce qui consulte l'état module par
 * module et par requête (`HomeController`, `NavStatsService`).
 *
 * ⚠️ Les registres de démarrage (`start/capabilities.ts`, `start/navigation.ts`,
 * `start/routes.ts`, `config/database.ts`) lisent ce `Set`, eux, **une seule fois au boot** — le
 * muter après coup ne retire ni route déjà commitée ni capacité déjà enregistrée. C'est une
 * limite structurelle assumée, pas un oubli : voir CC-137.
 */
const enabledModules = parseModules(env.get('MODULES'))

export default enabledModules

export function isModuleEnabled(module: ModuleName): boolean {
  return enabledModules.has(module)
}
