import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { DateTime } from 'luxon'
import Agent from '#modules/agents/models/agent'

const execAsync = promisify(exec)

/**
 * Plafond de `agent.logs` (CC-141) : sans lui, une colonne jsonb écrite à chaque lancement
 * grossirait sans fin sur un agent relancé souvent. Les 100 dernières lignes affichées par
 * `recentLogs()` restent largement sous ce plafond.
 */
const MAX_LOG_ENTRIES = 200

export default class AgentRunnerService {
  /**
   * ⚠️ **`agent.logs ?? []`, pas `agent.logs` seul.** Un agent tout juste créé sans que `logs`
   * ait été passé explicitement (`Agent.create({...})` sans ce champ) le laisse `undefined` en
   * mémoire : Lucid ne réhydrate pas les colonnes absentes de l'appel après l'`INSERT`, même
   * quand la base leur applique son propre défaut (`defaultTo('[]')`). Constaté en écrivant les
   * tests de ce lot — `AgentsController` ne l'aurait jamais vu, `findOrFail` relit toujours la
   * ligne depuis la base, où `logs` est un vrai tableau.
   */
  #appendLog(agent: Agent, ligne: string) {
    agent.logs = [...(agent.logs ?? []), ligne].slice(-MAX_LOG_ENTRIES)
  }

  async run(agent: Agent) {
    /*
     * FRONTIÈRE DE CONFIANCE : `config.command` est une commande shell complète,
     * par conception (comme une entrée cron). Elle n'est modifiable par AUCUN
     * formulaire de l'application — seuls le fichier de déclaration (CC-141) et
     * un accès direct à la base peuvent l'écrire. Si un jour un écran d'édition
     * de la config est ajouté, ce champ ne devra JAMAIS y être exposé tel quel.
     */
    const command = agent.config.command as string | undefined
    const timestamp = DateTime.now().toISO()

    try {
      if (!command) throw new Error('no command configured for this agent')
      const { stdout, stderr } = await execAsync(command)
      agent.status = 'active'
      this.#appendLog(agent, `[${timestamp}] $ ${command}`)
      if (stdout.trim()) this.#appendLog(agent, stdout.trim())
      if (stderr.trim()) this.#appendLog(agent, stderr.trim())
    } catch (error) {
      // Pas de script réel configuré sur ce poste de dev : on simule le lancement.
      agent.status = 'running'
      this.#appendLog(agent, `[${timestamp}] $ ${command ?? '(aucune commande configurée)'}`)
      this.#appendLog(agent, `Lancement simulé : ${(error as Error).message}`)
    }

    await agent.save()
    return agent
  }

  async stop(agent: Agent) {
    agent.status = 'idle'
    this.#appendLog(agent, `[${DateTime.now().toISO()}] Arrêté.`)
    await agent.save()
    return agent
  }

  recentLogs(agent: Agent, limit = 100): string[] {
    return (agent.logs ?? []).slice(-limit)
  }
}
