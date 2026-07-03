import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import { errors as authErrors } from '@adonisjs/auth'
import User from '#models/user'

const loginValidator = vine.compile(
  vine.object({
    email: vine.string().trim().email(),
    // minLength(1) rejette la chaîne vide : un mot de passe manquant produit
    // une erreur de champ claire plutôt que « Identifiants invalides ».
    password: vine.string().minLength(1),
  })
)

export default class AuthController {
  async show({ inertia }: HttpContext) {
    return inertia.render('login')
  }

  async store({ request, auth, response, session, i18n }: HttpContext) {
    const { email, password } = await request.validateUsing(loginValidator)

    try {
      const user = await User.verifyCredentials(email, password)
      await auth.use('web').login(user)
    } catch (error) {
      // Seule l'erreur « identifiants invalides » est traitée ici ; toute autre
      // exception (ex. base de données injoignable) doit remonter au handler
      // global plutôt que d'être maquillée en erreur de saisie.
      if (!(error instanceof authErrors.E_INVALID_CREDENTIALS)) {
        throw error
      }

      // L'adaptateur Inertia expose les erreurs depuis le flash `errorsBag`,
      // qui alimente `form.errors` côté Vue. Message traduit selon la langue active.
      session.flash('errorsBag', { email: i18n.t('auth.invalidCredentials') })
      return response.redirect().back()
    }

    return response.redirect('/')
  }

  async destroy({ auth, response }: HttpContext) {
    await auth.use('web').logout()
    return response.redirect('/login')
  }
}
