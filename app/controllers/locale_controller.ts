import type { HttpContext } from '@adonisjs/core/http'
import i18nManager from '@adonisjs/i18n/services/main'

export default class LocaleController {
  async switch({ request, response }: HttpContext) {
    const locale = request.input('locale')

    // On n'accepte que les langues réellement supportées, pour éviter d'écrire
    // n'importe quoi dans le cookie.
    if (i18nManager.supportedLocales().includes(locale)) {
      // Cookie d'un an ; il est relu par DetectUserLocaleMiddleware à chaque requête.
      response.cookie('locale', locale, { maxAge: '1y', httpOnly: false })
    }

    return response.redirect().back()
  }
}
