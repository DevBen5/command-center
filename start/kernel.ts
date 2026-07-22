/*
|--------------------------------------------------------------------------
| HTTP kernel file
|--------------------------------------------------------------------------
|
| The HTTP kernel file is used to register the middleware with the server
| or the router.
|
*/

import router from '@adonisjs/core/services/router'
import server from '@adonisjs/core/services/server'

/**
 * The error handler is used to convert an exception
 * to an HTTP response.
 */
server.errorHandler(() => import('#core/shared/exceptions/handler'))

/**
 * The server middleware stack runs middleware on all the HTTP
 * requests, even if there is no route registered for
 * the request URL.
 */
server.use([
  () => import('#core/shared/middleware/container_bindings_middleware'),
  () => import('@adonisjs/static/static_middleware'),
  () => import('@adonisjs/cors/cors_middleware'),
  () => import('@adonisjs/vite/vite_middleware'),
  () => import('@adonisjs/inertia/inertia_middleware'),
])

/**
 * The router middleware stack runs middleware on all the HTTP
 * requests with a registered route.
 */
router.use([
  () => import('@adonisjs/core/bodyparser_middleware'),
  () => import('@adonisjs/session/session_middleware'),
  () => import('@adonisjs/shield/shield_middleware'),
  () => import('@adonisjs/auth/initialize_auth_middleware'),
  () => import('#core/i18n/middleware/detect_user_locale_middleware'),
  // ⚠️ **En dernier, et c'est voulu.** Ce middleware refuse toute route qui n'a pas déclaré
  // sa condition d'accès (`can`, `admin` ou `openRoute`). Être global le place avant les
  // middlewares nommés de chaque route : une route oubliée est fermée avant même d'être
  // authentifiée. C'est ce qui fait que « refus par défaut » est une propriété du code et
  // pas une discipline de relecture.
  () => import('#core/auth/middleware/declared_capability_middleware'),
])

/**
 * Named middleware collection must be explicitly assigned to
 * the routes or the routes group.
 */
// ⚠️ Les clés `can`, `admin` et `openRoute` sont lues telles quelles par `declarationOf`
// (`#core/auth/capabilities/route_declaration`) : c'est par leur **nom** qu'une route est
// reconnue comme déclarée. Renommer une clé ici sans la changer là-bas ferait tomber toutes
// les routes concernées en 403 — bruyant, donc rattrapable ; le test d'énumération vérifie
// en plus qu'au moins une route porte chacun de ces trois noms.
export const middleware = router.named({
  guest: () => import('#core/auth/middleware/guest_middleware'),
  auth: () => import('#core/auth/middleware/auth_middleware'),
  can: () => import('#core/auth/middleware/can_middleware'),
  admin: () => import('#core/auth/middleware/admin_middleware'),
  openRoute: () => import('#core/auth/middleware/open_route_middleware'),
})
