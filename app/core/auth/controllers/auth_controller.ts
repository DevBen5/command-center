import type { HttpContext } from '@adonisjs/core/http'
import { errors as authErrors } from '@adonisjs/auth'
import { DateTime } from 'luxon'
import User from '#core/auth/models/user'
import { loginValidator } from '#core/auth/validators/auth'
import { landingUrlFor } from '#core/shared/navigation/landing'
import loginThrottle from '#core/auth/services/login_throttle_service'
import { LOGIN_STAMP_KEY } from '#core/auth/services/session_lifetime'

export default class AuthController {
  async show({ inertia }: HttpContext) {
    return inertia.render('core/auth/login')
  }

  async store({ request, auth, response, session, i18n }: HttpContext) {
    const { email, password } = await request.validateUsing(loginValidator)

    // Le blocage se vérifie AVANT `verifyCredentials` : un client bloqué ne doit pas
    // consommer un scrypt — c'est exactement le travail que le throttle rationne (CC-78).
    const retryInSeconds = await loginThrottle.secondsBeforeRetry(request.ip(), email)
    if (retryInSeconds > 0) {
      session.flash('errorsBag', {
        email: i18n.t('auth.tooManyAttempts', {
          minutes: Math.max(1, Math.ceil(retryInSeconds / 60)),
        }),
      })
      return response.redirect().back()
    }

    let landing: string

    try {
      const user = await User.verifyCredentials(email, password)
      // Un succès efface l'ardoise : deux collègues derrière la même IP ne
      // s'accumulent pas l'un sur l'autre jusqu'au blocage.
      await loginThrottle.clearFor(request.ip(), email)
      await auth.use('web').login(user)
      // L'heure de connexion, pour l'expiration absolue (CC-78). Posée à CHAQUE
      // connexion : sans ça, un compte expulsé pour session trop vieille serait
      // ré-expulsé sitôt reconnecté — le tampon périmé serait resté dans la session.
      session.put(LOGIN_STAMP_KEY, DateTime.now().toISO())
      // ⚠️ **Pas `/` en dur** : cette route exige `dashboard.view`, et un compte qui ne la
      // porte pas recevait un JSON d'erreur comme premier écran après connexion (CC-81).
      landing = await landingUrlFor(user)
    } catch (error) {
      // Seule l'erreur « identifiants invalides » est traitée ici ; toute autre
      // exception (ex. base de données injoignable) doit remonter au handler
      // global plutôt que d'être maquillée en erreur de saisie.
      if (!(error instanceof authErrors.E_INVALID_CREDENTIALS)) {
        throw error
      }

      await loginThrottle.recordFailure(request.ip(), email)

      // L'adaptateur Inertia expose les erreurs depuis le flash `errorsBag`,
      // qui alimente `form.errors` côté Vue. Message traduit selon la langue active.
      session.flash('errorsBag', { email: i18n.t('auth.invalidCredentials') })
      return response.redirect().back()
    }

    return response.redirect(landing)
  }

  async destroy({ auth, response }: HttpContext) {
    await auth.use('web').logout()
    return response.redirect('/login')
  }
}
