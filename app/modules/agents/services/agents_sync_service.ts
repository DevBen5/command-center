import db from '@adonisjs/lucid/services/db'
import Agent from '#modules/agents/models/agent'
import type { AgentDeclaration } from '#config/agents'

export interface AgentsSyncResult {
  created: number
  updated: number
  deleted: number
}

/**
 * Ce que le boot a réellement fait — `applied: false` signalant la seule issue où l'on renonce
 * volontairement à synchroniser une lecture pourtant réussie. Voir `syncAgentsFromFile`.
 */
export type AgentsSyncOutcome =
  { applied: true; result: AgentsSyncResult } | { applied: false; existing: number }

/**
 * Applique la politique du démarrage à une lecture réussie du fichier (CC-141).
 *
 * ⚠️ **Un fichier ABSENT ne supprime jamais rien.** C'est la seule différence avec
 * `syncAgentsFromDeclarations`, et elle existe parce qu'« absent » et « `{"agents": []}` »
 * produisent la même liste vide sans vouloir dire la même chose :
 *
 * - le second est un **geste explicite** — quelqu'un a écrit un fichier pour dire « zéro agent »,
 *   la suppression est ce qu'il demande ;
 * - le premier est, en production, le cas **par défaut** : la ligne de volume de
 *   `docker-compose.prod.yml` est commentée, et `AGENTS_CONFIG_PATH` pointe un chemin qui
 *   n'existe alors pas dans le conteneur. Traiter cette absence comme « supprime tout » ferait
 *   d'un volume non monté — l'erreur d'opérateur la plus banale — la plus destructive.
 *
 * C'est la doctrine déjà écrite ailleurs dans ce dépôt pour exactement ce dilemme :
 * `BACKUP_MIRROR_DIR` doit exister et n'est **jamais** créé, et la purge de `db:backup` vient en
 * dernier pour qu'un NAS débranché ne fasse disparaître aucun dump. Un support non monté ne
 * détruit pas.
 *
 * Sur une base **vide**, l'absence reste parfaitement silencieuse : c'est l'installation neuve
 * que le ticket décrivait, il n'y a rien à préserver et rien à signaler.
 */
export async function syncAgentsFromFile(fichier: {
  present: boolean
  declarations: AgentDeclaration[]
}): Promise<AgentsSyncOutcome> {
  if (!fichier.present) {
    const existants = await Agent.query().select('id')

    if (existants.length > 0) {
      return { applied: false, existing: existants.length }
    }
  }

  return { applied: true, result: await syncAgentsFromDeclarations(fichier.declarations) }
}

/**
 * Synchronise la table `agents` sur l'ensemble déclaré par le fichier (CC-141).
 *
 * ⚠️ **Synchronisation DÉCLARATIVE complète, pas un delta.** Un agent dont le nom n'est plus
 * dans `declarations` est **supprimé** — `logs`/`status` compris. Le fichier décrit l'ensemble
 * voulu des agents, pas une liste d'ajouts : c'est ce qui rend « retirer un agent du fichier »
 * un geste explicite et prévisible, plutôt qu'un état orphelin qui traînerait sans qu'on l'ait
 * demandé. Documenté en toutes lettres dans `app/modules/agents/CLAUDE.md`.
 *
 * `status` et `logs` sont en revanche **préservés** sur une mise à jour : le fichier ne pilote
 * que la configuration (`name`/`framework`/`config`), jamais l'état d'exécution.
 *
 * ⚠️ **Sous transaction** : un échec en cours de synchronisation (perte de connexion, requête en
 * échec) ne doit jamais laisser une partie des agents mis à jour et l'autre non — l'appelant
 * (`AgentsProvider`) rejoue la synchronisation entière au redémarrage suivant, une synchro à
 * moitié appliquée n'aiderait personne.
 */
export async function syncAgentsFromDeclarations(
  declarations: AgentDeclaration[]
): Promise<AgentsSyncResult> {
  return db.transaction(async (trx) => {
    const existants = await Agent.query({ client: trx })
    const parNom = new Map(existants.map((agent) => [agent.name, agent]))
    const nomsDeclares = new Set(declarations.map((declaration) => declaration.name))

    let created = 0
    let updated = 0

    for (const declaration of declarations) {
      const existant = parNom.get(declaration.name)

      if (existant) {
        existant.framework = declaration.framework
        existant.config = declaration.config
        await existant.useTransaction(trx).save()
        updated += 1
      } else {
        await Agent.create(
          {
            name: declaration.name,
            framework: declaration.framework,
            config: declaration.config,
            status: 'idle',
            logs: [],
          },
          { client: trx }
        )
        created += 1
      }
    }

    const aSupprimer = existants.filter((agent) => !nomsDeclares.has(agent.name))
    for (const agent of aSupprimer) {
      await agent.useTransaction(trx).delete()
    }

    return { created, updated, deleted: aSupprimer.length }
  })
}
