import limiter from '@adonisjs/limiter/services/main'

export interface ReauthThrottleLimits {
  /** Échecs tolérés avant blocage. */
  failures: number
  /** La fenêtre glissante — comme `LoginThrottleService`, il n'y a pas de blocage séparé. */
  duration: string | number
}

/**
 * Le throttle d'une preuve fraîche avant un geste qui défait la sécurité du compte —
 * changer son propre mot de passe (CC-147), et demain désactiver le second facteur,
 * régénérer ses codes de secours ou recommencer un enrôlement (CC-123, même besoin).
 *
 * ⚠️ **Il ne vérifie rien lui-même**, exactement comme `LoginThrottleService` (CC-78) ne
 * vérifie pas les identifiants : il compte les échecs, l'appelant vérifie la preuve
 * (mot de passe via `User.verifyCredentials`, ou demain un code TOTP) et le pilote. C'est ce
 * découplage qui le rend réutilisable par CC-123 pour sa preuve TOTP sans toucher à ce fichier.
 *
 * ⚠️ **Une seule dimension : le compte, jamais l'IP.** Contrairement à `POST /login`, où un
 * attaquant sans rien peut arroser des emails depuis une IP, ici l'attaquant tient déjà une
 * session valide — elle ne désigne qu'**un** compte, le sien. Faire varier l'IP ne lui ouvre
 * aucun compte de plus ; une dimension IP ne mesurerait donc rien que la dimension compte ne
 * mesure déjà.
 */
export class ReauthThrottleService {
  #limits: ReauthThrottleLimits

  constructor(limits: ReauthThrottleLimits = { failures: 5, duration: '15 mins' }) {
    this.#limits = limits
  }

  /** `limiter.use` met en cache par options : récupérer l'instance à chaque appel est gratuit. */
  get #limiter() {
    return limiter.use({ requests: this.#limits.failures, duration: this.#limits.duration })
  }

  #key(userId: number): string {
    return `reauth_${userId}`
  }

  /**
   * Secondes avant de pouvoir réessayer, ou `0` si rien ne bloque.
   *
   * À appeler **avant** de vérifier la preuve : un client bloqué ne doit pas consommer un
   * scrypt (mot de passe) ou une comparaison TOTP — c'est précisément le travail qu'on rationne.
   */
  async secondsBeforeRetry(userId: number): Promise<number> {
    const key = this.#key(userId)
    if (!(await this.#limiter.isBlocked(key))) return 0
    return this.#limiter.availableIn(key)
  }

  /** Une preuve refusée : le compteur avance. */
  async recordFailure(userId: number): Promise<void> {
    await this.#limiter.increment(this.#key(userId))
  }

  /** Une preuve acceptée efface l'ardoise de ce compte. */
  async clearFor(userId: number): Promise<void> {
    await this.#limiter.delete(this.#key(userId))
  }
}

export default new ReauthThrottleService()
