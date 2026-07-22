import os from 'node:os'
import { DateTime } from 'luxon'
import Service from '#modules/services/models/service'
import Agent from '#modules/agents/models/agent'
import VeilleItem from '#modules/veille/models/veille_item'
import LeitnerCard from '#modules/leitner/models/leitner_card'

/**
 * ⚠️ Chaque section vaut `null` quand celui qui regarde n'y a pas accès — à distinguer d'un
 * compteur à zéro, qui veut dire « accès accordé, rien à signaler ». Le layout s'appuie sur
 * cette différence pour choisir entre masquer l'entrée et afficher une pastille neutre.
 */
export interface NavStats {
  services: { total: number; down: number } | null
  agents: { total: number; failed: number } | null
  veille: { queue: number } | null
  leitner: { due: number } | null
  host: string
}

/** Ce qu'on sait de celui qui regarde, sans avoir à charger le modèle User ici. */
export interface NavViewer {
  isAdmin: boolean
  capabilities: Set<string>
}

async function countWhere<T extends typeof Service | typeof Agent>(
  model: T,
  column: string,
  value: string
): Promise<number> {
  const rows = await model.query().where(column, value).count('* as total')
  return Number(rows[0].$extras.total)
}

export default class NavStatsService {
  /**
   * Les compteurs de la barre latérale, **réduits à ce que le lecteur peut voir**.
   *
   * Le masquage de l'entrée dans la barre est du confort : la route reste fermée quoi qu'il
   * arrive. Mais un compteur est déjà une information — « 12 items en file de lecture »
   * en dit sur un module auquel on n'a pas accès. Autant ne pas l'envoyer.
   */
  async collect(viewer: NavViewer): Promise<NavStats> {
    const today = DateTime.now().startOf('day')
    const can = (capability: string) => viewer.isAdmin || viewer.capabilities.has(capability)

    // Services et Agents sont réservés à `is_admin` : aucune capacité n'y donne accès.
    const [services, agents, veille, leitner] = await Promise.all([
      viewer.isAdmin
        ? Promise.all([
            Service.query()
              .count('* as total')
              .then((r) => Number(r[0].$extras.total)),
            countWhere(Service, 'status', 'down'),
          ]).then(([total, down]) => ({ total, down }))
        : null,
      viewer.isAdmin
        ? Promise.all([
            Agent.query()
              .count('* as total')
              .then((r) => Number(r[0].$extras.total)),
            countWhere(Agent, 'status', 'failed'),
          ]).then(([total, failed]) => ({ total, failed }))
        : null,
      can('veille.view')
        ? VeilleItem.query()
            .where('reading_queue', true)
            .count('* as total')
            .then((r) => ({ queue: Number(r[0].$extras.total) }))
        : null,
      can('leitner.view')
        ? LeitnerCard.query()
            .where('next_review', '<=', today.toSQLDate()!)
            .count('* as total')
            .then((r) => ({ due: Number(r[0].$extras.total) }))
        : null,
    ])

    return { services, agents, veille, leitner, host: os.hostname() }
  }
}
