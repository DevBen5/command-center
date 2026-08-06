import type { HttpContext } from '@adonisjs/core/http'
import type { Session } from '@adonisjs/session'
import ForbiddenException from '#core/shared/exceptions/forbidden_exception'
import type User from '#core/auth/models/user'
import vault from '#modules/coffre/services/vault_service'
import { entryValidator } from '#modules/coffre/validators/coffre'

/**
 * Le contenu du coffre (CC-178) — **toutes ces routes sont derrière l'élévation**
 * (`vault_unlocked_middleware`), en plus de leur capacité.
 *
 * ⚠️ **La clé est relue à chaque action, jamais gardée entre deux requêtes.** Le middleware vient
 * de vérifier qu'elle existe ; la relire ici n'est pas une redondance gratuite mais la seule façon
 * de l'obtenir — elle vit en mémoire du process, indexée par le pointeur du cookie. Le `throw`
 * ci-dessous ne devrait donc jamais partir : il couvre l'expiration survenue entre le middleware
 * et le contrôleur, et surtout la route qu'on écrirait un jour en oubliant le middleware.
 */
export default class CoffreController {
  async index({ inertia, auth, session }: HttpContext) {
    const user = auth.user!
    const key = this.#key(user, session)

    return inertia.render('modules/coffre/index', {
      entries: await vault.entriesFor(user, key),
    })
  }

  async store({ auth, request, response, session }: HttpContext) {
    const user = auth.user!
    const key = this.#key(user, session)
    const entry = await request.validateUsing(entryValidator)

    await vault.addEntry(user, key, entry)

    return response.redirect('/coffre')
  }

  /**
   * ⚠️ **La suppression est définitive et sans corbeille**, contrairement à la veille (CC-63). Rien
   * ne peut ressusciter une entrée : il n'y a ni collecte qui la réinsérerait — donc aucune raison
   * de poser une pierre tombale — ni copie ailleurs. Le dialogue de confirmation vit dans la page.
   */
  async destroy({ auth, params, response, session }: HttpContext) {
    const user = auth.user!

    // La clé n'est pas nécessaire pour supprimer — mais l'exiger garde l'invariant simple :
    // aucune écriture du coffre ne se fait sans coffre ouvert, y compris celle qui n'a rien à
    // déchiffrer. Sans ça, la seule route destructive du module serait aussi la seule à ne pas
    // dépendre de la passphrase.
    this.#key(user, session)

    await vault.deleteEntry(user, Number(params.id))

    return response.redirect('/coffre')
  }

  #key(user: User, session: Session): Buffer {
    const key = vault.keyFor(user, session)
    if (key === null) {
      throw new ForbiddenException('Le coffre est verrouillé.')
    }

    return key
  }
}
