import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import type { Authenticators } from '@adonisjs/auth/types'
import { DateTime } from 'luxon'
import { LOGIN_STAMP_KEY, isStampExpired } from '#core/auth/services/session_lifetime'

/**
 * Auth middleware is used authenticate HTTP requests and deny
 * access to unauthenticated users.
 */
export default class AuthMiddleware {
  /**
   * The URL to redirect to, when authentication fails
   */
  redirectTo = '/login'

  async handle(
    ctx: HttpContext,
    next: NextFn,
    options: {
      guards?: (keyof Authenticators)[]
    } = {}
  ) {
    await ctx.auth.authenticateUsing(options.guards, { loginRoute: this.redirectTo })

    // ⚠️ Désactiver un compte doit le sortir **immédiatement**, pas à l'expiration de sa
    // session. Le guard d'AdonisJS ne connaît que « cet identifiant existe » : sans cette
    // vérification, un compte désactivé continuerait de naviguer avec le cookie qu'il avait
    // déjà — c'est-à-dire précisément dans le cas où on désactive quelqu'un en urgence.
    if (!ctx.auth.user?.isActive) {
      await ctx.auth.use('web').logout()
      return ctx.response.redirect(this.redirectTo)
    }

    // Expiration absolue (CC-78) : au-delà de MAX_SESSION_DAYS après la connexion,
    // re-login obligatoire même en pleine activité — l'expiration d'inactivité (2 h)
    // ne borne rien pour un cookie volé rejoué régulièrement.
    const stamp = ctx.session.get(LOGIN_STAMP_KEY)
    if (stamp === undefined) {
      // Session d'avant CC-78, ou posée par `loginAs` dans les tests : le tampon
      // part de maintenant. Traiter « absent » comme expiré déconnecterait tout le
      // monde au déploiement — et un voleur ne peut pas retirer le tampon d'un
      // cookie chiffré, l'absence n'est donc pas une échappatoire.
      ctx.session.put(LOGIN_STAMP_KEY, DateTime.now().toISO())
    } else if (isStampExpired(stamp)) {
      // Le tampon périmé s'oublie AVANT la redirection : le laisser ferait
      // ré-expulser le compte sitôt reconnecté si la reconnexion ne le reposait
      // pas — les deux bouts sont tenus (voir `auth_controller.store`).
      ctx.session.forget(LOGIN_STAMP_KEY)
      await ctx.auth.use('web').logout()
      return ctx.response.redirect(this.redirectTo)
    }

    return next()
  }
}
