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
  // ⚠️ **Le nôtre, pas `@adonisjs/vite/vite_middleware`** (CC-170) : le middleware vendeur
  // répond avant le routeur, et le serveur de dev Vite résout les chemins contre la racine du
  // projet — un `agents.json` y masquait `GET /agents` en 200 `text/javascript`, sans
  // authentification. Celui-ci lui délègue tout, sauf ce qui est une route déclarée.
  () => import('#core/shared/middleware/vite_dev_server_middleware'),
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
  /**
   * L'élévation de session du coffre (CC-178).
   *
   * ⚠️ **Ce n'est PAS une quatrième forme de déclaration** : `declarationOf` n'en connaît que
   * trois, et une route du coffre porte donc toujours son `can(…)` en plus. Ce middleware
   * n'ouvre rien qu'une capacité n'ait déjà ouvert — il ferme un cran de plus.
   *
   * ⚠️ **Nommé, jamais global.** Un middleware global de plus ferait rougir
   * `capabilities_routes.spec.ts`, qui fige leur nombre parce que c'est la seule chose qui
   * distingue le garde-barrière d'un oubli — et il tournerait sur toutes les routes du dépôt
   * pour n'en concerner que six. L'import est paresseux : un `MODULES` sans `coffre` ne charge
   * jamais ce fichier.
   */
  coffreOuvert: () => import('#modules/coffre/middleware/vault_unlocked_middleware'),
})
