import type { HttpContext } from '@adonisjs/core/http'
import User from '#core/auth/models/user'
import invitationService from '#core/auth/services/invitation_service'
import { acceptInvitationValidator } from '#core/auth/validators/admin'

/**
 * L'acceptation d'une invitation : un compte se donne son premier mot de passe.
 *
 * Le jeton **est** l'autorisation — le porteur n'a pas encore d'identité à faire valoir.
 * D'où `openRoute()` sur ces deux routes, et d'où le soin mis à ce que le jeton soit à
 * usage unique, expirant, et connu de la base par sa seule empreinte.
 */
export default class InvitationController {
  async show({ inertia, params }: HttpContext) {
    const invitation = await invitationService.findPending(params.token)

    // Un jeton inventé, consommé ou expiré rendent tous les trois la même page : la
    // réponse ne dit pas laquelle des trois, et n'apprend donc rien à qui essaie des liens.
    if (!invitation) {
      return inertia.render('core/auth/invitation', { valid: false, fullName: null })
    }

    const user = await User.find(invitation.userId)

    return inertia.render('core/auth/invitation', {
      valid: true,
      fullName: user?.fullName ?? null,
    })
  }

  async accept({ request, response, params, auth, session, i18n }: HttpContext) {
    const invitation = await invitationService.findPending(params.token)

    if (!invitation) {
      session.flash('errorsBag', { password: i18n.t('auth.invitationInvalid') })
      return response.redirect().back()
    }

    const { password } = await request.validateUsing(acceptInvitationValidator)
    const user = await User.findOrFail(invitation.userId)

    // ⚠️ Un compte désactivé ne se réveille pas par un lien resté dans une boîte mail :
    // la désactivation doit l'emporter sur une invitation antérieure.
    if (!user.isActive) {
      session.flash('errorsBag', { password: i18n.t('auth.invitationInvalid') })
      return response.redirect().back()
    }

    user.password = password
    await user.save()
    // Consommée **après** l'enregistrement du mot de passe : mourir entre les deux laisse
    // un lien encore utilisable, jamais un compte sans mot de passe et sans moyen d'en poser.
    await invitationService.consume(invitation)

    await auth.use('web').login(user)

    return response.redirect('/')
  }
}
