import type { ApplicationService } from '@adonisjs/core/types'
import installationService from '#core/auth/services/installation_service'
import installationToken from '#core/auth/services/installation_token_service'

/**
 * Imprime le jeton d'installation dans les journaux au démarrage — seulement tant que la
 * base ne porte aucun compte (CC-138, modèle Jenkins). Qui déploie lit déjà les journaux :
 * c'est la vérification n°4 du guide de déploiement.
 *
 * ⚠️ **Le jeton ne s'imprime que si `users` est vide, et se relit à chaque démarrage** : il
 * vit en mémoire (`InstallationTokenService`), meurt avec le processus, et les journaux
 * portent donc toujours la valeur courante. Dès qu'un compte existe, plus rien ne s'imprime
 * — un secret qui ne sert plus ne traverse plus un journal.
 *
 * ⚠️ `environment: ['web']` (adonisrc.ts) : seul le processus qui sert des requêtes a un
 * écran d'installation à ouvrir — `node ace migration:run` n'en a pas. Et le try/catch n'est
 * pas décoratif : au tout premier boot d'une installation, la table `users` peut ne pas
 * exister encore (serveur lancé avant les migrations) — refuser de démarrer pour ça
 * empêcherait précisément de jouer les migrations qui la créent.
 */
export default class InstallationProvider {
  constructor(protected app: ApplicationService) {}

  async ready() {
    const logger = await this.app.container.make('logger')

    try {
      if (!(await installationService.isOpen())) return
    } catch {
      logger.warn(
        `Impossible de lire la table « users » (migrations pas encore jouées ?) : le jeton ` +
          `d'installation ne peut pas être imprimé. Joue « node ace migration:run » puis ` +
          `redémarre.`
      )
      return
    }

    logger.info(
      `La base ne porte aucun compte : l'écran d'installation est ouvert sur /installation. ` +
        `Jeton d'installation : ${installationToken.current()}`
    )
  }
}
