import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import User from '#core/auth/models/user'
import twoFactor from '#core/auth/services/two_factor_service'
import loginThrottle from '#core/auth/services/login_throttle_service'
import { PENDING_2FA_KEY, pendingUserId } from '#core/auth/services/two_factor_challenge'
import { LOGIN_STAMP_KEY } from '#core/auth/services/session_lifetime'
import { landingUrlFor } from '#core/shared/navigation/landing'
import { twoFactorChallengeValidator } from '#core/auth/validators/two_factor'

/**
 * L'étape 2 de la connexion : le second facteur, après le mot de passe (CC-114).
 *
 * ⚠️ **Rien ici ne connecte tant que le code n'est pas bon.** Le compte est identifié par le
 * marqueur de session posé à l'étape 1 — pas par le guard, qui n'a encore rien reçu. Une
 * requête vers n'importe quelle page protégée à ce stade est refusée comme celle d'un visiteur.
 */
export default class TwoFactorController {
  async show({ inertia, session, response }: HttpContext) {
    const user = await this.#pendingUser(session)
    if (!user) return response.redirect('/login')

    return inertia.render('core/auth/login_two_factor', {
      // De quoi dire *à qui* on demande un code, sans rien apprendre à qui n'a pas déjà
      // franchi l'étape du mot de passe.
      email: user.email,
    })
  }

  /**
   * Vérifie le code — TOTP ou code de secours — et connecte pour de bon.
   *
   * ⚠️ **Les échecs comptent dans le throttle de CC-78, et c'est indispensable.** Six chiffres
   * font un million de combinaisons : sans plafond, elles se parcourent. Le compteur n'est
   * effacé qu'ici, à la connexion réellement établie — voir `auth_controller`.
   */
  async store({ request, session, response, auth, i18n }: HttpContext) {
    const user = await this.#pendingUser(session)
    if (!user) return response.redirect('/login')

    const retryInSeconds = await loginThrottle.secondsBeforeRetry(request.ip(), user.email)
    if (retryInSeconds > 0) {
      session.flash('errorsBag', {
        code: i18n.t('auth.tooManyAttempts', {
          minutes: Math.max(1, Math.ceil(retryInSeconds / 60)),
        }),
      })
      return response.redirect().back()
    }

    const { code } = await request.validateUsing(twoFactorChallengeValidator)

    const verdict = await twoFactor.verifyTotp(user, code)

    /**
     * ⚠️ **Le code de secours est essayé même quand le secret est illisible, et l'ordre de ces
     * deux lignes est tout le sujet.**
     *
     * APP_KEY changée, et tous les `totp_secret` deviennent indéchiffrables d'un coup. Refuser
     * sur ce seul constat fermerait la porte de secours en même temps que celle qu'elle est
     * censée rattraper — les codes sont hachés, donc parfaitement valides dans cette panne-là.
     * C'est ce qui fait d'eux une vraie porte et pas une seconde serrure sur le même barillet.
     */
    if (verdict.status === 'ok' || (await twoFactor.consumeRecoveryCode(user, code))) {
      return this.#completeLogin({ user, session, response, auth, request })
    }

    await loginThrottle.recordFailure(request.ip(), user.email)

    // Un secret illisible **refuse en le nommant** : le traiter comme « pas de second facteur »
    // ouvrirait la connexion au moment précis où quelque chose d'anormal est arrivé à la base.
    // Et le message dit quoi faire — un code de secours, ou un administrateur.
    session.flash('errorsBag', {
      code:
        verdict.status === 'unreadable'
          ? i18n.t('auth.twoFactorUnreadable')
          : i18n.t('auth.twoFactorInvalid'),
    })

    return response.redirect().back()
  }

  /**
   * Le compte en attente, revérifié en base.
   *
   * ⚠️ **`isActive` est relu ici, pas seulement à l'étape 1.** Désactiver quelqu'un doit le
   * sortir immédiatement (voir `auth_middleware`) : sans cette relecture, un compte désactivé
   * entre les deux étapes finirait sa connexion et n'en serait expulsé qu'à la requête
   * suivante.
   */
  async #pendingUser(session: HttpContext['session']): Promise<User | null> {
    const userId = pendingUserId(session.get(PENDING_2FA_KEY))
    if (userId === null) {
      session.forget(PENDING_2FA_KEY)
      return null
    }

    const user = await User.find(userId)
    if (!user || !user.isActive || !user.hasTotp) {
      session.forget(PENDING_2FA_KEY)
      return null
    }

    return user
  }

  async #completeLogin({
    user,
    session,
    response,
    auth,
    request,
  }: Pick<HttpContext, 'session' | 'response' | 'auth' | 'request'> & { user: User }) {
    // Le marqueur s'oublie **avant** la connexion : un demi-tour qui survivrait à une
    // connexion réussie serait un second chemin d'entrée dont personne ne tient les comptes.
    session.forget(PENDING_2FA_KEY)

    await loginThrottle.clearFor(request.ip(), user.email)
    await auth.use('web').login(user)
    session.put(LOGIN_STAMP_KEY, DateTime.now().toISO())

    return response.redirect(await landingUrlFor(user))
  }
}
