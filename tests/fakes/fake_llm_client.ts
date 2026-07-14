import LlmClient, { type LlmMessage } from '#modules/leitner/services/llm_client'

/**
 * Faux client LLM : **aucun test n'appelle un vrai modèle**. La suite doit tourner
 * sans réseau, sans serveur chargé, et rendre le même résultat à chaque fois.
 *
 * Il se substitue au vrai client par injection : `new LeitnerIngestionService(fake, …)`
 * en unitaire, `app.container.swap(LlmClient, …)` en fonctionnel.
 */
export default class FakeLlmClient extends LlmClient {
  /** Les conversations reçues, dans l'ordre : de quoi vérifier la réparation. */
  readonly calls: LlmMessage[][] = []

  /**
   * Une liste de réponses (la dernière est rejouée si les appels dépassent), ou une
   * fonction — qui peut lever, pour simuler un serveur injoignable.
   */
  constructor(private responder: string[] | ((messages: LlmMessage[], call: number) => string)) {
    super()
  }

  async complete(messages: LlmMessage[]): Promise<string> {
    const call = this.calls.length
    this.calls.push(messages)

    if (typeof this.responder === 'function') return this.responder(messages, call)
    return this.responder[Math.min(call, this.responder.length - 1)]
  }
}
