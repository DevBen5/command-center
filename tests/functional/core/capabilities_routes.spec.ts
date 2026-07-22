import { test } from '@japa/runner'
import router from '@adonisjs/core/services/router'
import registry from '#core/auth/capabilities/registry'
import { declarationOf, DECLARATION_MIDDLEWARE } from '#core/auth/capabilities/route_declaration'
import type { RouteJSON } from '@adonisjs/http-server/types'

/**
 * Le garde-fou du futur : **aucune route ne doit répondre sans avoir déclaré sa condition
 * d'accès**. Une route ajoutée dans un lot futur sans `can()`, `admin()` ni `openRoute()`
 * fait rougir cette suite — une relecture ne l'attraperait pas.
 *
 * ⚠️ **Cette suite vit en `functional`, pas en `unit`, et ce n'est pas un détail.**
 * `router.toJSON()` est alimenté par `commit()`, appelé au démarrage du serveur HTTP. En
 * suite unit, le serveur n'est pas démarré : le tableau serait **vide** et la boucle
 * passerait au vert sans avoir rien vérifié. D'où l'assertion de volume en premier — un
 * garde-fou qui peut réussir à vide n'en est pas un.
 */
test.group('Core / déclaration des routes', () => {
  function allRoutes(): RouteJSON[] {
    // Idempotent : le serveur de test a déjà committé. L'appel protège contre un
    // réordonnancement des hooks de Japa qui ferait tourner cette suite avant.
    router.commit()
    return router.toJSON().root ?? []
  }

  test('le router expose bien les routes de l’application', ({ assert }) => {
    // Si cette assertion tombe, les suivantes ne prouvent plus rien : elles boucleraient
    // sur zéro route. Le seuil est volontairement bas et absolu — il ne suit pas le nombre
    // réel de routes, il détecte l'introspection cassée.
    assert.isAbove(allRoutes().length, 50)
  })

  test('aucune route ne répond sans condition d’accès déclarée', ({ assert }) => {
    const undeclared = allRoutes()
      .filter((route) => declarationOf(route) === null)
      .map((route) => `${route.methods.join(',')} ${route.pattern}`)

    assert.deepEqual(
      undeclared,
      [],
      'Ces routes n’ont ni can(), ni admin(), ni openRoute() — elles sont refusées au ' +
        'runtime par le garde-barrière, et il faut leur déclarer une condition d’accès.'
    )
  })

  test('chaque capacité citée par une route est déclarée par un module', ({ assert }) => {
    // ⚠️ Sans ce test, une faute de frappe (`can('leitner.reviw')`) fermerait une route
    // pour toujours **en silence** : la capacité n'existant dans aucun module, l'écran
    // d'administration ne la proposerait pas, personne ne pourrait l'accorder — et
    // `is_admin` continuerait de passer, donc invisible pour qui teste avec son compte.
    const unknown = allRoutes()
      .map((route) => ({ route, declaration: declarationOf(route) }))
      .filter(
        ({ declaration }) =>
          declaration?.kind === 'capability' && !registry.has(declaration.capability)
      )
      .map(
        ({ route, declaration }) =>
          `${route.pattern} → ${declaration?.kind === 'capability' ? declaration.capability : ''}`
      )

    assert.deepEqual(unknown, [], 'Capacités inconnues du registre (faute de frappe ?)')
  })

  test('les trois formes de déclaration sont effectivement reconnues', ({ assert }) => {
    // Vérifie que `declarationOf` et les clés de `router.named()` de `start/kernel.ts`
    // parlent encore de la mêmes chose. Un renommage d'un côté seulement ferait tomber les
    // routes concernées en 403 : ce test le dit avant que quiconque le découvre à l'usage.
    const kinds = new Set(allRoutes().map((route) => declarationOf(route)?.kind))

    assert.isTrue(
      kinds.has('capability'),
      `aucune route ne porte ${DECLARATION_MIDDLEWARE.capability}()`
    )
    assert.isTrue(kinds.has('admin'), `aucune route ne porte ${DECLARATION_MIDDLEWARE.admin}()`)
    assert.isTrue(kinds.has('open'), `aucune route ne porte ${DECLARATION_MIDDLEWARE.open}()`)
  })

  test('Services et Agents ne sont couverts par aucune capacité', ({ assert }) => {
    // ⚠️ Ces deux modules exécutent des commandes sur la machine hôte. `admin()` est le seul
    // chemin : une capacité les couvrant permettrait à un rôle d'y ouvrir l'accès, ce qui
    // est précisément ce qu'on ne veut pas rendre possible depuis un écran.
    const wrong = allRoutes()
      .filter(
        (route) => route.pattern.startsWith('/services') || route.pattern.startsWith('/agents')
      )
      .filter((route) => declarationOf(route)?.kind !== 'admin')
      .map((route) => route.pattern)

    assert.deepEqual(wrong, [], 'Ces routes devraient être réservées à admin()')
  })

  test('le stack global du router n’a pas changé sans qu’on le veuille', ({ assert }) => {
    // ⚠️ **Ce test verrouille le branchement du garde-barrière**, et il est le seul à le
    // faire. On l'a mesuré : en retirant sa ligne du `router.use([...])` de
    // `start/kernel.ts`, les 542 tests restaient verts — la protection runtime pouvait
    // disparaître en silence.
    //
    // On ne peut pas vérifier mieux : les middlewares globaux sont **anonymes** dans
    // `route.middleware` (`name: ''`, et un `handle` identique — le wrapper d'import
    // paresseux), donc rien ne permet d'identifier lequel est lequel. Reste leur nombre.
    //
    // Si ce test tombe parce que tu as ajouté un middleware global : monte le compte, mais
    // **vérifie d'abord** que `declared_capability_middleware` est toujours dans la liste.
    // S'il tombe parce que le compte a baissé, c'est probablement lui qu'on vient de perdre.
    const GLOBAUX_ATTENDUS = 6

    const route = allRoutes().find((one) => one.pattern === '/login')
    assert.isDefined(route, 'la route /login a disparu — ce test ne mesure plus rien')

    const anonymes = [...route!.middleware.all()].filter(
      (one) => typeof one === 'function' || !('name' in one) || !one.name
    )

    assert.lengthOf(
      anonymes,
      GLOBAUX_ATTENDUS,
      'Le nombre de middlewares globaux (router.use dans start/kernel.ts) a changé. ' +
        'Vérifie que declared_capability_middleware y est toujours : sans lui, une route ' +
        'sans condition d’accès déclarée répondrait normalement au lieu d’être refusée.'
    )
  })
})
