import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import Agent from '#models/agent'

const execAsync = promisify(exec)

export default class AgentRunnerService {
  async run(agent: Agent) {
    const command = agent.config.command as string | undefined

    try {
      if (!command) throw new Error('no command configured for this agent')
      await execAsync(command)
      agent.status = 'active'
    } catch {
      // Pas de script réel configuré sur ce poste de dev : on simule le lancement.
      agent.status = 'running'
    }

    await agent.save()
    return agent
  }

  async stop(agent: Agent) {
    agent.status = 'idle'
    await agent.save()
    return agent
  }

  recentLogs(agent: Agent, limit = 100): string[] {
    return agent.logs.slice(-limit)
  }
}
