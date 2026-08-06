import env from '#start/env'
import { externalServicesIsolated } from '#config/env_isolation'

/**
 * Les racines de médias NAS autorisées pour le coffre — la lecture du lot 4 (CC-181), photos
 * comme vidéos.
 *
 * ⚠️ **Même frontière de confiance que `config/immich.ts`**, pour une raison différente : il ne
 * s'agit pas d'un appel réseau, mais la fusion par *truthiness* de `@adonisjs/env` (CC-88) menace
 * n'importe quelle variable, pas seulement celles d'un client externe. Sans cette isolation, un
 * `.env` de poste de dev qui fixerait `COFFRE_NAS_ROOTS` sur un vrai dossier contaminerait les
 * tests en process — même mécanisme que celui qui a fait recevoir un vrai média Immich à un test.
 */
export interface CoffreNasConfig {
  /** Chemins tels que LE PROCESSUS les voit — jamais transformés davantage ici. */
  roots: string[]
}

/** Valeur brute telle que lue dans l'environnement, avant nettoyage. */
export interface RawCoffreNasConfig {
  roots?: string
}

/**
 * Fonction **pure**, séparée de la lecture d'`env` — même raison que `normalizeImmichConfig` : un
 * module qui calcule tout à l'import ne se teste pas.
 */
export function normalizeCoffreNasConfig(raw: RawCoffreNasConfig): CoffreNasConfig {
  const roots = (raw.roots ?? '')
    .split(',')
    .map((root) => root.trim())
    .filter((root) => root.length > 0)

  return { roots }
}

/**
 * La configuration effective : celle de l'environnement, **sauf en test** (CC-101, CC-181).
 *
 * ⚠️ **La garde est ici et pas dans `normalizeCoffreNasConfig`**, pour la même raison que côté
 * Immich : les tests qui doivent prouver le résolveur contre un vrai filesystem construisent leur
 * propre `NasRootsService` avec des racines explicites (fixtures temporaires), jamais en lisant
 * cette configuration — voir `app/modules/coffre/services/nas_roots_service.ts`.
 */
export function coffreNasConfigFrom(
  nodeEnv: string | undefined,
  raw: RawCoffreNasConfig
): CoffreNasConfig {
  return normalizeCoffreNasConfig(externalServicesIsolated(nodeEnv) ? {} : raw)
}

const coffreNasConfig = coffreNasConfigFrom(env.get('NODE_ENV'), {
  roots: env.get('COFFRE_NAS_ROOTS'),
})

export default coffreNasConfig
