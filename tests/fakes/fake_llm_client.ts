import LlmClient, {
  LlmUnavailableError,
  normalizeBaseUrl,
  type LlmMessage,
  type LlmTarget,
} from '#modules/leitner/services/llm_client'

/**
 * Faux client LLM : **aucun test n'appelle un vrai modèle**. La suite doit tourner
 * sans réseau, sans serveur chargé, et rendre le même résultat à chaque fois.
 *
 * Il se substitue au vrai client par injection : `new LeitnerIngestionService(fake, …)`
 * en unitaire, `app.container.swap(LlmClient, …)` en fonctionnel.
 *
 * Il couvre les deux usages : la génération (ingestion, test de l'écran de
 * configuration) et le **diagnostic** (sonde, liste des modèles) — sans quoi les tests
 * de `/revision/llm` iraient taper de vrais ports sur la machine qui les exécute.
 */
export default class FakeLlmClient extends LlmClient {
  /** Les conversations reçues, dans l'ordre : de quoi vérifier la réparation. */
  readonly calls: LlmMessage[][] = []

  /** Les cibles de chaque génération : `undefined` = la configuration chargée. */
  readonly targets: (LlmTarget | undefined)[] = []

  /** Les URL sondées : de quoi vérifier que la liste des candidats reste celle du code. */
  readonly pinged: string[] = []

  /**
   * @param responder Une liste de réponses (la dernière est rejouée si les appels
   *   dépassent), ou une fonction — qui peut lever, pour simuler un serveur injoignable.
   *   Elle peut rendre une promesse : c'est ce qui permet de **retenir** le modèle le
   *   temps de vérifier qu'une requête HTTP ne l'a pas attendu (l'asynchrone).
   * @param server Le serveur simulé : quelles URL répondent, et quels modèles elles
   *   exposent. Par défaut, aucune ne répond.
   */
  constructor(
    private responder:
      string[] | ((messages: LlmMessage[], call: number) => string | Promise<string>),
    private server: { reachable?: string[]; models?: string[] } = {}
  ) {
    super()
  }

  async complete(
    messages: LlmMessage[],
    options: { json?: boolean; target?: LlmTarget } = {}
  ): Promise<string> {
    const call = this.calls.length
    this.calls.push(messages)
    this.targets.push(options.target)

    if (typeof this.responder === 'function') return this.responder(messages, call)
    return this.responder[Math.min(call, this.responder.length - 1)]
  }

  async ping(baseUrl: string): Promise<boolean> {
    this.pinged.push(normalizeBaseUrl(baseUrl))
    return this.answers(baseUrl)
  }

  async listModels(baseUrl: string): Promise<string[]> {
    if (!this.answers(baseUrl)) {
      throw new LlmUnavailableError(`Le serveur LLM (${baseUrl}) est injoignable.`)
    }
    return this.server.models ?? []
  }

  private answers(baseUrl: string): boolean {
    return (this.server.reachable ?? []).map(normalizeBaseUrl).includes(normalizeBaseUrl(baseUrl))
  }
}
