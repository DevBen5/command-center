import type { HttpContext } from '@adonisjs/core/http'
import Agent from '#models/agent'
import AgentRunnerService from '#services/agent_runner_service'

export default class AgentsController {
  async index({ inertia, request }: HttpContext) {
    const agents = await Agent.query().orderBy('name')
    const selectedId = request.input('id', agents[0]?.id)
    const selected = agents.find((agent) => agent.id === Number(selectedId)) ?? null

    return inertia.render('agents/index', {
      agents,
      selected,
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
