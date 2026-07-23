import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import ForbiddenException from '#core/shared/exceptions/forbidden_exception'

/**
 * Réserve une route à `is_admin`.
 *
 * C'est le seul chemin vers Services et Agents, et vers l'écran d'administration lui-même.
 * Volontairement distinct de `can()` : ces routes ne sont couvertes par **aucune** capacité,
 * donc aucun rôle ne peut y donner accès par accident.
 *
 * ⚠️ `AgentRunnerService` exécute `agent.config.command` telle quelle et `SystemStatsService`
 * pilote Docker : ces deux modules ne sont pas « des écrans un peu sensibles », ce sont des
 * exécutions de commandes sur la machine hôte.
 */
export default class AdminMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const user = ctx.auth.user

    // Levé, jamais retourné : c'est ce qui fait passer le refus devant les status pages,
    // donc devant la page 403. Voir `ForbiddenException`.
    if (!user || !user.isActive || !user.isAdmin) {
      throw new ForbiddenException('Accès refusé.')
    }

    return next()
  }
}
