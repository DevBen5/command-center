import logger from '@adonisjs/core/services/logger'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { declarationOf } from '#core/auth/capabilities/route_declaration'

/**
 * Le garde-barrière : **aucune route ne répond sans avoir déclaré sa condition d'accès.**
 *
 * Enregistré en dernier dans le `router.use([...])` de `start/kernel.ts`, il s'exécute donc
 * avant tous les middlewares nommés de la route — y compris `auth`.
 *
 * ⚠️ **Pourquoi il existe alors qu'un test énumère déjà les routes.** Le test dit qu'une
 * route est mal déclarée ; il ne le dit qu'à celui qui lance la suite. Une route ajoutée
 * dans un lot futur sans capacité resterait ouverte à tous entre le moment où elle est
 * écrite et le prochain `npm test` — et si elle est ajoutée sur une branche qui ne fait pas
 * tourner la suite, indéfiniment. Ici, l'oubli est **fermé** dès la première requête.
 *
 * Le test et ce middleware lisent la même fonction `declarationOf` : il n'existe pas deux
 * définitions de « déclaré » qui pourraient diverger.
 *
 * Le refus est un 403 et non une erreur de configuration : en production, une route oubliée
 * doit se fermer proprement, pas rendre l'application bruyante. Le `logger.error` est là
 * pour que ça ne soit pas non plus silencieux — un 403 inexpliqué en développement se
 * diagnostique en lisant le journal.
 */
export default class DeclaredCapabilityMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    // `ctx.route` est renseigné dès qu'une route a été trouvée. Une URL qui ne correspond
    // à rien n'arrive jamais ici : elle reste une 404, et c'est bien ce qu'elle est.
    const route = ctx.route
    if (!route) {
      return next()
    }

    if (declarationOf(route) === null) {
      logger.error(
        { route: route.pattern, method: ctx.request.method() },
        'Route sans condition d’accès déclarée : refusée. ' +
          'Ajoute middleware.can(…), middleware.admin() ou middleware.openRoute() sur cette route.'
      )
      return ctx.response.forbidden({ error: 'Accès refusé.' })
    }

    return next()
  }
}
