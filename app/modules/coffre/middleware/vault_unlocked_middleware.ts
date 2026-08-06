import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import ForbiddenException from '#core/shared/exceptions/forbidden_exception'
import vault from '#modules/coffre/services/vault_service'

/**
 * Le second étage du mur : sans élévation de session, aucune route du coffre ne répond (CC-178).
 *
 * ⚠️ **Ce n'est pas un doublon de `can('coffre.view')`, les deux étages n'achètent pas la même
 * chose.** La capacité dit *qui* a le droit d'entrer ; l'élévation dit *que la personne vient de
 * le prouver*. Une session valide de sept jours (la borne de CC-78) suffit à la première et ne dit
 * rien de la seconde : un cookie volé porte toutes les capacités de son propriétaire.
 *
 * ⚠️ **Le refus se LÈVE, il ne se retourne pas.** `response.forbidden()` court-circuiterait
 * `statusPages`, donc la page 403, et rendrait du JSON brut au navigateur sans que rien ne le
 * signale — un 403 reste un 403. Voir `ForbiddenException` et `can_middleware`.
 *
 * ⚠️ **Il ne redirige pas vers la porte, et c'est un choix, pas un oubli.** Une redirection serait
 * plus douce à l'usage ; elle rendrait aussi le mur invisible depuis `curl`, et la seule chose que
 * le ticket demande de prouver est qu'une route atteinte sans élévation **refuse**. On retourne à
 * `/coffre/ouvrir` en tapant l'URL — c'est le prix du rideau, qui n'offre aucun lien.
 */
export default class VaultUnlockedMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const user = ctx.auth.user

    // Sécurité en profondeur : ces routes vivent sous `middleware.auth()`, qui a déjà tranché.
    // Cette ligne compte pour celle qui porterait le middleware sans `auth` — elle refuse au lieu
    // de planter sur un utilisateur absent. Même motif que `can_middleware`.
    if (!user) {
      throw new ForbiddenException('Accès refusé.')
    }

    if (vault.keyFor(user, ctx.session) === null) {
      throw new ForbiddenException('Le coffre est verrouillé.')
    }

    return next()
  }
}
