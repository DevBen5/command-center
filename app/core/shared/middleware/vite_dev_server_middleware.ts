import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import app from '@adonisjs/core/services/app'
import router from '@adonisjs/core/services/router'
import ViteMiddleware from '@adonisjs/vite/vite_middleware'

/**
 * Le serveur de dev Vite, mais **derrière les routes de l'application** (CC-170).
 *
 * ⚠️ **`@adonisjs/vite/vite_middleware` est un middleware SERVEUR : il répond avant que le
 * routeur n'ait vu la requête**, et le serveur de dev Vite résout les chemins contre la racine
 * du projet. Un chemin sans extension est traité par Vite comme une requête JS et résolu avec sa
 * liste d'extensions, `.json` comprise : un fichier `<racine>/agents.json` répond donc à
 * `GET /agents` — 200 `text/javascript`, sans authentification, la route n'étant jamais atteinte.
 *
 * Ce n'est pas une hypothèse : `agents.json` (le fichier de déclaration de CC-141, ignoré par
 * git) a rendu `/agents` inatteignable en dev, servi `config.command` à un anonyme, et fait
 * rougir deux specs que la CI ne voyait pas — le runner n'ayant pas le fichier.
 *
 * D'où ce garde, qui tient en une règle : **une route enregistrée gagne toujours**. Tout le
 * reste — `/@vite/*`, `/@id/*`, `/inertia/*`, `/node_modules/.vite/*` — n'est une route pour
 * personne et part chez Vite, inchangé.
 *
 * ⚠️ **Ne remplace pas ce fichier par `@adonisjs/vite/vite_middleware` dans `start/kernel.ts`**,
 * même « pour revenir au scaffold » : le comportement du serveur d'assets redeviendrait
 * prioritaire sur celui de l'application, et l'échec est silencieux (200 au lieu de 403).
 * `tests/functional/core/vite_route_shadowing.spec.ts` le tient.
 *
 * Deux détails assumés :
 *
 * - `router.match` tourne aussi en production, où il n'y a aucun serveur de dev à court-circuiter.
 *   C'est une recherche radix sur un arbre que le routeur reparcourt juste après : le coût est
 *   négligeable, et le recopier derrière une condition `inDev`/`inTest` dupliquerait la logique
 *   de `ViteProvider` — deux endroits à tenir d'accord pour rien.
 * - le middleware vendeur est **récupéré du conteneur**, jamais reconstruit : c'est
 *   `ViteProvider.register()` qui l'y enregistre en singleton, avec l'instance de `Vite` qui
 *   porte le serveur de dev. Le résoudre à la première requête plutôt qu'à l'import évite de
 *   dépendre de l'ordre de boot.
 */
export default class ViteDevServerMiddleware {
  #vendeur?: ViteMiddleware

  async handle(ctx: HttpContext, next: NextFn) {
    if (router.match(ctx.request.url(), ctx.request.method())) {
      return next()
    }

    this.#vendeur ??= await app.container.make(ViteMiddleware)
    return this.#vendeur.handle(ctx, next)
  }
}
