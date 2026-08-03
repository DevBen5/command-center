import type { ApplicationService } from '@adonisjs/core/types'
import appUrl from '#config/app_url'

/**
 * Avertit — sans jamais bloquer — quand `APP_URL` sert l'application en HTTP sur un hôte qui
 * n'est ni `localhost` ni une boucle locale (CC-136). Refuser de démarrer serait excessif (ça
 * peut être un réseau de confiance) ; se taire serait mensonger : les mots de passe et les
 * cookies de session circuleraient alors en clair sur le réseau.
 *
 * ⚠️ **La logique vit dans `ready()`, pas dans `config/app_url.ts`.** Le `logger` du conteneur
 * n'est disponible qu'une fois les providers enregistrés ; `config/app_url.ts` est importé bien
 * avant, à la lecture de la config (même raison que `veille_provider`/`leitner_provider`, qui
 * font le même `this.app.container.make('logger')` avant de journaliser au boot).
 *
 * ⚠️ `environment: ['web']` (adonisrc.ts) : la ligne ne concerne que le processus qui sert
 * réellement des requêtes — un `node ace migration:run` n'a rien à avertir.
 */
export default class AppUrlProvider {
  constructor(protected app: ApplicationService) {}

  async ready() {
    if (!appUrl.isInsecureNonLoopback) return

    const logger = await this.app.container.make('logger')
    logger.warn(
      `APP_URL="${appUrl.url.href}" sert l'application en HTTP sur un hôte non local : les ` +
        'mots de passe et les cookies de session circuleraient en clair sur le réseau. Passe ' +
        'cette installation en HTTPS si elle est accessible au-delà de cette machine.'
    )
  }
}
