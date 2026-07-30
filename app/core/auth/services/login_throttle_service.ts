import limiter from '@adonisjs/limiter/services/main'

/**
 * Les seuils du throttle. Injectables pour une raison unique : prouver la
 * remise à zéro après la fenêtre sans dormir 15 minutes dans un test —
 * `login_throttle.spec.ts` instancie le service avec une fenêtre d'une seconde.
 */
export interface LoginThrottleLimits {
  /** Échecs tolérés par adresse IP, tous comptes confondus. */
  ipFailures: number
  /** Échecs tolérés par email, toutes IP confondues. */
  emailFailures: number
  /** La fenêtre glissante — c'est elle qui débloque, il n'y a pas de blocage séparé. */
  duration: string | number
}

/**
 * Throttle de `POST /login` (CC-78) : par IP **et** par email.
 *
 * Seuls les **échecs** comptent, et un succès efface les compteurs : deux
 * collègues derrière le même NAT ne se verrouillent jamais mutuellement en se
 * connectant normalement. Le seuil IP est plus haut que le seuil email — il
 * attrape l'attaquant qui arrose beaucoup de comptes depuis une machine, quand
 * le seuil email attrape celui qui vise un compte depuis beaucoup de machines.
 *
 * ⚠️ Le blocage par email est un déni de service assumé : quiconque connaît un
 * email peut le bloquer 15 minutes. La fenêtre courte borne la nuisance, et
 * l'alternative — ne throttler que l'IP — laisserait passer le brute-force
 * distribué que le ticket demande d'arrêter.
 *
 * ⚠️ L'atomicité des compteurs vient du store (`rate-limiter-flexible`), pas
 * d'ici : aucun lire-modifier-écrire maison, deux requêtes simultanées ne
 * perdent pas d'incrément.
 */
export class LoginThrottleService {
  #limits: LoginThrottleLimits

  constructor(
    limits: LoginThrottleLimits = { ipFailures: 10, emailFailures: 5, duration: '15 mins' }
  ) {
    this.#limits = limits
  }

  /** `limiter.use` met en cache par options : récupérer l'instance à chaque appel est gratuit. */
  get #ipLimiter() {
    return limiter.use({ requests: this.#limits.ipFailures, duration: this.#limits.duration })
  }

  get #emailLimiter() {
    return limiter.use({ requests: this.#limits.emailFailures, duration: this.#limits.duration })
  }

  #ipKey(ip: string): string {
    return `login_ip_${ip}`
  }

  /** Normalisé : `Alice@…` et `alice@…` désignent le même compte, donc le même compteur. */
  #emailKey(email: string): string {
    return `login_email_${email.trim().toLowerCase()}`
  }

  /**
   * Secondes avant de pouvoir réessayer, ou `0` si rien ne bloque.
   *
   * À appeler **avant** `verifyCredentials` : un client bloqué ne doit pas
   * consommer un scrypt — c'est précisément le travail qu'on rationne.
   */
  async secondsBeforeRetry(ip: string, email: string): Promise<number> {
    const [ipBlocked, emailBlocked] = await Promise.all([
      this.#ipLimiter.isBlocked(this.#ipKey(ip)),
      this.#emailLimiter.isBlocked(this.#emailKey(email)),
    ])

    const waits = await Promise.all([
      ipBlocked ? this.#ipLimiter.availableIn(this.#ipKey(ip)) : Promise.resolve(0),
      emailBlocked ? this.#emailLimiter.availableIn(this.#emailKey(email)) : Promise.resolve(0),
    ])

    return Math.max(...waits)
  }

  /** Un échec de connexion : les deux compteurs avancent. */
  async recordFailure(ip: string, email: string): Promise<void> {
    await Promise.all([
      this.#ipLimiter.increment(this.#ipKey(ip)),
      this.#emailLimiter.increment(this.#emailKey(email)),
    ])
  }

  /** Une connexion réussie efface l'ardoise de cette IP et de cet email. */
  async clearFor(ip: string, email: string): Promise<void> {
    await Promise.all([
      this.#ipLimiter.delete(this.#ipKey(ip)),
      this.#emailLimiter.delete(this.#emailKey(email)),
    ])
  }
}

export default new LoginThrottleService()
