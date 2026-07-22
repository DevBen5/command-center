import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'
import Service from '#modules/services/models/service'
import Agent from '#modules/agents/models/agent'
import VeilleItem from '#modules/veille/models/veille_item'
import LeitnerCard from '#modules/leitner/models/leitner_card'

export default class HomeController {
  async index({ inertia }: HttpContext) {
    const today = DateTime.now().startOf('day')

    const [services, agents, veilleItems, dueCards, totalCards] = await Promise.all([
      Service.all(),
      Agent.all(),
      VeilleItem.all(),
      LeitnerCard.query().where('next_review', '<=', today.toSQLDate()!),
      LeitnerCard.query()
        .count('* as total')
        .then((r) => Number(r[0].$extras.total)),
    ])

    const servicesDown = services.filter((s) => s.status === 'down')
    const servicesHighRam = services.filter((s) => s.status === 'up' && (s.ramPercent ?? 0) >= 90)

    const agentsFailed = agents.filter((a) => a.status === 'failed')
    const agentsRunning = agents.filter((a) => a.status === 'running')

    const veilleQueue = veilleItems.filter((i) => i.readingQueue)
    const veilleUntagged = veilleItems.filter((i) => i.tags.length === 0)

    return inertia.render('core/dashboard/home', {
      cards: {
        services: {
          up: services.filter((s) => s.status === 'up').length,
          total: services.length,
          down: servicesDown.map((s) => s.name),
          highRam: servicesHighRam.map((s) => ({ name: s.name, ram: s.ramPercent })),
        },
        agents: {
          active: agents.filter((a) => a.status === 'active').length,
          running: agentsRunning.map((a) => a.name),
          failed: agentsFailed.map((a) => a.name),
        },
        veille: {
          total: veilleItems.length,
          queue: veilleQueue.length,
          untagged: veilleUntagged.length,
        },
        leitner: {
          due: dueCards.length,
          total: totalCards,
        },
      },
    })
  }
}
