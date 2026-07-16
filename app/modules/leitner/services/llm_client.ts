import llmConfig, { type LlmConfig } from '#config/llm'

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * Une cible, le temps d'un appel : l'URL et le modèle, sans toucher à la configuration
 * du serveur. C'est ce dont l'écran de configuration (`/revision/llm`) a besoin pour
 * **tester** une URL candidate avant qu'elle ne soit collée dans `.env`.
 *
 * ⚠️ Une cible venue d'une requête HTTP est passée par la liste blanche
 * (`llmBaseUrl` dans les validateurs du module) : loopback et plages privées, rien
 * d'autre. Sans elle, ces méthodes seraient une SSRF.
 */
export interface LlmTarget {
  baseUrl: string
  model?: string
}

/**
 * Délai de la **sonde** (`ping`, `listModels`), sans rapport avec `LLM_TIMEOUT_MS`
 * (120 s) qui borne une génération. Sonder trois candidats éteints avec le délai de
 * génération figerait « Détecter » six minutes ; un serveur local qui répond, répond
 * tout de suite.
 */
export const PROBE_TIMEOUT_MS = 2_000

/** Sans slash final : le client concatène `/chat/completions` ou `/models`. */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

/**
 * Le serveur LLM est injoignable, trop lent, ou répond une erreur. Le message est
 * affichable tel quel : il finit dans la colonne d'erreur de l'ingestion, sous les
 * yeux de l'utilisateur.
 */
export class LlmUnavailableError extends Error {}

/**
 * Client d'un serveur **compatible OpenAI** (`/v1/chat/completions`, `/v1/models`).
 * C'est le seul contrat : LM Studio, llama.cpp `--server` ou vLLM sont interchangeables.
 *
 * ⚠️ **Cette classe est injectée** (conteneur AdonisJS) et jamais instanciée en dur
 * par le service d'ingestion ni par les contrôleurs : c'est ce qui permet à la suite
 * de tests de tourner contre un faux client, sans réseau et de façon déterministe.
 *
 * La configuration **du serveur** vient de `config/llm.ts`, donc de l'environnement —
 * jamais d'un formulaire (voir la frontière de confiance documentée là-bas). Une cible
 * passée en argument (`options.target`, `ping`, `listModels`) ne la remplace pas : elle
 * ne vaut que pour l'appel, et ne survit pas à la requête.
 */
export default class LlmClient {
  constructor(private config: LlmConfig = llmConfig) {}

  /**
   * Une complétion, un texte brut en retour (le contenu du premier choix).
   *
   * `json: true` demande `response_format: json_object` quand le serveur le connaît.
   * On ne peut pas **en dépendre** : un serveur qui l'ignore répond 400, et on
   * réessaie alors une fois sans lui. Le parsing tolère de toute façon la prose.
   *
   * `target` teste une URL candidate : la génération de contrôle de `/revision/llm`
   * est **la vraie génération de l'ingestion**, sur une autre cible. Sans elle, elle
   * ne prouverait rien.
   */
  async complete(
    messages: LlmMessage[],
    options: { json?: boolean; target?: LlmTarget } = {}
  ): Promise<string> {
    const config = this.resolve(options.target)

    let response = await this.post(config, messages, options.json ?? false)

    if (!response.ok && options.json && response.status === 400) {
      response = await this.post(config, messages, false)
    }

    if (!response.ok) {
      throw new LlmUnavailableError(
        `Le serveur LLM a répondu ${response.status} (${config.baseUrl}). ` +
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

  /**
   * Ce serveur répond-il ? `GET {baseUrl}/models`, avec le délai **de sonde**. Un
   * candidat éteint est un `false`, pas une exception : la détection les essaie tous.
   */
  async ping(baseUrl: string): Promise<boolean> {
    try {
      const response = await this.get(baseUrl, '/models')
      return response.ok
    } catch {
      return false
    }
  }

  /** Les modèles exposés par le serveur (`GET {baseUrl}/models`). Une liste vide est une réponse. */
  async listModels(baseUrl: string): Promise<string[]> {
    const response = await this.get(baseUrl, '/models')

    if (!response.ok) {
      throw new LlmUnavailableError(
        `Le serveur LLM a répondu ${response.status} (${normalizeBaseUrl(baseUrl)}/models).`
      )
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new LlmUnavailableError("Le serveur LLM n'a pas renvoyé de JSON sur /models.")
    }

    const entries = (payload as { data?: { id?: unknown }[] })?.data
    if (!Array.isArray(entries)) {
      throw new LlmUnavailableError(
        'La réponse de /models n\'a pas la forme attendue ({ "data": [{ "id": … }] }).'
      )
    }

    return entries
      .map((entry) => entry?.id)
      .filter((id): id is string => typeof id === 'string' && id.trim() !== '')
  }

  /**
   * La configuration de l'appel : celle du serveur, sauf ce que la cible remplace.
   *
   * ⚠️ La clé d'API reste celle de l'environnement : elle ne vient jamais du client, et
   * n'y repart jamais. L'hôte de la cible est borné par la liste blanche — c'est ce qui
   * empêche de faire porter la clé vers un hôte arbitraire.
   */
  private resolve(target?: LlmTarget): LlmConfig {
    if (!target) return this.config

    return {
      ...this.config,
      baseUrl: normalizeBaseUrl(target.baseUrl),
      model: target.model?.trim() || this.config.model,
    }
  }

  /** Un échec réseau (serveur éteint) et un dépassement de délai sont la même erreur ici. */
  private async post(config: LlmConfig, messages: LlmMessage[], json: boolean): Promise<Response> {
    try {
      return await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          // Une synthèse, pas une improvisation : on veut la même sortie sur le même cours.
          temperature: 0.2,
          ...(json ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: AbortSignal.timeout(config.timeoutMs),
      })
    } catch {
      throw new LlmUnavailableError(
        `Le serveur LLM (${config.baseUrl}) est injoignable ou n'a pas répondu ` +
          `en moins de ${Math.round(config.timeoutMs / 1000)} s.`
      )
    }
  }

  /** Lecture seule, et **délai de sonde** : c'est le diagnostic, pas une génération. */
  private async get(baseUrl: string, path: string): Promise<Response> {
    const url = `${normalizeBaseUrl(baseUrl)}${path}`

    try {
      return await fetch(url, {
        headers: this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {},
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
    } catch {
      throw new LlmUnavailableError(
        `Le serveur LLM (${normalizeBaseUrl(baseUrl)}) n'a pas répondu en moins de ` +
          `${PROBE_TIMEOUT_MS / 1000} s.`
      )
    }
  }
}
