import type { ApplicationService } from '@adonisjs/core/types'

/**
 * Le point d'accroche de la **collecte automatique** des flux de veille.
 *
 * Comme l'ingestion Leitner, la collecte tourne en tâche de fond **dans le processus Node** :
 * ce projet n'a aucune infrastructure de job, et le lot 1 n'en introduit pas une. Le provider
 * démarre la boucle au boot et l'arrête à l'extinction.
 *
 * ⚠️ Enregistré dans `adonisrc.ts` sous `environment: ['web']` — comme le provider Leitner, et
 * pour la même raison : seul le processus qui sert les requêtes a une collecte à faire tourner.
 * En `console` (`node ace migration:run`) la table peut ne pas exister encore ; en `test`, une
 * boucle de fond irait chercher de vrais flux sur le réseau pendant que la suite s'exécute — les
 * tests appellent le collecteur directement, avec un faux fetcher.
 *
 * ⚠️ Contrairement à Leitner, **aucun balayage au démarrage** : la collecte ne persiste aucun
 * statut « en cours », donc un redémarrage en pleine passe ne laisse rien de sale derrière lui.
 * La passe est idempotente (contrainte d'unicité sur `dedup_key`) et sera rejouée au tick suivant.
 */
export default class VeilleProvider {
  constructor(protected app: ApplicationService) {}

  async ready() {
    const logger = await this.app.container.make('logger')

    try {
      const { startScheduler } = await import('#modules/veille/services/veille_scheduler')
      startScheduler()
    } catch (error) {
      // Le serveur démarre quand même — mais sans ce log, la collecte serait simplement
      // absente, et un agrégateur silencieux ressemble trait pour trait à un sujet calme.
      logger.error({ err: error }, 'Veille : le démarrage de la collecte automatique a échoué.')
    }
  }

  async shutdown() {
    const { stopScheduler } = await import('#modules/veille/services/veille_scheduler')
    stopScheduler()
  }
}
