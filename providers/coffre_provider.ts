import type { ApplicationService } from '@adonisjs/core/types'
import modules from '#config/modules'

/**
 * Ferme la session Immich élevée du dossier verrouillé à l'arrêt du serveur (CC-205).
 *
 * ⚠️ **« Ferme ce que tu ouvres » ne s'arrête pas au renouvellement.** `ImmichSessionClient`
 * referme déjà la session précédente avant d'en établir une nouvelle (voir son fichier) — ça
 * couvre l'usage normal. Ça ne couvre PAS un redémarrage : l'état vit en mémoire du process
 * (`immich_session_state.ts`), donc il disparaît sans jamais notifier Immich, qui garderait la
 * session dans sa liste d'appareils autorisés indéfiniment. Un redémarrage propre (déploiement,
 * `git pull`, `docker compose restart`) est le cas courant sur la durée de vie d'une installation
 * — largement plus fréquent qu'un crash, que ce hook ne peut de toute façon pas couvrir.
 *
 * `web` seulement, comme les autres providers de tâche de fond : ni une commande ace, ni les
 * tests n'ouvrent de session Immich à fermer.
 */
export default class CoffreProvider {
  constructor(protected app: ApplicationService) {}

  async shutdown() {
    if (!modules.has('coffre')) return

    const logger = await this.app.container.make('logger')

    try {
      const { default: ImmichSessionClient } =
        await import('#modules/coffre/services/immich_session_client')
      await new ImmichSessionClient().closeSession()
    } catch (error) {
      logger.error({ err: error }, 'Coffre : la fermeture de la session Immich a échoué.')
    }
  }
}
