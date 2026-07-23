import type { Destination } from '#core/shared/navigation/registry'

/**
 * La destination du module Agents.
 *
 * ⚠️ **`admin`, et aucune capacité** — `AgentRunnerService` exécute `agent.config.command` telle
 * quelle. Voir `app/modules/services/destinations.ts` : même raisonnement, même conséquence.
 */
export const AGENTS_DESTINATIONS: readonly Destination[] = [
  { key: 'agents', href: '/agents', access: { admin: true } },
]
