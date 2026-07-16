import env from '#start/env'

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
 */
export interface LlmConfig {
  baseUrl: string
  model: string
  apiKey?: string
  timeoutMs: number
}

const llmConfig: LlmConfig = {
  // Port par défaut de LM Studio. Sans trailing slash : le client concatène.
  baseUrl: (env.get('LLM_BASE_URL') ?? 'http://127.0.0.1:1234/v1').replace(/\/+$/, ''),
  // Un serveur local ne sert souvent qu'un modèle et ignore ce champ ; il reste
  // obligatoire dans le protocole OpenAI.
  model: env.get('LLM_MODEL') ?? 'local-model',
  // Optionnelle : un serveur local n'authentifie généralement rien.
  apiKey: env.get('LLM_API_KEY'),
  // Un petit modèle local synthétise lentement : deux minutes par morceau de cours.
  timeoutMs: env.get('LLM_TIMEOUT_MS') ?? 120_000,
}

export default llmConfig
