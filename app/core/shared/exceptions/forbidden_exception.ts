import { Exception } from '@adonisjs/core/exceptions'

/**
 * Le refus d'accès — **levé**, jamais retourné.
 *
 * ⚠️ **C'est toute la raison d'être de ce fichier, et elle n'est pas devinable.** Les trois
 * middlewares d'accès rendaient leur refus par `ctx.response.forbidden({ … })`, qui écrit une
 * réponse et s'arrête là. Or `statusPages` (voir `handler.ts`) n'est consulté que par le
 * gestionnaire d'**exceptions** : une réponse écrite à la main ne passe jamais devant lui.
 * Ajouter `'403'` aux status pages **sans** ce `throw` n'aurait donc strictement rien changé —
 * le refus aurait continué de rendre son JSON brut à un utilisateur non technique, et rien
 * n'aurait signalé que le correctif était inerte (un 403 reste un 403).
 *
 * Le corollaire vaut pour la suite : **un futur middleware qui refuserait par
 * `response.forbidden()` ferait disparaître la page 403 en silence.** Refuse en levant ceci.
 */
export default class ForbiddenException extends Exception {
  static status = 403
  static code = 'E_FORBIDDEN'
}
