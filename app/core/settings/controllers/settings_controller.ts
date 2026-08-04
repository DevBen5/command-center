import type { HttpContext } from '@adonisjs/core/http'
import { renderSVG } from 'uqr'
import { errors as authErrors } from '@adonisjs/auth'
import ForbiddenException from '#core/shared/exceptions/forbidden_exception'
import User from '#core/auth/models/user'
import twoFactor from '#core/auth/services/two_factor_service'
import { adminTotpRequired } from '#core/auth/services/two_factor_policy'
import reauthThrottle from '#core/auth/services/reauth_throttle_service'
import { totpConfirmationValidator } from '#core/auth/validators/two_factor'
import { changePasswordValidator } from '#core/auth/validators/auth'
import appVersion from '#config/app_version'

/**
 * L'écran « Réglages » d'un compte, pour lui-même — la sécurité, la langue, et la version qui
 * tourne (CC-151, lisible par tout compte connecté, pas seulement le sien).
 *
 * ⚠️ **Ce domaine `core/settings` existe pour que l'entrée de barre latérale ne mente pas.**
 * CC-81 avait retiré « Réglages » parce qu'elle pointait vers `/`, donc vers un refus pour un
 * non-admin et vers l'accueil pour tout le monde : un lien qui promettait un écran inexistant.
 * La remettre n'était acceptable qu'avec un écran derrière — celui-ci. Le ranger dans
 * `core/auth` aurait forcé le prochain réglage sans rapport avec l'authentification à y
 * atterrir aussi.
 *
 * ⚠️ **La langue n'ajoute aucun code serveur ici** : `locale` et `supportedLocales` sont déjà
 * des props partagées (`config/inertia.ts`), et le changement passe par `POST /locale`
 * (`core/i18n`). L'écran ne fait que déplacer les boutons hors de la barre latérale.
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
export default class SettingsController {
  async show({ inertia, auth }: HttpContext) {
    const user = auth.user!
    const pending = twoFactor.pendingEnrollment(user)

    return inertia.render('core/settings/index', {
      enabled: user.hasTotp,
      // Le QR **et** le secret en clair : toutes les applications ne savent pas scanner, et
      // un enrôlement depuis la machine qui affiche la page n'a pas de caméra à lui opposer.
      enrollment: pending
        ? { secret: pending.secret, uri: pending.uri, qr: this.#qrDataUri(pending.uri) }
        : null,
      remainingCodes: user.hasTotp ? await twoFactor.remainingRecoveryCodes(user) : 0,
      // Pour dire *pourquoi* on est là quand la règle a forcé le passage.
      required: adminTotpRequired() && user.isAdmin,
      // « Quelle version tourne ? » (CC-151) — à tout compte connecté, décision tranchée par
      // le ticket : le dépôt est public, cacher le numéro ne retirerait rien à un attaquant
      // déjà authentifié. `null` explicite, jamais `undefined` : ce dernier disparaîtrait de la
      // sérialisation JSON et laisserait la page deviner plutôt que recevoir une valeur.
      version: appVersion.version,
      commit: appVersion.commit ?? null,
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
    if (user.hasTotp) return response.redirect('/reglages')

    await twoFactor.startEnrollment(user)

    return response.redirect('/reglages')
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

    return response.redirect('/reglages')
  }

  /**
   * Change le mot de passe de son propre compte (CC-147).
   *
   * ⚠️ **Le mot de passe actuel est un oracle, throttlé comme `POST /login`** (CC-78) : le
   * blocage se vérifie AVANT `User.verifyCredentials`, pour ne pas payer un scrypt sur un
   * client déjà bloqué. `ReauthThrottleService` ne fait que compter — la vérification
   * réutilise exactement le chemin de `AuthController.store`.
   *
   * ⚠️ **Ne ferme aucune session ouverte ailleurs** — le store est `cookie`, aucune liste
   * côté serveur. C'est pour ça que l'écran porte un avertissement permanent à côté de ce
   * formulaire ; ce n'est pas réparé ici (option (a) du ticket, (b) serait un lot à part).
   */
  async changePassword({ auth, request, response, session, i18n }: HttpContext) {
    const user = auth.user!
    const { currentPassword, password } = await request.validateUsing(changePasswordValidator)

    const retryInSeconds = await reauthThrottle.secondsBeforeRetry(user.id)
    if (retryInSeconds > 0) {
      session.flash('errorsBag', {
        currentPassword: i18n.t('auth.reauthTooManyAttempts', {
          minutes: Math.max(1, Math.ceil(retryInSeconds / 60)),
        }),
      })
      return response.redirect().back()
    }

    try {
      await User.verifyCredentials(user.email, currentPassword)
    } catch (error) {
      if (!(error instanceof authErrors.E_INVALID_CREDENTIALS)) throw error

      await reauthThrottle.recordFailure(user.id)
      session.flash('errorsBag', { currentPassword: i18n.t('auth.currentPasswordInvalid') })
      return response.redirect().back()
    }

    await reauthThrottle.clearFor(user.id)
    user.password = password
    await user.save()

    return response.redirect('/reglages')
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
