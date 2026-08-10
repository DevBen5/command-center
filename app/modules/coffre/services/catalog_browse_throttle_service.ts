import limiter from '@adonisjs/limiter/services/main'

export interface CatalogBrowseThrottleLimits {
  requests: number
  duration: string | number
}

/**
 * Le throttle de `GET /coffre/catalog/items` (CC-227) — **jamais** `ReauthThrottleService`
 * réutilisé tel quel : celui-ci compte les échecs d'une preuve fraîche avant la porte
 * (`reauth_<userId>`), et le partager ferait consommer le budget d'essais d'ouverture du coffre
 * par la simple pagination/recherche de la grille. Compteur et clé séparés.
 *
 * ⚠️ **Ce n'est pas un throttle « d'échecs »** comme `ReauthThrottleService`/`LoginThrottleService` :
 * il n'y a rien à échouer sur une lecture. Chaque requête compte, qu'elle rende des résultats ou
 * non — c'est ce qui borne un usage automatisé de la route pour énumérer le catalogue à l'aveugle,
 * sans gêner l'usage normal de l'écran (pagination, filtres, recherche au fil de la frappe).
 */
export class CatalogBrowseThrottleService {
  #limits: CatalogBrowseThrottleLimits

  constructor(limits: CatalogBrowseThrottleLimits = { requests: 60, duration: '1 min' }) {
    this.#limits = limits
  }

  /** `limiter.use` met en cache par options : récupérer l'instance à chaque appel est gratuit. */
  get #limiter() {
    return limiter.use({ requests: this.#limits.requests, duration: this.#limits.duration })
  }

  #key(userId: number): string {
    return `catalog_browse_${userId}`
  }

  /**
   * Secondes avant de pouvoir réessayer, ou `0` si rien ne bloque.
   *
   * À appeler **avant** d'exécuter la requête SQL — c'est elle qu'on rationne.
   */
  async secondsBeforeRetry(userId: number): Promise<number> {
    const key = this.#key(userId)
    if (!(await this.#limiter.isBlocked(key))) return 0
    return this.#limiter.availableIn(key)
  }

  /** Chaque requête compte, qu'elle rende des résultats ou non. */
  async recordRequest(userId: number): Promise<void> {
    await this.#limiter.increment(this.#key(userId))
  }
}

export default new CatalogBrowseThrottleService()
