import os from 'node:os'
import { DateTime } from 'luxon'
import Service from '#models/service'
import Agent from '#models/agent'
import VeilleItem from '#models/veille_item'
import LeitnerCard from '#models/leitner_card'

export interface NavStats {
  services: { total: number; down: number }
  agents: { total: number; failed: number }
  veille: { queue: number }
  leitner: { due: number }
  host: string
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
  async collect(): Promise<NavStats> {
    const today = DateTime.now().startOf('day')

    const [servicesTotal, servicesDown, agentsTotal, agentsFailed, veilleQueue, leitnerDue] =
      await Promise.all([
        Service.query()
          .count('* as total')
          .then((r) => Number(r[0].$extras.total)),
        countWhere(Service, 'status', 'down'),
        Agent.query()
          .count('* as total')
          .then((r) => Number(r[0].$extras.total)),
        countWhere(Agent, 'status', 'failed'),
        VeilleItem.query()
          .where('reading_queue', true)
          .count('* as total')
          .then((r) => Number(r[0].$extras.total)),
        LeitnerCard.query()
          .where('next_review', '<=', today.toSQLDate()!)
          .count('* as total')
          .then((r) => Number(r[0].$extras.total)),
      ])

    return {
      services: { total: servicesTotal, down: servicesDown },
      agents: { total: agentsTotal, failed: agentsFailed },
      veille: { queue: veilleQueue },
      leitner: { due: leitnerDue },
      host: os.hostname(),
    }
  }
}
