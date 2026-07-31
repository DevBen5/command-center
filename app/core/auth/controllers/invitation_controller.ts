import type { HttpContext } from '@adonisjs/core/http'
import User from '#core/auth/models/user'
import invitationService from '#core/auth/services/invitation_service'
import { acceptInvitationValidator } from '#core/auth/validators/admin'
import { landingUrlFor } from '#core/shared/navigation/landing'
import { PENDING_2FA_KEY, pendingChallengeFor } from '#core/auth/services/two_factor_challenge'

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

    /**
     * ⚠️ **Le second facteur est dû ici aussi, et l'omettre le rendrait décoratif** (CC-114).
     *
     * Un lien d'invitation pose un mot de passe **et** connecte : c'est le « mot de passe
     * oublié » du projet. Sans ce détour, quiconque intercepte un lien — historique, referer,
     * journaux d'un proxy — entrerait sans jamais croiser le second facteur, quel que soit le
     * soin mis à le vérifier sur `/login`. Une porte qui n'est pas fermée par les deux bouts
     * n'est pas fermée.
     *
     * En pratique ce cas ne se présente qu'à la **réémission** d'un lien sur un compte déjà
     * enrôlé : un compte fraîchement créé n'a pas encore de TOTP, et suit la voie du dessous.
     */
    if (user.hasTotp) {
      session.put(PENDING_2FA_KEY, pendingChallengeFor(user.id))
      return response.redirect('/login/2fa')
    }

    await auth.use('web').login(user)

    // ⚠️ **C'est ici que l'atterrissage compte le plus** : c'est le tout premier écran d'un
    // collègue, à la seconde où il vient de choisir son mot de passe. Un `/` en dur lui rendait
    // un JSON d'erreur s'il n'avait pas `dashboard.view` (CC-81) — et un compte fraîchement
    // invité n'a souvent encore aucun droit du tout, d'où la page « aucun accès ».
    return response.redirect(await landingUrlFor(user))
  }
}
