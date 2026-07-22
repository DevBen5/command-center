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
 *
 * ⚠️ **Mais la liste blanche ne valide que l'URL saisie, et elle ne suffit donc pas à
 * elle seule** : elle ne dit rien de la cible d'un `Location`. Un hôte autorisé qui
 * répond `302` ferait sortir la requête du périmètre. Ce qui la complète est le refus
 * des redirections (`redirect: 'manual'` + `refuseRedirect`, plus bas) — les deux
 * ensemble font la garantie, jamais l'une sans l'autre.
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

/**
 * Température de l'**ingestion** : une synthèse, pas une improvisation — on veut la
 * même sortie sur le même cours.
 *
 * ⚠️ C'est le défaut de `complete()`, et il ne change pas. Un **juge**, lui, veut `0`
 * (voir `LeitnerJudgeService`) : il le demande explicitement, appel par appel. Ne fais
 * pas l'inverse — abaisser ce défaut « puisque le juge le veut » modifierait en
 * silence le comportement de l'ingestion, qui est le seul autre appelant.
 */
export const DEFAULT_TEMPERATURE = 0.2

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
   *
   * `temperature` et `timeoutMs` sont des **exceptions demandées appel par appel**, et
   * leurs défauts (`DEFAULT_TEMPERATURE`, `LLM_TIMEOUT_MS`) restent ceux de l'ingestion.
   * Le juge de révision les surcharge tous les deux : il veut `0` (une note, pas une
   * synthèse) et un délai court (l'utilisateur a la carte sous les yeux, il attend).
   */
  async complete(
    messages: LlmMessage[],
    options: {
      json?: boolean
      target?: LlmTarget
      temperature?: number
      timeoutMs?: number
    } = {}
  ): Promise<string> {
    const config = this.resolve(options.target)
    const tuning = {
      temperature: options.temperature ?? DEFAULT_TEMPERATURE,
      timeoutMs: options.timeoutMs ?? config.timeoutMs,
    }

    let response = await this.post(config, messages, options.json ?? false, tuning)

    if (!response.ok && options.json && response.status === 400) {
      response = await this.post(config, messages, false, tuning)
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

  /**
   * Une redirection est un **refus**, jamais un saut — c'est ce qui complète la liste
   * blanche SSRF.
   *
   * ⚠️ `isLocalLlmUrl` ne valide que l'**URL saisie**. Elle ne dit rien de la cible d'un
   * `Location` : un hôte loopback ou privé, accepté par la liste, qui répond
   * `302 Location: http://169.254.169.254/…` sortirait du périmètre, et le contenu
   * récupéré remonterait au client. `redirect: 'manual'` (posé sur les deux `fetch`)
   * rend la réponse 3xx telle quelle sans jamais appeler la cible ; ce contrôle-ci en
   * fait une erreur. Un serveur compatible OpenAI n'a aucune redirection légitime.
   *
   * ⚠️ **Il est appelé HORS du `try/catch` des deux méthodes, et ça n'est pas un
   * détail** : dedans, il serait avalé puis ré-écrit en « injoignable ou n'a pas répondu
   * en moins de N s » — le contraire de ce qui vient de se produire. Le serveur a
   * répondu, tout de suite ; envoyer chercher une panne réseau ferait perdre la journée
   * de qui a un reverse-proxy qui redirige.
   */
  private refuseRedirect(response: Response, baseUrl: string): void {
    if (response.status < 300 || response.status >= 400) return

    const location = response.headers.get('location')

    throw new LlmUnavailableError(
      `Le serveur LLM (${baseUrl}) a répondu par une redirection (${response.status}` +
        `${location ? ` vers ${location}` : ''}), refusée : la cible d'une redirection ` +
        `n'est pas vérifiée par la liste blanche. Renseigne directement l'URL finale.`
    )
  }

  /** Un échec réseau (serveur éteint) et un dépassement de délai sont la même erreur ici. */
  private async post(
    config: LlmConfig,
    messages: LlmMessage[],
    json: boolean,
    tuning: { temperature: number; timeoutMs: number }
  ): Promise<Response> {
    let response: Response

    try {
      response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature: tuning.temperature,
          ...(json ? { response_format: { type: 'json_object' } } : {}),
        }),
        // ⚠️ Le défaut d'undici est `follow` (20 sauts) : ce choix s'écrit, il ne
        // s'hérite pas. Voir `refuseRedirect`.
        redirect: 'manual',
        signal: AbortSignal.timeout(tuning.timeoutMs),
      })
    } catch {
      throw new LlmUnavailableError(
        `Le serveur LLM (${config.baseUrl}) est injoignable ou n'a pas répondu ` +
          `en moins de ${Math.round(tuning.timeoutMs / 1000)} s.`
      )
    }

    this.refuseRedirect(response, config.baseUrl)

    return response
  }

  /** Lecture seule, et **délai de sonde** : c'est le diagnostic, pas une génération. */
  private async get(baseUrl: string, path: string): Promise<Response> {
    const url = `${normalizeBaseUrl(baseUrl)}${path}`
    let response: Response

    try {
      response = await fetch(url, {
        headers: this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {},
        // Même raison que dans `post()` : la liste blanche ne couvre pas un `Location`.
        redirect: 'manual',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
    } catch {
      throw new LlmUnavailableError(
        `Le serveur LLM (${normalizeBaseUrl(baseUrl)}) n'a pas répondu en moins de ` +
          `${PROBE_TIMEOUT_MS / 1000} s.`
      )
    }

    this.refuseRedirect(response, normalizeBaseUrl(baseUrl))

    return response
  }
}
