import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import type { Authenticators } from '@adonisjs/auth/types'
import { DateTime } from 'luxon'
import { LOGIN_STAMP_KEY, isStampExpired } from '#core/auth/services/session_lifetime'
import { adminTotpRequired } from '#core/auth/services/two_factor_policy'

/**
 * L'écran où l'on enrôle son second facteur, et les seules routes qu'un compte sous
 * obligation peut encore atteindre (CC-114).
 *
 * ⚠️ **Cette liste est ce qui empêche la boucle.** La redirection ci-dessous vise
 * `/profil/securite` : sans l'en exempter, cet écran se redirigerait vers lui-même à
 * l'infini. `/logout` y est parce que personne ne doit être retenu dans une application, et
 * `/locale` parce qu'un écran qu'on ne peut pas lire dans sa langue est un écran de moins.
 *
 * ⚠️ **Le préfixe, pas l'égalité** : l'enrôlement se fait par des POST vers des sous-chemins
 * (`/profil/securite/enrolement`, `/confirmation`…). Ne libérer que l'URL exacte laisserait
 * l'écran s'afficher et son formulaire échouer — la boucle serait simplement déplacée d'un
 * cran, là où elle ressemble à un bug de l'écran plutôt qu'à une règle d'accès.
 */
const SECURITY_URL = '/profil/securite'
const ALWAYS_ALLOWED = ['/logout', '/locale']

function isAllowedWhileUnenrolled(url: string): boolean {
  return url === SECURITY_URL || url.startsWith(`${SECURITY_URL}/`) || ALWAYS_ALLOWED.includes(url)
}

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

    /**
     * Un administrateur sans second facteur, quand la règle l'exige : il est **connecté**, mais
     * il ne va nulle part avant d'avoir enrôlé (CC-114).
     *
     * ⚠️ **Le verrou est ici, pas dans la redirection après connexion.** Envoyer vers cet écran
     * depuis `auth_controller` serait un confort, pas une garantie : n'importe quelle URL tapée
     * à la main, n'importe quel signet contournerait la consigne. Un contrôle qui ne vit que
     * sur le chemin nominal n'en est pas un.
     *
     * ⚠️ **Étendre ce middleware plutôt qu'en ajouter un global** n'est pas qu'une commodité :
     * `capabilities_routes.spec.ts` fige le nombre de middlewares globaux, parce que c'est la
     * seule chose qui distingue le garde-barrière d'un oubli. Le faire varier pour un contrôle
     * qui n'a de sens qu'authentifié affaiblirait cette garde-là.
     */
    const user = ctx.auth.user!
    if (
      adminTotpRequired() &&
      user.isAdmin &&
      !user.hasTotp &&
      !isAllowedWhileUnenrolled(ctx.request.url())
    ) {
      return ctx.response.redirect(SECURITY_URL)
    }

    return next()
  }
}
