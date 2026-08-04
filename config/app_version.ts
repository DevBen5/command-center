import { readFileSync } from 'node:fs'
import env from '#start/env'

/**
 * Répond à « quelle version tourne ? » sans shell sur la machine (CC-151) — complète le
 * `LABEL` OCI de CC-130 point 2, qui répond lui à `docker inspect`. Deux valeurs qui ne se
 * recouvrent pas :
 *
 * - `version` vient de `package.json`, relue une seule fois au chargement de ce module —
 *   jamais à chaque requête. Elle peut être en retard sur le code réellement construit : la
 *   convention (CC-130) bump au déploiement, pas à chaque merge — une image construite entre
 *   deux mises en ligne affiche donc la version PRÉCÉDENTE.
 * - `commit` vient de `APP_COMMIT`, injecté à la construction de l'image par un `ARG` du
 *   `Dockerfile` (`.git` n'entre jamais dans le contexte de build — `.dockerignore`). Lui ne
 *   peut pas mentir : il désigne exactement le code embarqué. `undefined` en développement
 *   (pas de build Docker) et sur une image construite sans l'ARG.
 */
export interface AppVersionInfo {
  version: string
  commit: string | undefined
}

/**
 * Fonction pure, séparée de la lecture du disque — même raison que `inspectAppUrl`
 * (`config/app_url.ts`) : testable sans dépendre du `package.json` réel du dépôt ni d'un `.env`.
 */
export function readAppVersion(packageJsonRaw: string, commit: string | undefined): AppVersionInfo {
  const { version } = JSON.parse(packageJsonRaw) as { version: string }
  return { version, commit }
}

const packageJsonUrl = new URL('../package.json', import.meta.url)
const appVersion = readAppVersion(readFileSync(packageJsonUrl, 'utf-8'), env.get('APP_COMMIT'))

export default appVersion
