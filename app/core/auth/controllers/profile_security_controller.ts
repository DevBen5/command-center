import type { HttpContext } from '@adonisjs/core/http'
import { renderSVG } from 'uqr'
import ForbiddenException from '#core/shared/exceptions/forbidden_exception'
import twoFactor from '#core/auth/services/two_factor_service'
import { adminTotpRequired } from '#core/auth/services/two_factor_policy'
import { totpConfirmationValidator } from '#core/auth/validators/two_factor'

/**
 * L'écran « Sécurité » d'un compte, pour lui-même (CC-114).
 *
 * ⚠️ **Aucune capacité ne le garde, et c'est délibéré** — `auth() + openRoute()`, comme
 * `/aucun-acces`. Deux raisons qui vont dans le même sens : exiger un droit accordé par
 * quelqu'un d'autre pour gérer sa propre sécurité serait un cercle, et un administrateur
 * renvoyé ici par la règle d'enrôlement doit pouvoir y entrer quoi qu'il porte. Rien n'y est
 * lisible ni modifiable que le sien : chaque action lit `auth.user`, jamais un identifiant
 * venu de la requête.
 *
 * ⚠️ **Les secrets ne passent jamais par un message flash.** `SESSION_DRIVER` vaut `cookie` :
 * un flash part chez le client. Le secret d'enrôlement est relu depuis la base tant qu'il
 * n'est pas confirmé, et les codes de secours ne vivent que dans la réponse JSON de l'appel
 * qui vient de les fabriquer — le même choix que le lien d'invitation.
 */
export default class ProfileSecurityController {
  async show({ inertia, auth }: HttpContext) {
    const user = auth.user!
    const pending = twoFactor.pendingEnrollment(user)

    return inertia.render('core/auth/profile/security', {
      enabled: user.hasTotp,
      // Le QR **et** le secret en clair : toutes les applications ne savent pas scanner, et
      // un enrôlement depuis la machine qui affiche la page n'a pas de caméra à lui opposer.
      enrollment: pending
        ? { secret: pending.secret, uri: pending.uri, qr: this.#qrDataUri(pending.uri) }
        : null,
      remainingCodes: user.hasTotp ? await twoFactor.remainingRecoveryCodes(user) : 0,
      // Pour dire *pourquoi* on est là quand la règle a forcé le passage.
      required: adminTotpRequired() && user.isAdmin,
    })
  }

  /**
   * Fabrique un secret neuf, non confirmé.
   *
   * ⚠️ **C'est un POST, jamais un effet de bord du GET.** Régénérer à chaque affichage
   * périmerait le QR qu'on vient de scanner au premier rechargement de la page — un échec que
   * son porteur attribuerait à son téléphone.
   */
  async enroll({ auth, response }: HttpContext) {
    const user = auth.user!

    // Déjà actif : le remplacer sans passer par la désactivation laisserait le compte avec un
    // secret non confirmé pendant que l'ancien reste exigé — un état que rien n'affiche.
    if (user.hasTotp) return response.redirect('/profil/securite')

    await twoFactor.startEnrollment(user)

    return response.redirect('/profil/securite')
  }

  /**
   * Confirme l'enrôlement par un premier code, et rend les codes de secours **une seule fois**.
   *
   * JSON nu plutôt qu'une page : c'est ce qui garantit que ces codes n'existent que dans cette
   * réponse-là. La page les affiche, et ils disparaissent au rechargement — voir
   * `AdminUsersController.issueInvitation`, même raisonnement.
   */
  async confirm({ auth, request, response, i18n }: HttpContext) {
    const user = auth.user!
    const { code } = await request.validateUsing(totpConfirmationValidator)

    const recoveryCodes = await twoFactor.confirm(user, code)
    if (recoveryCodes === null) {
      return response.badRequest({ error: i18n.t('auth.twoFactorInvalid') })
    }

    return response.ok({ recoveryCodes })
  }

  /** De nouveaux codes de secours ; les précédents cessent de valoir. */
  async regenerateCodes({ auth, response }: HttpContext) {
    const user = auth.user!
    if (!user.hasTotp) return response.badRequest({ error: 'Aucun second facteur actif.' })

    return response.ok({ recoveryCodes: await twoFactor.regenerateRecoveryCodes(user) })
  }

  /**
   * Retire le second facteur de son propre compte.
   *
   * ⚠️ **Refusé quand la règle l'exige** : un administrateur qui pourrait le retirer lui-même
   * rendrait la règle facultative, sans que rien ne le signale — la case resterait cochée dans
   * `.env` pendant que plus personne ne serait protégé.
   *
   * Le refus se **lève** : `response.forbidden()` court-circuiterait la page 403 et rendrait
   * du JSON brut au navigateur (voir `ForbiddenException`).
   */
  async disable({ auth, response }: HttpContext) {
    const user = auth.user!

    if (adminTotpRequired() && user.isAdmin) {
      throw new ForbiddenException('Le second facteur est exigé pour ce compte.')
    }

    await twoFactor.disable(user)

    return response.redirect('/profil/securite')
  }

  /**
   * Le QR en `data:` — couvert par `img-src 'self' data:` de la CSP, sans y toucher.
   *
   * ⚠️ Un `<img>`, jamais un `v-html` du SVG : le contenu est le nôtre, mais injecter du
   * balisage brut pour afficher une image ouvrirait un chemin dont on n'a pas besoin.
   */
  #qrDataUri(uri: string): string {
    const svg = renderSVG(uri, { border: 2 })
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  }
}
