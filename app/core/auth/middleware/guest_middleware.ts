import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import type { Authenticators } from '@adonisjs/auth/types'
import { landingUrlFor, NO_ACCESS_URL } from '#core/shared/navigation/landing'

/**
 * Refuse aux comptes déjà connectés les routes réservées aux visiteurs — la page de connexion.
 *
 * ⚠️ **La destination n'est plus `/` en dur**, et c'était la troisième occurrence du même
 * défaut : un signet vers `/login` rouvert par un compte connecté sans `dashboard.view` le
 * renvoyait sur le JSON de refus, exactement comme après une connexion (CC-81). Le calcul se
 * fait donc **dans `handle`** — il demande l'utilisateur, qu'une propriété de classe évaluée à
 * l'instanciation ne peut pas connaître.
 */
export default class GuestMiddleware {
  async handle(
    ctx: HttpContext,
    next: NextFn,
    options: { guards?: (keyof Authenticators)[] } = {}
  ) {
    for (let guard of options.guards || [ctx.auth.defaultGuard]) {
      if (await ctx.auth.use(guard).check()) {
        // ⚠️ Jamais `/login` en repli : on y est déjà, et ce serait une boucle. `NO_ACCESS_URL`
        // est sous `auth()`, qui renverra proprement au login si la session ne vaut rien.
        const user = ctx.auth.use(guard).user
        const landing = user ? await landingUrlFor(user) : NO_ACCESS_URL
        return ctx.response.redirect(landing, true)
      }
    }

    return next()
  }
}
