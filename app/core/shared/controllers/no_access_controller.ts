import type { HttpContext } from '@adonisjs/core/http'
import { landingUrlFor, NO_ACCESS_URL } from '#core/shared/navigation/landing'

/**
 * L'écran d'un compte actif à qui aucun droit n'a encore été attribué.
 *
 * ⚠️ **Il redirige vers la vraie destination du compte quand il en a une.** Sans ça, un
 * administrateur qui ouvrirait cette URL — un lien resté dans un historique, une adresse
 * tapée — lirait « aucun accès ne vous a été attribué » alors qu'il a accès à tout. Un écran
 * qui ment sur les droits est pire qu'un écran manquant : on cherche la panne ailleurs.
 *
 * Aucun cycle possible : `landingUrlFor` ne rend cette URL que lorsqu'il n'y a **aucune**
 * destination ouvrable, cas où la condition ci-dessous est fausse.
 */
export default class NoAccessController {
  async index({ auth, inertia, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const landing = await landingUrlFor(user)

    if (landing !== NO_ACCESS_URL) {
      return response.redirect(landing)
    }

    return inertia.render('core/shared/no_access')
  }
}
