import type { StoreRouteNode } from '@adonisjs/http-server/types'

/**
 * Ce qu'une route déclare comme condition d'accès.
 *
 * ⚠️ **Une seule définition de « déclaré », pas deux.** Cette fonction est lue par le
 * garde-barrière (`declared_capability_middleware`, au runtime) *et* par le test
 * d'énumération des routes (en CI). Si les deux avaient leur propre idée de ce qui compte
 * comme une déclaration, elles pourraient diverger — et c'est le test qui perdrait :
 * il resterait vert pendant que le garde-barrière laisse passer.
 */
export type RouteDeclaration =
  { kind: 'capability'; capability: string } | { kind: 'admin' } | { kind: 'open' }

/**
 * Les noms des middlewares nommés, tels qu'enregistrés dans `start/kernel.ts`.
 *
 * ⚠️ Renommer une clé dans `kernel.ts` sans la changer ici rendrait toutes les routes
 * « non déclarées », donc refusées en bloc. C'est bruyant, pas silencieux — et le test
 * d'énumération vérifie en plus qu'au moins une route porte chacun de ces trois noms.
 */
export const DECLARATION_MIDDLEWARE = {
  capability: 'can',
  admin: 'admin',
  open: 'openRoute',
} as const

/**
 * Lit la déclaration portée par une route, ou `null` si elle n'en porte aucune.
 *
 * `null` n'est pas « accès libre » : c'est un oubli, et l'appelant doit refuser.
 */
export function declarationOf(route: StoreRouteNode): RouteDeclaration | null {
  for (const one of route.middleware.all()) {
    // Les middlewares anonymes (fonctions) ne déclarent rien : seuls les middlewares
    // nommés portent un nom et des arguments introspectables.
    if (typeof one === 'function' || !('name' in one) || !one.name) continue

    if (one.name === DECLARATION_MIDDLEWARE.admin) {
      return { kind: 'admin' }
    }

    if (one.name === DECLARATION_MIDDLEWARE.open) {
      return { kind: 'open' }
    }

    if (one.name === DECLARATION_MIDDLEWARE.capability) {
      // `args` est typé `any[]` par le framework alors qu'un middleware nommé y range son
      // premier argument tel quel. On repasse par `unknown` pour que le test `typeof`
      // ci-dessous soit un vrai narrowing plutôt qu'une conversion de confiance.
      const capability: unknown = one.args
      // Un `can()` sans argument est un oubli à mi-chemin : on le traite comme une
      // absence de déclaration, pas comme une capacité vide qui laisserait passer.
      if (typeof capability !== 'string' || capability.length === 0) continue
      return { kind: 'capability', capability }
    }
  }

  return null
}
