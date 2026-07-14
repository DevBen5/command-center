import env from '#start/env'

/**
 * Serveur LLM local, **compatible OpenAI** (`POST {baseUrl}/chat/completions`) :
 * LM Studio, llama.cpp `--server`, vLLM… Le code ne dépend que de ce contrat.
 *
 * ⚠️ **Frontière de confiance.** Ces valeurs viennent de l'environnement, jamais
 * d'un formulaire. Une URL de base éditable depuis l'UI serait une SSRF : le serveur
 * émettrait des requêtes vers l'hôte du choix de celui qui écrit dans le champ.
 * C'est le même raisonnement que `agent.config.command` dans le module `agents`.
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
