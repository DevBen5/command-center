import limiter from '@adonisjs/limiter/services/main'

/**
 * Les seuils du throttle. Injectables pour la même raison unique que
 * `LoginThrottleService` : prouver la fenêtre dans un test sans dormir 15 minutes.
 */
export interface InstallationThrottleLimits {
  /** Échecs de jeton tolérés par adresse IP. */
  ipFailures: number
  /** La fenêtre glissante — c'est elle qui débloque, il n'y a pas de blocage séparé. */
  duration: string | number
}

/**
 * Throttle de `POST /installation` (CC-138) : le même que `/login` (CC-78), exigé par le
 * ticket — sans lui, un jeton se force en ligne et le lot n'aurait déplacé la porte que
 * d'un cran.
 *
 * Par IP seulement : il n'y a pas d'email à compter, le formulaire ne vise aucun compte
 * existant. Seuls les **échecs de jeton** comptent — une erreur de validation (mot de passe
 * trop court) n'est pas une attaque, et la compter permettrait de se verrouiller soi-même
 * en corrigeant son formulaire.
 *
 * ⚠️ L'atomicité des compteurs vient du store (`rate-limiter-flexible`), pas d'ici — même
 * contrat que `LoginThrottleService`.
 */
export class InstallationThrottleService {
  #limits: InstallationThrottleLimits

  constructor(limits: InstallationThrottleLimits = { ipFailures: 10, duration: '15 mins' }) {
    this.#limits = limits
  }

  /** `limiter.use` met en cache par options : récupérer l'instance à chaque appel est gratuit. */
  get #ipLimiter() {
    return limiter.use({ requests: this.#limits.ipFailures, duration: this.#limits.duration })
  }

  #key(ip: string): string {
    return `installation_ip_${ip}`
  }

  /**
   * Secondes avant de pouvoir réessayer, ou `0` si rien ne bloque. À appeler **avant** la
   * comparaison du jeton : un client bloqué ne doit rien apprendre de plus.
   */
  async secondsBeforeRetry(ip: string): Promise<number> {
    const bloque = await this.#ipLimiter.isBlocked(this.#key(ip))
    return bloque ? this.#ipLimiter.availableIn(this.#key(ip)) : 0
  }

  /** Un jeton refusé : le compteur avance. */
  async recordFailure(ip: string): Promise<void> {
    await this.#ipLimiter.increment(this.#key(ip))
  }
}

export default new InstallationThrottleService()
