import env from '#start/env'

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

/**
 * ⚠️ **Le slash final est retiré, et ce n'est pas cosmétique.** Sans ce nettoyage,
 * `${baseUrl}/api/server/about` donne `//api/server/about` — et Immich répond alors
 * **200 avec le HTML de son interface** (le repli SPA du serveur), pas une 404. Un client qui
 * ne teste que le statut lirait `assets: undefined`, donc un album vide, donc *tout l'album
 * disparu*. Constaté sur l'instance réelle, pas déduit.
 */
const baseUrl = (env.get('IMMICH_BASE_URL') ?? '').trim().replace(/\/+$/, '')
const apiKey = (env.get('IMMICH_API_KEY') ?? '').trim()
const albumId = (env.get('IMMICH_ALBUM_ID') ?? '').trim()

const immichConfig: ImmichConfig = {
  baseUrl,
  apiKey,
  albumId,
  // Une instance auto-hébergée sur un lien domestique met parfois plusieurs secondes à rendre
  // une page d'album ; 15 s laisse de la marge sans faire traîner un rafraîchissement manuel.
  timeoutMs: env.get('IMMICH_TIMEOUT_MS') ?? 15_000,
  enabled: baseUrl !== '' && apiKey !== '' && albumId !== '',
}

export default immichConfig
