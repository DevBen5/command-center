import env from '#start/env'
import { externalServicesIsolated } from '#config/env_isolation'

/**
 * Playlist « Veille » YouTube — la seconde source média de la veille (CC-85).
 *
 * ⚠️ **Même frontière de confiance qu'Immich et que le LLM.** Ces valeurs viennent de
 * l'environnement, jamais d'un formulaire et **jamais de la base** : la playlist que le serveur
 * interroge ne peut être changée par aucune requête HTTP. Le raisonnement est celui de
 * `config/immich.ts` et d'`agent.config.command` — une cible persistée depuis un formulaire
 * serait rejouée à chaque collecte.
 *
 * ⚠️ **Ce n'est pas « À regarder plus tard », et ça ne peut pas l'être.** La playlist `WL` et
 * l'historique ne sont plus lisibles par l'API Data v3 depuis ~2016 : aucun scope OAuth ne les
 * restaure, et il n'existe pas de flux RSS pour la WL. D'où une playlist **dédiée**, que
 * l'utilisateur alimente par *Enregistrer → Veille* — le même geste, dans le même menu, sur une
 * liste que la machine sait lire. Ne repose pas la question : la réponse ne dépend pas de nous.
 *
 * ⚠️ **Pas d'OAuth, et c'est ce qui rend la clé anodine.** Une playlist non-répertoriée est
 * lisible par une simple clé API, qui n'accède qu'à des **données publiques** : elle ne porte
 * aucune identité, ne peut rien écrire, et il n'y a donc ni jeton de rafraîchissement ni consentement
 * à entretenir. Le prix est que la playlist ne doit pas être « privée » au sens strict —
 * non-répertoriée suffit, et c'est le réglage attendu.
 *
 * ⚠️ **`YOUTUBE_API_KEY` ne repart jamais vers le client**, exactement comme `IMMICH_API_KEY` et
 * `LLM_API_KEY` : les pages reçoivent `configured: boolean`, jamais la clé.
 */
export interface YoutubeConfig {
  apiKey: string
  /**
   * L'identifiant **de la playlist**, pas son URL : la valeur du paramètre `list=`, du type
   * `PLxxxxxxxxxxxxxxxx`. Voir `normalizeYoutubeConfig` pour ce qui n'est délibérément pas
   * rattrapé.
   */
  playlistId: string
  timeoutMs: number
  /** Les deux valeurs sont-elles présentes ? Sans elles, la collecte YouTube ne démarre pas. */
  enabled: boolean
}

/** Valeurs brutes telles que lues dans l'environnement, avant nettoyage. */
export interface RawYoutubeConfig {
  apiKey?: string
  playlistId?: string
  timeoutMs?: number
}

/**
 * `www.googleapis.com` n'est pas un serveur auto-hébergé au bout d'un lien domestique : 10 s
 * suffisent largement, là où Immich s'en accorde 15. Une requête qui traîne retient la boucle
 * de collecte, qui traite les sources l'une après l'autre.
 */
export const YOUTUBE_DEFAULT_TIMEOUT_MS = 10_000

/**
 * Fonction **pure** — c'est elle que teste `tests/unit/veille_youtube_config.spec.ts`.
 *
 * Séparée de la lecture d'`env` pour la même raison que `scripts/lib/dumps.js` l'est de ses
 * scripts et `inertia/i18n/messages.ts` de son glob : un module qui calcule tout à l'import ne
 * se teste pas, et `enabled` est précisément ce qui décide qu'une source collecte ou se tait.
 * La frontière de confiance ne bouge pas pour autant : l'unique appelant reste `env`.
 *
 * ⚠️ **Le nettoyage s'arrête au blanc et au slash, volontairement.** Coller
 * `https://www.youtube.com/playlist?list=PLxxx` au lieu de `PLxxx` laisse `enabled` à vrai et
 * fait répondre 404 à la collecte — mais **pas en silence** : l'erreur atterrit dans le
 * `last_error` de la source, affiché sur `/veille/sources`. Extraire le `list=` d'une URL
 * masquerait une erreur de configuration derrière de la magie, et obligerait ensuite à trancher
 * le cas `watch?v=…&list=…`, où l'utilisateur voulait peut-être la vidéo. Le `.env.example` dit
 * la forme attendue ; l'écran dit ce qui a échoué.
 */
export function normalizeYoutubeConfig(raw: RawYoutubeConfig): YoutubeConfig {
  const apiKey = (raw.apiKey ?? '').trim()
  const playlistId = (raw.playlistId ?? '').trim().replace(/\/+$/, '')

  return {
    apiKey,
    playlistId,
    timeoutMs: raw.timeoutMs ?? YOUTUBE_DEFAULT_TIMEOUT_MS,
    enabled: apiKey !== '' && playlistId !== '',
  }
}

/**
 * La configuration effective : celle de l'environnement, **sauf en test** (CC-101).
 *
 * ⚠️ **La garde est ici et pas dans `normalizeYoutubeConfig`**, qui doit rester capable de rendre
 * une configuration activée — c'est ce que construisent les tests pour couvrir le chemin
 * « configuré ». Voir `config/env_isolation.ts` pour la raison complète, et pourquoi `.env.test`
 * ne peut pas jouer ce rôle.
 *
 * ⚠️ **Cette fonction est le sujet du test, pas la ligne d'en dessous.** Une spec qui recomposerait
 * `externalServicesIsolated` et `normalizeYoutubeConfig` de son côté resterait verte si on retirait
 * la garde d'ici : elle prouverait sa propre expression, pas le fichier.
 */
export function youtubeConfigFrom(
  nodeEnv: string | undefined,
  raw: RawYoutubeConfig
): YoutubeConfig {
  return normalizeYoutubeConfig(externalServicesIsolated(nodeEnv) ? {} : raw)
}

const youtubeConfig = youtubeConfigFrom(env.get('NODE_ENV'), {
  apiKey: env.get('YOUTUBE_API_KEY'),
  playlistId: env.get('YOUTUBE_PLAYLIST_ID'),
  timeoutMs: env.get('YOUTUBE_TIMEOUT_MS'),
})

export default youtubeConfig
