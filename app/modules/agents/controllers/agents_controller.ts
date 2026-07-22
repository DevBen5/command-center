import type { HttpContext } from '@adonisjs/core/http'
import Agent from '#modules/agents/models/agent'
import AgentRunnerService from '#modules/agents/services/agent_runner_service'

export default class AgentsController {
  async index({ inertia, request }: HttpContext) {
    const agents = await Agent.query().orderBy('name')
    const selectedId = request.input('id', agents[0]?.id)
    const selected = agents.find((agent) => agent.id === Number(selectedId)) ?? null

    const stats = {
      active: agents.filter((a) => a.status === 'active').length,
      running: agents.filter((a) => a.status === 'running').length,
      failed: agents.filter((a) => a.status === 'failed').length,
      total: agents.length,
    }

    return inertia.render('modules/agents/index', {
      agents,
      selected,
      stats,
      recentLogs: selected ? new AgentRunnerService().recentLogs(selected) : [],
    })
  }

  async run({ params, response }: HttpContext) {
    const agent = await Agent.findOrFail(params.id)
    await new AgentRunnerService().run(agent)
    return response.redirect().back()
  }

  async stop({ params, response }: HttpContext) {
    const agent = await Agent.findOrFail(params.id)
    await new AgentRunnerService().stop(agent)
    return response.redirect().back()
  }
}
