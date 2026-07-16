import type { ApplicationService } from '@adonisjs/core/types'

/**
 * Le point d'accroche du **balayage au démarrage** de l'ingestion Leitner.
 *
 * L'ingestion d'un cours tourne en tâche de fond **dans le processus Node** : ce projet
 * n'a aucune infrastructure de job. Un redémarrage du serveur tue donc les travaux en
 * vol sans que personne ne les reprenne, et leur ligne reste en `running` — la page de
 * suivi tournerait indéfiniment sur une barre qui n'avancera plus. Ils sont passés en
 * `failed`, avec un message qui dit exactement ça.
 *
 * ⚠️ C'est le **cinquième fichier hors du module** (voir `app/modules/leitner/CLAUDE.md`),
 * et il est enregistré dans `adonisrc.ts` — sous `environment: ['web']` : le balayage
 * n'a de sens que pour le processus qui sert les requêtes. En `console` (`node ace
 * migration:run`) ou en `test`, il n'y a pas de tâche de fond à récupérer, et la table
 * peut même ne pas exister encore.
 */
export default class LeitnerProvider {
  constructor(protected app: ApplicationService) {}

  async ready() {
    const logger = await this.app.container.make('logger')

    try {
      const { sweepInterruptedIngestions } =
        await import('#modules/leitner/services/leitner_ingestion_service')
      await sweepInterruptedIngestions()
    } catch (error) {
      // Une base injoignable au boot n'empêche pas le serveur de démarrer — mais elle
      // ne passe pas non plus en silence : sans ce log, des `running` fantômes
      // resteraient à l'écran sans que rien n'explique pourquoi.
      logger.error({ err: error }, 'Leitner : le balayage des ingestions interrompues a échoué.')
    }
  }
}
