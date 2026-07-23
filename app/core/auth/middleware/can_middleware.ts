import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { capabilitiesFor } from '#core/auth/services/capability_service'
import ForbiddenException from '#core/shared/exceptions/forbidden_exception'

/**
 * Exige une capacité sur une route.
 *
 * ⚠️ **C'est ici que se joue le droit, pas dans l'UI.** Une route est un contrat public :
 * `POST /revision/cards` répond que le bouton soit affiché ou non, et un `curl` muni d'un
 * cookie de session valide n'a que faire du rendu Vue. Masquer un bouton évite d'offrir une
 * action qui échouera ; ça ne ferme rien.
 *
 * ⚠️ **Le refus est levé, jamais retourné** — voir `ForbiddenException`. Un
 * `response.forbidden()` court-circuiterait le gestionnaire d'exceptions, donc la page 403,
 * et renverrait du JSON brut au navigateur sans que rien ne le signale.
 */
export default class CanMiddleware {
  async handle(ctx: HttpContext, next: NextFn, capability?: string) {
    // Un `can()` sans argument est un oubli à mi-chemin. Refuser plutôt que laisser passer :
    // le garde-barrière ne le compte pas non plus comme une déclaration.
    if (!capability) {
      throw new ForbiddenException('Capacité requise non déclarée.')
    }

    const user = ctx.auth.user

    // Sécurité en profondeur : sur les routes du groupe protégé, `auth` a déjà tranché.
    // Cette ligne compte pour la route qui porterait `can()` sans `auth` — elle refuse
    // au lieu de planter sur un utilisateur absent.
    if (!user || !user.isActive) {
      throw new ForbiddenException('Accès refusé.')
    }

    if (user.isAdmin) {
      return next()
    }

    const granted = await capabilitiesFor(ctx)
    if (!granted.has(capability)) {
      throw new ForbiddenException('Accès refusé.')
    }

    return next()
  }
}
