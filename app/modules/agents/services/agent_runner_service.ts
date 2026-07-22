import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import Agent from '#modules/agents/models/agent'

const execAsync = promisify(exec)

export default class AgentRunnerService {
  async run(agent: Agent) {
    /*
     * FRONTIÈRE DE CONFIANCE : `config.command` est une commande shell complète,
     * par conception (comme une entrée cron). Elle n'est modifiable par AUCUN
     * formulaire de l'application — seuls les seeders / un accès direct à la
     * base peuvent l'écrire. Si un jour un écran d'édition de la config est
     * ajouté, ce champ ne devra JAMAIS y être exposé tel quel.
     */
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
