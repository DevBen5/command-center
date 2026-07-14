import llmConfig, { type LlmConfig } from '#config/llm'

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * Le serveur LLM est injoignable, trop lent, ou répond une erreur. Le message est
 * affichable tel quel : il finit dans la colonne d'erreur de l'ingestion, sous les
 * yeux de l'utilisateur.
 */
export class LlmUnavailableError extends Error {}

/**
 * Client d'un serveur **compatible OpenAI** (`/v1/chat/completions`). C'est le seul
 * contrat : LM Studio, llama.cpp `--server` ou vLLM sont interchangeables.
 *
 * ⚠️ **Cette classe est injectée** (conteneur AdonisJS) et jamais instanciée en dur
 * par le service d'ingestion : c'est ce qui permet à la suite de tests de tourner
 * contre un faux client, sans réseau et de façon déterministe.
 *
 * L'URL du serveur vient de `config/llm.ts`, donc de l'environnement — jamais d'un
 * formulaire. Voir la frontière de confiance documentée dans `config/llm.ts`.
 */
export default class LlmClient {
  constructor(private config: LlmConfig = llmConfig) {}

  /**
   * Une complétion, un texte brut en retour (le contenu du premier choix).
   *
   * `json: true` demande `response_format: json_object` quand le serveur le connaît.
   * On ne peut pas **en dépendre** : un serveur qui l'ignore répond 400, et on
   * réessaie alors une fois sans lui. Le parsing tolère de toute façon la prose.
   */
  async complete(messages: LlmMessage[], options: { json?: boolean } = {}): Promise<string> {
    let response = await this.post(messages, options.json ?? false)

    if (!response.ok && options.json && response.status === 400) {
      response = await this.post(messages, false)
    }

    if (!response.ok) {
      throw new LlmUnavailableError(
        `Le serveur LLM a répondu ${response.status} (${this.config.baseUrl}). ` +
          `Vérifie qu'un modèle est bien chargé.`
      )
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new LlmUnavailableError("Le serveur LLM n'a pas renvoyé de JSON.")
    }

    const content = (payload as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]
      ?.message?.content

    if (typeof content !== 'string' || content.trim() === '') {
      throw new LlmUnavailableError('Le serveur LLM a renvoyé une réponse vide.')
    }

    return content
  }

  /** Un échec réseau (serveur éteint) et un dépassement de délai sont la même erreur ici. */
  private async post(messages: LlmMessage[], json: boolean): Promise<Response> {
    try {
      return await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          // Une synthèse, pas une improvisation : on veut la même sortie sur le même cours.
          temperature: 0.2,
          ...(json ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      })
    } catch {
      throw new LlmUnavailableError(
        `Le serveur LLM (${this.config.baseUrl}) est injoignable ou n'a pas répondu ` +
          `en moins de ${Math.round(this.config.timeoutMs / 1000)} s.`
      )
    }
  }
}
