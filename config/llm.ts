import env from '#start/env'
import { externalServicesIsolated } from '#config/env_isolation'

/**
 * Serveur LLM local, **compatible OpenAI** (`POST {baseUrl}/chat/completions`) :
 * LM Studio, llama.cpp `--server`, vLLM… Le code ne dépend que de ce contrat.
 *
 * ⚠️ **Frontière de confiance.** Ces valeurs viennent de l'environnement, jamais d'un
 * formulaire et **jamais de la base** : la valeur qu'utilise réellement le serveur ne
 * peut être changée par aucune requête HTTP. Une URL de base éditable en base ou en
 * session serait une SSRF permanente. C'est le même raisonnement que
 * `agent.config.command` dans le module `agents`.
 *
 * L'écran `/revision/llm` **teste** des URL candidates avant qu'on ne les colle ici :
 * transitoire, en mémoire, et sous liste blanche (loopback et plages privées). Il ne
 * persiste rien — voir `leitner_llm_controller.ts`.
 *
 * ⚠️ **La liste blanche ne vaut que pour l'URL saisie** : elle ne vérifie pas la cible
 * d'une redirection, qu'un hôte pourtant autorisé peut renvoyer. Ce qui la complète est
 * le refus des `3xx` dans `LlmClient` (`redirect: 'manual'`). Ne présente jamais l'une
 * des deux comme suffisante — c'est le défaut qu'a corrigé CC-37.
 */
export interface LlmConfig {
  baseUrl: string
  model: string
  apiKey?: string
  timeoutMs: number
}

/** Valeurs brutes telles que lues dans l'environnement, avant repli sur les défauts. */
export interface RawLlmConfig {
  baseUrl?: string
  model?: string
  apiKey?: string
  timeoutMs?: number
}

/** Port par défaut de LM Studio. Sans slash final : le client concatène. */
export const LLM_DEFAULT_BASE_URL = 'http://127.0.0.1:1234/v1'
/**
 * Un serveur local ne sert souvent qu'un modèle et ignore ce champ ; il reste obligatoire dans le
 * protocole OpenAI.
 */
export const LLM_DEFAULT_MODEL = 'local-model'
/** Un petit modèle local synthétise lentement : deux minutes par morceau de cours. */
export const LLM_DEFAULT_TIMEOUT_MS = 120_000

/**
 * Fonction **pure**, séparée de la lecture d'`env` sur le modèle de `normalizeYoutubeConfig`
 * (CC-85) — ici pour que `llmConfigFrom` soit testable, et donc la garde d'isolation avec elle.
 */
export function normalizeLlmConfig(raw: RawLlmConfig): LlmConfig {
  return {
    baseUrl: (raw.baseUrl ?? LLM_DEFAULT_BASE_URL).replace(/\/+$/, ''),
    model: raw.model ?? LLM_DEFAULT_MODEL,
    // Optionnelle : un serveur local n'authentifie généralement rien.
    apiKey: raw.apiKey,
    timeoutMs: raw.timeoutMs ?? LLM_DEFAULT_TIMEOUT_MS,
  }
}

/**
 * La configuration effective : celle de l'environnement, **sauf en test** (CC-101).
 *
 * ⚠️ **Le LLM n'a pas d'`enabled`, contrairement à Immich et YouTube** — il a une URL par défaut.
 * L'isolation ne peut donc pas l'éteindre : elle lui retire la configuration **personnelle** du
 * poste, clé d'API comprise, et le ramène aux valeurs par défaut documentées. Ce qui reste couvert :
 * aucune clé ni aucun modèle du `.env` n'entre dans la suite, et deux machines exécutent les tests
 * avec la même configuration.
 *
 * ⚠️ **Ce qui reste à découvert, et qu'il ne faut pas croire couvert** : un test qui oublierait de
 * swapper `LlmClient` atteindrait toujours un LM Studio réellement lancé sur le port par défaut.
 * Le rayon est borné — `isLocalLlmUrl` n'accepte que le local, donc rien ne sort de la machine —
 * mais un test peut être lent ou non déterministe sans que rien ne le dise. Les huit fichiers de
 * test LLM actuels swappent ou construisent leur config explicitement ; garde ce motif.
 */
export function llmConfigFrom(nodeEnv: string | undefined, raw: RawLlmConfig): LlmConfig {
  return normalizeLlmConfig(externalServicesIsolated(nodeEnv) ? {} : raw)
}

const llmConfig = llmConfigFrom(env.get('NODE_ENV'), {
  baseUrl: env.get('LLM_BASE_URL'),
  model: env.get('LLM_MODEL'),
  apiKey: env.get('LLM_API_KEY'),
  timeoutMs: env.get('LLM_TIMEOUT_MS'),
})

export default llmConfig
