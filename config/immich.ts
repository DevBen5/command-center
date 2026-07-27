import env from '#start/env'
import { externalServicesIsolated } from '#config/env_isolation'

/**
 * Instance Immich — la source des vidéos et images de veille (CC-55).
 *
 * ⚠️ **Frontière de confiance, identique à celle du LLM.** Ces valeurs viennent de
 * l'environnement, jamais d'un formulaire et **jamais de la base** : l'hôte que le serveur
 * appelle ne peut être changé par aucune requête HTTP. Une URL de serveur persistée depuis
 * un formulaire serait une SSRF permanente, écrite une fois et rejouée à chaque collecte —
 * c'est le raisonnement de `config/llm.ts` et de `agent.config.command`.
 *
 * ⚠️ **Contrairement au LLM, aucune liste blanche d'hôte ne s'applique ici** — et ce n'est
 * pas un oubli. `isLocalLlmUrl` (Leitner) n'accepte que `localhost` et les IP littérales
 * privées : une instance Immich servie en `https` derrière un nom de domaine public serait
 * **refusée**, ce qui est le cas réel. La liste blanche de Leitner protège un écran qui teste
 * des URL *saisies* ; ici rien n'est saisi. Ce qui la remplace, dans `ImmichClient` : refus
 * des redirections, assertion de `content-type`, plafonds de taille et de temps.
 *
 * ⚠️ **`IMMICH_API_KEY` ne repart jamais vers le client**, exactement comme `LLM_API_KEY` :
 * les pages reçoivent `configured: boolean` et l'URL web (que le navigateur doit suivre pour
 * ouvrir un asset), jamais la clé.
 */
export interface ImmichConfig {
  /** Sans slash final : le client concatène. Voir `enabled` pour l'absence de configuration. */
  baseUrl: string
  apiKey: string
  /**
   * L'album qui **est** la source de veille. Un seul, jamais la bibliothèque entière : elle
   * contient des photos personnelles, et le lot 3 les enverrait à un LLM. Le filtre est chez
   * l'utilisateur, dans Immich — aucun réglage à inventer ici.
   */
  albumId: string
  timeoutMs: number
  /** Les trois variables sont-elles présentes ? Sans elles, la collecte Immich ne démarre pas. */
  enabled: boolean
}

/** Valeurs brutes telles que lues dans l'environnement, avant nettoyage. */
export interface RawImmichConfig {
  baseUrl?: string
  apiKey?: string
  albumId?: string
  timeoutMs?: number
}

/**
 * Une instance auto-hébergée sur un lien domestique met parfois plusieurs secondes à rendre une
 * page d'album ; 15 s laisse de la marge sans faire traîner un rafraîchissement manuel. Là où
 * YouTube s'en accorde 10 : `www.googleapis.com` n'est pas au bout d'un lien domestique.
 */
export const IMMICH_DEFAULT_TIMEOUT_MS = 15_000

/**
 * Fonction **pure**, séparée de la lecture d'`env` pour la même raison que
 * `normalizeYoutubeConfig` (CC-85) : un module qui calcule tout à l'import ne se teste pas, et
 * `enabled` est précisément ce qui décide qu'une source collecte ou se tait.
 *
 * ⚠️ **Le slash final est retiré, et ce n'est pas cosmétique.** Sans ce nettoyage,
 * `${baseUrl}/api/server/about` donne `//api/server/about` — et Immich répond alors
 * **200 avec le HTML de son interface** (le repli SPA du serveur), pas une 404. Un client qui
 * ne teste que le statut lirait `assets: undefined`, donc un album vide, donc *tout l'album
 * disparu*. Constaté sur l'instance réelle, pas déduit.
 */
export function normalizeImmichConfig(raw: RawImmichConfig): ImmichConfig {
  const baseUrl = (raw.baseUrl ?? '').trim().replace(/\/+$/, '')
  const apiKey = (raw.apiKey ?? '').trim()
  const albumId = (raw.albumId ?? '').trim()

  return {
    baseUrl,
    apiKey,
    albumId,
    timeoutMs: raw.timeoutMs ?? IMMICH_DEFAULT_TIMEOUT_MS,
    enabled: baseUrl !== '' && apiKey !== '' && albumId !== '',
  }
}

/**
 * La configuration effective : celle de l'environnement, **sauf en test** (CC-101).
 *
 * ⚠️ **La garde est ici et pas dans `normalizeImmichConfig`**, qui doit rester capable de rendre
 * une configuration activée — c'est ce que construisent les tests pour couvrir le chemin
 * « configuré ». Voir `config/env_isolation.ts` pour la raison complète, et pourquoi `.env.test`
 * ne peut pas jouer ce rôle.
 *
 * ⚠️ **Cette fonction est le sujet du test, pas la ligne d'en dessous.** Une spec qui recomposerait
 * `externalServicesIsolated` et `normalizeImmichConfig` de son côté resterait verte si on retirait
 * la garde d'ici : elle prouverait sa propre expression, pas le fichier.
 */
export function immichConfigFrom(nodeEnv: string | undefined, raw: RawImmichConfig): ImmichConfig {
  return normalizeImmichConfig(externalServicesIsolated(nodeEnv) ? {} : raw)
}

const immichConfig = immichConfigFrom(env.get('NODE_ENV'), {
  baseUrl: env.get('IMMICH_BASE_URL'),
  apiKey: env.get('IMMICH_API_KEY'),
  albumId: env.get('IMMICH_ALBUM_ID'),
  timeoutMs: env.get('IMMICH_TIMEOUT_MS'),
})

export default immichConfig
