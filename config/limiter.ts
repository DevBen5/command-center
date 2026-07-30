import env from '#start/env'
import { defineConfig, stores } from '@adonisjs/limiter'
import type { InferLimiters } from '@adonisjs/limiter/types'

/**
 * Compteurs de limitation de débit (CC-78). Un seul consommateur aujourd'hui :
 * le throttle de `POST /login` (`#core/auth/services/login_throttle_service`).
 *
 * ⚠️ `database` en dev et en prod — les compteurs survivent aux redémarrages :
 * redémarrer l'application ne rouvre pas une fenêtre de brute-force. `memory`
 * n'existe que pour les tests (`.env.test`), où chaque exécution repart à zéro
 * et où rien ne doit s'écrire dans `app_test` hors transaction.
 */
const limiterConfig = defineConfig({
  default: env.get('LIMITER_STORE'),
  stores: {
    database: stores.database({
      tableName: 'rate_limits',
    }),
    memory: stores.memory({}),
  },
})

export default limiterConfig

declare module '@adonisjs/limiter/types' {
  export interface LimitersList extends InferLimiters<typeof limiterConfig> {}
}
