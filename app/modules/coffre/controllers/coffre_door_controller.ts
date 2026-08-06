import type { HttpContext } from '@adonisjs/core/http'
import twoFactor from '#core/auth/services/two_factor_service'
import reauthThrottle from '#core/auth/services/reauth_throttle_service'
import vault from '#modules/coffre/services/vault_service'
import { vaultCreationValidator, vaultUnlockValidator } from '#modules/coffre/validators/coffre'

/**
 * La porte du coffre (CC-178) : poser la passphrase, ouvrir, refermer.
 *
 * ⚠️ **Ces routes sont les seules du module SANS élévation, et il ne peut pas en être autrement** —
 * exiger d'avoir ouvert le coffre pour atteindre l'écran qui l'ouvre serait un cercle. C'est
 * exactement la raison qui met `/reglages` sous `openRoute()` (CC-114) : « exiger un droit accordé
 * par quelqu'un d'autre pour régler son propre compte serait un cercle ». Elles restent sous
 * `can('coffre.view')` et sous `auth()`, et n'exposent aucun contenu.
 *
 * ## Les deux facteurs, dans cet ordre
 *
 * TOTP d'abord, passphrase ensuite. Deux raisons, et la seconde n'est pas cosmétique :
 *
 * - un code refusé évite de payer un `scrypt` — c'est le travail qu'on rationne, le même
 *   raisonnement que « vérifier le blocage AVANT `verifyCredentials` » (CC-78, CC-147) ;
 * - **les deux échecs rendent le MÊME message.** Les distinguer dirait à qui tient l'un des deux
 *   secrets qu'il ne lui manque que l'autre.
 *
 * ⚠️ **Un code accepté est CONSOMMÉ, même si la passphrase échoue ensuite.** `verifyTotp` avance
 * `totp_last_step` dès qu'il valide : c'est l'anti-rejeu de CC-114, et il ne connaît pas la suite
 * de notre histoire. Conséquence à connaître plutôt qu'à découvrir : reprendre après une
 * passphrase mal tapée demande d'attendre le code suivant. C'est le sens sûr — le relâcher
 * rouvrirait une fenêtre de rejeu de 90 s sur six chiffres.
 *
 * ⚠️ **Le throttle est celui de CC-147** (`reauth_<userId>`), pas un second compteur posé à côté :
 * il compte les échecs d'une **preuve fraîche**, ce que cette porte demande exactement. Un
 * deuxième compteur sur la même personne diviserait le budget d'essais par deux sans rien fermer.
 * ⚠️ Il n'est effacé que sur une ouverture **complète** — voir `clearFor` de CC-114 : « un succès
 * efface » veut dire un succès des deux facteurs.
 */
export default class CoffreDoorController {
  /** L'écran de la porte : création si aucun coffre, ouverture sinon. */
  async show({ inertia, auth, session, response }: HttpContext) {
    const user = auth.user!

    // Déjà ouvert : rien à demander. Sans ce renvoi, l'écran proposerait de rouvrir un coffre
    // ouvert, et une ouverture de plus re-tirerait une clé pour rien.
    if (vault.keyFor(user, session) !== null) {
      return response.redirect('/coffre')
    }

    return inertia.render('modules/coffre/ouvrir', {
      hasVault: (await vault.vaultFor(user)) !== null,
      // L'écran doit pouvoir dire *pourquoi* il ne s'ouvrira pas, plutôt que refuser à la
      // soumission un formulaire qu'il vient de proposer.
      hasTotp: user.hasTotp,
    })
  }

  /**
   * Pose le coffre d'un compte, la première fois.
   *
   * ⚠️ **Le second doublon est refusé par la BASE, pas par la lecture ci-dessous.** Celle-ci ne
   * sert qu'à donner un message propre au cas courant (deux onglets, un rechargement) ; deux
   * requêtes réellement simultanées la passeraient toutes les deux. C'est l'index unique sur
   * `user_id` qui tranche — et il faut qu'il tranche : un second sel rendrait indéchiffrables,
   * **sans lever**, toutes les entrées déjà écrites.
   */
  async create(ctx: HttpContext) {
    const { auth, request, response, session, i18n } = ctx
    const user = auth.user!
    const { passphrase, code } = await request.validateUsing(vaultCreationValidator)

    if ((await vault.vaultFor(user)) !== null) {
      return this.#refuser(ctx, i18n.t('coffre.alreadyExists'))
    }

    const refus = await this.#verifierSecondFacteur(ctx, code)
    if (refus !== null) return refus

    try {
      await vault.createVault(user, passphrase, session)
    } catch (error) {
      // 23505 = violation d'unicité (Postgres). Le coffre a été posé entre notre lecture et notre
      // écriture : l'état visé est atteint, mais pas par nous — on renvoie à la porte plutôt que
      // de laisser passer une erreur 500 sur un cas parfaitement normal.
      if ((error as { code?: string }).code !== '23505') throw error

      return this.#refuser(ctx, i18n.t('coffre.alreadyExists'))
    }

    await reauthThrottle.clearFor(user.id)

    return response.redirect('/coffre')
  }

  /** Ouvre le coffre : code TOTP puis passphrase. */
  async unlock(ctx: HttpContext) {
    const { auth, request, response, session, i18n } = ctx
    const user = auth.user!
    const { passphrase, code } = await request.validateUsing(vaultUnlockValidator)

    // Aucun coffre : il n'y a rien à ouvrir, et `show` proposera de le créer.
    if ((await vault.vaultFor(user)) === null) {
      return response.redirect('/coffre/ouvrir')
    }

    const refus = await this.#verifierSecondFacteur(ctx, code)
    if (refus !== null) return refus

    if (!(await vault.unlock(user, passphrase, session))) {
      await reauthThrottle.recordFailure(user.id)
      return this.#refuser(ctx, i18n.t('coffre.invalidProof'))
    }

    await reauthThrottle.clearFor(user.id)

    return response.redirect('/coffre')
  }

  /**
   * Referme le coffre.
   *
   * ⚠️ **Sans ré-authentification, comme le bouton de révocation des sessions de CC-176** :
   * l'action n'ouvre rien, et quelqu'un qui la déclencherait se couperait lui-même. Exiger une
   * preuve pour verrouiller ajouterait un oracle pour protéger un geste qui n'a rien à voler.
   */
  async lock({ auth, session, response }: HttpContext) {
    vault.lock(auth.user!, session)

    return response.redirect('/coffre/ouvrir')
  }

  /**
   * Le premier facteur. Rend une réponse de **refus**, ou `null` si le code est bon.
   *
   * ⚠️ **Le blocage se lit AVANT la vérification**, jamais après : un client déjà bloqué ne doit
   * consommer ni comparaison TOTP ni `scrypt`.
   */
  async #verifierSecondFacteur(ctx: HttpContext, code: string) {
    const { auth, i18n } = ctx
    const user = auth.user!

    const attente = await reauthThrottle.secondsBeforeRetry(user.id)
    if (attente > 0) {
      return this.#refuser(
        ctx,
        i18n.t('auth.reauthTooManyAttempts', { minutes: Math.max(1, Math.ceil(attente / 60)) })
      )
    }

    // ⚠️ Pas un échec throttlé : c'est la configuration du compte, que son porteur lit déjà sur
    // `/reglages`. La compter ferait verrouiller la porte à quelqu'un qui n'a encore rien tenté.
    if (!user.hasTotp) {
      return this.#refuser(ctx, i18n.t('coffre.totpRequired'))
    }

    // ⚠️ **Un code de secours n'ouvre PAS le coffre**, contrairement à `/login/2fa`. Là-bas il
    // rattrape un téléphone perdu, faute de quoi la base entière devient inaccessible ; ici il
    // n'y a rien à rattraper — le coffre reste fermé, son contenu intact, et le rouvrir ne
    // demande que le second facteur réenrôlé.
    const verdict = await twoFactor.verifyTotp(user, code)
    if (verdict.status !== 'ok') {
      await reauthThrottle.recordFailure(user.id)
      return this.#refuser(ctx, i18n.t('coffre.invalidProof'))
    }

    return null
  }

  /**
   * Le refus tel que la porte le rend : un message de formulaire, et on revient à l'écran.
   *
   * Sur `code` plutôt que `passphrase` parce que c'est le premier champ du formulaire — et parce
   * que le message ne dit de toute façon pas lequel des deux a échoué.
   */
  #refuser({ session, response }: HttpContext, message: string) {
    session.flash('errorsBag', { code: message })

    return response.redirect().back()
  }
}
