import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import User from '#models/user'

const loginValidator = vine.compile(
  vine.object({
    email: vine.string().trim().email(),
    password: vine.string(),
  })
)

export default class AuthController {
  async show({ inertia }: HttpContext) {
    return inertia.render('login')
  }

  async store({ request, auth, response, session }: HttpContext) {
    const { email, password } = await request.validateUsing(loginValidator)

    try {
      const user = await User.verifyCredentials(email, password)
      await auth.use('web').login(user)
    } catch {
      // L'adaptateur Inertia expose les erreurs depuis le flash `errorsBag`,
      // qui alimente `form.errors` côté Vue.
      session.flash('errorsBag', { email: 'Identifiants invalides.' })
      return response.redirect().back()
    }

    return response.redirect('/')
  }

  async destroy({ auth, response }: HttpContext) {
    await auth.use('web').logout()
    return response.redirect('/login')
  }
}
