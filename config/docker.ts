import env from '#start/env'

/**
 * Le déploiement a-t-il accès à Docker ? (CC-116)
 *
 * ⚠️ **Ce n'est pas une sonde, et ça ne peut pas en être une.** « docker échoue » se manifeste
 * identiquement sur le poste de dev (pas de conteneurs réels — le `catch {}` de
 * `SystemStatsService` simule, c'est assumé) et sur le NAS (socket jamais monté, décision CC-73).
 * Une sonde runtime afficherait la bannière en dev, ou laisserait mentir la prod : seule une
 * **déclaration du déploiement** distingue les deux. Même frontière que le LLM et Immich — la
 * configuration vient de l'environnement, jamais de la base.
 *
 * ⚠️ **Le défaut va vers la vérité.** Sans `DOCKER_AVAILABLE`, la production est réputée sans
 * Docker : oublier la variable sur le NAS affiche la bannière « hors service » du module
 * Services, jamais des conteneurs imaginaires — le même sens que CC-71 (« l'oubli va vers le
 * refus »). La variable ne sert qu'à contredire ce défaut, dans les deux sens.
 */
export interface DockerConfig {
  /**
   * ⚠️ Toujours lu **au moment de la requête** (`dockerConfig.disponible`), jamais destructuré à
   * l'import : `services_offline.spec.ts` mute cette propriété pour couvrir le chemin
   * « hors service », qu'aucun `.env` de test ne peut produire sans redémarrage.
   */
  disponible: boolean
}

/**
 * Fonction **pure**, séparée de la lecture d'`env` pour la même raison que
 * `normalizeImmichConfig` : un module qui calcule tout à l'import ne se teste pas, et ce booléen
 * est précisément ce qui décide qu'un écran dit la vérité ou invente des conteneurs.
 */
export function dockerDisponible(nodeEnv: string | undefined, override?: boolean): boolean {
  return override ?? nodeEnv !== 'production'
}

const dockerConfig: DockerConfig = {
  disponible: dockerDisponible(env.get('NODE_ENV'), env.get('DOCKER_AVAILABLE')),
}

export default dockerConfig
