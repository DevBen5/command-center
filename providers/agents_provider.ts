import type { ApplicationService } from '@adonisjs/core/types'
import modules from '#config/modules'
import agentsConfig from '#config/agents'

/**
 * Synchronise les agents depuis leur fichier de déclaration au démarrage (CC-141).
 *
 * ⚠️ **Trois issues, pas deux** — voir `app/modules/agents/CLAUDE.md` pour la justification
 * complète :
 *
 * - fichier absent → module vide sur une base vide (installation neuve, aucune erreur) ; sur une
 *   base qui porte déjà des agents, **avertissement et synchronisation abandonnée** — un volume
 *   non monté ne supprime rien, voir `syncAgentsFromFile` ;
 * - fichier illisible ou malformé → **log bruyant**, synchronisation **abandonnée** : la base
 *   garde son état précédent plutôt que de se faire vider sur la foi d'un contenu qu'on ne
 *   comprend pas ;
 * - fichier valide → synchronisation déclarative complète, suppressions comprises.
 *
 * `web` seulement, comme `LeitnerProvider`/`VeilleProvider` : ni `node ace`, ni les tests n'ont
 * de fichier à synchroniser (le module est de toute façon gated par `modules.has('agents')`).
 */
export default class AgentsProvider {
  constructor(protected app: ApplicationService) {}

  async ready() {
    if (!modules.has('agents')) return

    const logger = await this.app.container.make('logger')

    const { loadAgentsFile } = await import('#modules/agents/services/agents_file_service')
    const resultat = await loadAgentsFile(agentsConfig.path)

    if (!resultat.ok) {
      logger.error(
        { err: resultat.error, path: agentsConfig.path },
        'Agents : fichier de déclaration illisible — synchronisation ignorée, les agents existants restent inchangés.'
      )
      return
    }

    const { syncAgentsFromFile } = await import('#modules/agents/services/agents_sync_service')
    const issue = await syncAgentsFromFile(resultat)

    if (!issue.applied) {
      logger.warn(
        { path: agentsConfig.path, existing: issue.existing },
        'Agents : fichier de déclaration absent alors que la base porte déjà des agents — ' +
          'synchronisation ignorée, aucun agent supprimé. Monter le fichier, ou y déclarer ' +
          '`{"agents": []}` pour vider explicitement.'
      )
      return
    }

    const { created, updated, deleted } = issue.result

    logger.info(
      { created, updated, deleted, path: agentsConfig.path },
      'Agents : synchronisation depuis le fichier de déclaration.'
    )
  }
}
