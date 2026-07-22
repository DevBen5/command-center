import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import llmConfig from '#config/llm'
import {
  courseMessages,
  LlmParseError,
  parseLlmCards,
} from '#modules/leitner/services/leitner_ingestion_service'
import LlmClient, {
  LlmUnavailableError,
  normalizeBaseUrl,
} from '#modules/leitner/services/llm_client'
import {
  llmDetectValidator,
  llmModelsValidator,
  llmTestValidator,
} from '#modules/leitner/validators/leitner'

/**
 * Les serveurs sondés par « Détecter ». **La liste est en dur, et le restera** : une
 * liste de ports fournie par le client ferait de la détection un scanner de ports
 * téléguidé. Une URL saisie à la main s'y ajoute, une par requête, et passe par la
 * liste blanche (`llmDetectValidator`).
 */
export const LLM_CANDIDATES = [
  { label: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1' },
  { label: 'llama.cpp', baseUrl: 'http://127.0.0.1:8080/v1' },
  { label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1' },
] as const

/**
 * L'extrait de cours de la génération de contrôle. **En dur** : ce qu'on teste, c'est
 * le modèle, pas une saisie. Court, pour que l'attente reste tenable sur un petit
 * modèle, mais assez dense pour porter deux ou trois principes.
 */
const SAMPLE_COURSE = `# Le handshake TLS

Le handshake TLS a deux buts : authentifier le serveur (par son certificat, signé par
une autorité de certification) et négocier une clé de session symétrique, qui chiffrera
ensuite tout le trafic. Le chiffrement asymétrique ne sert qu'à cette négociation : il
est trop lent pour chiffrer les données elles-mêmes.`

/**
 * Écran de configuration du LLM (`/revision/llm`) : détecter le serveur, lister ses
 * modèles, lancer une vraie génération, et **rendre le bloc à copier** dans `.env`.
 *
 * ⚠️ **Aucune de ces routes n'écrit quoi que ce soit** : ni en base, ni sur le disque.
 * L'assistant ne persiste rien — la configuration que le serveur utilise réellement
 * vient de l'environnement, lu **au démarrage** (`config/llm.ts`). Écrire `.env` depuis
 * une requête web offrirait une surface pour économiser un copier-coller, et sous Docker
 * le fichier du conteneur n'est de toute façon pas la source de vérité.
 *
 * ⚠️ Toutes les URL venues du client passent par la **liste blanche** (loopback et
 * plages privées) : sans elle, l'écran serait une SSRF. Voir les validateurs du module.
 *
 * ⚠️ `LlmClient` est **injecté** : les tests tournent contre un faux client, sans réseau.
 * Aucun `fetch` en dur ici.
 */
@inject()
export default class LeitnerLlmController {
  constructor(private llm: LlmClient) {}

  async index({ inertia }: HttpContext) {
    return inertia.render('modules/leitner/llm', {
      // La configuration **chargée** — celle de l'environnement, la seule qui compte.
      current: {
        baseUrl: llmConfig.baseUrl,
        model: llmConfig.model,
        timeoutMs: llmConfig.timeoutMs,
        // ⚠️ La clé ne repart jamais vers le client : on dit qu'elle existe, pas ce
        // qu'elle vaut.
        hasApiKey: Boolean(llmConfig.apiKey),
      },
      candidates: LLM_CANDIDATES,
      sample: SAMPLE_COURSE,
    })
  }

  /** Étape 1 — un serveur LLM tourne. Sonde courte (`PROBE_TIMEOUT_MS`), en parallèle. */
  async detect({ request, response }: HttpContext) {
    const { baseUrl } = await request.validateUsing(llmDetectValidator)

    const targets: { label: string; baseUrl: string }[] = LLM_CANDIDATES.map((candidate) => ({
      ...candidate,
    }))

    // L'URL saisie à la main, si elle n'est pas déjà un candidat.
    const manual = baseUrl ? normalizeBaseUrl(baseUrl) : null
    if (manual && !targets.some((target) => target.baseUrl === manual)) {
      targets.push({ label: 'Saisie manuelle', baseUrl: manual })
    }

    const candidates = await Promise.all(
      targets.map(async (target) => ({ ...target, ok: await this.llm.ping(target.baseUrl) }))
    )

    return response.json({ candidates })
  }

  /** Étape 2 — un modèle est chargé. Une liste vide est une réponse, pas une panne. */
  async models({ request, response }: HttpContext) {
    const { baseUrl } = await request.validateUsing(llmModelsValidator)

    try {
      return response.json({ ok: true, models: await this.llm.listModels(baseUrl), error: null })
    } catch (error) {
      if (error instanceof LlmUnavailableError) {
        return response.json({ ok: false, models: [], error: error.message })
      }
      throw error
    }
  }

  /**
   * Étape 3 — le modèle sait produire du JSON. **C'est l'étape qui porte le ticket** :
   * une vraie génération, avec le prompt de l'ingestion (`courseMessages`) et **le même
   * parsing** (`parseLlmCards`). Un petit modèle qui rend de la prose au lieu du JSON se
   * voit ici, et nulle part ailleurs.
   *
   * Sans `baseUrl`, c'est la configuration chargée qui est testée : le bandeau d'état.
   *
   * ⚠️ En mémoire, du début à la fin : aucune carte, aucun brouillon, aucune ingestion.
   * Une seule tentative, sans la réparation de l'ingestion — un modèle qu'il faut
   * réparer sur quatre lignes de cours n'est pas un modèle utilisable.
   */
  async test({ request, response }: HttpContext) {
    const { baseUrl, model } = await request.validateUsing(llmTestValidator)

    const target = {
      baseUrl: baseUrl ?? llmConfig.baseUrl,
      model: model ?? llmConfig.model,
    }

    try {
      const raw = await this.llm.complete(courseMessages(SAMPLE_COURSE, 1, 1), {
        json: true,
        target,
      })
      const cards = await parseLlmCards(raw)

      if (cards.length === 0) {
        return response.json({
          ok: false,
          cards: [],
          error: "Le modèle a rendu du JSON valide, mais aucune carte. Il n'a rien extrait.",
        })
      }

      return response.json({ ok: true, cards, error: null })
    } catch (error) {
      if (error instanceof LlmUnavailableError || error instanceof LlmParseError) {
        // L'échec brut, tel que le modèle l'a produit : c'est l'information utile.
        return response.json({ ok: false, cards: [], error: error.message })
      }
      throw error
    }
  }
}
