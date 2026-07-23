import { test } from '@japa/runner'
import router from '@adonisjs/core/services/router'
import type { RouteJSON } from '@adonisjs/http-server/types'
import capabilities from '#core/auth/capabilities/registry'
import navigation from '#core/shared/navigation/registry'
import { declarationOf } from '#core/auth/capabilities/route_declaration'

/**
 * Le registre des destinations décide de **deux** choses : ce que montre la barre latérale, et
 * où atterrit un compte qui vient de se connecter. Les deux se trompent en silence.
 *
 * ⚠️ **Suite `functional`, pas `unit`** — pour la même raison que `capabilities_routes.spec.ts` :
 * `router.toJSON()` n'est alimenté qu'au démarrage du serveur HTTP, et le registre n'est peuplé
 * que par le preload `#start/navigation`. En unit, les deux seraient vides et cette suite
 * passerait au vert sans avoir rien croisé.
 */
test.group('Core / registre des destinations', () => {
  function allRoutes(): RouteJSON[] {
    router.commit()
    return router.toJSON().root ?? []
  }

  test('les destinations attendues sont enregistrées, dans cet ordre', ({ assert }) => {
    // ⚠️ **L'ordre est la page d'accueil des comptes**, pas une préférence d'affichage : on
    // redirige vers la première destination ouvrable. Cette assertion est aussi le seul filet
    // contre un module oublié dans `start/navigation.ts` — l'oubli ne casse rien de visible, il
    // envoie sur « aucun accès » un compte qui a pourtant des droits.
    assert.deepEqual(
      navigation.all().map((destination) => `${destination.key} → ${destination.href}`),
      [
        'accueil → /',
        'services → /services',
        'agents → /agents',
        'veille → /veille',
        'revision → /revision',
      ]
    )
  })

  test('chaque capacité citée par une destination est déclarée par un module', ({ assert }) => {
    // Même piège que pour les routes : `leitner.veiw` ferait disparaître l'entrée de la barre
    // **et** sauter la destination à l'atterrissage, pour tous les non-admins — pendant qu'un
    // administrateur, qui passe outre les capacités, ne verrait strictement rien d'anormal.
    const unknown = navigation
      .all()
      .filter(
        (destination) =>
          'capability' in destination.access && !capabilities.has(destination.access.capability)
      )
      .map((destination) => destination.href)

    assert.deepEqual(unknown, [], 'Capacités inconnues du registre (faute de frappe ?)')
  })

  test('chaque destination désigne une route dont elle porte la vraie condition d’accès', ({
    assert,
  }) => {
    // ⚠️ **L'invariant du lot : une destination ne doit jamais mener à un 403.** Si une
    // destination citait une capacité que sa route n'exige pas, l'atterrissage enverrait
    // l'utilisateur droit sur le refus qu'on vient de lui épargner — et la barre lui proposerait
    // un lien mort. On compare donc à la déclaration **réelle** de la route, pas à une copie.
    const mismatched: string[] = []

    for (const destination of navigation.all()) {
      const route = allRoutes().find(
        (one) => one.pattern === destination.href && one.methods.includes('GET')
      )

      if (!route) {
        mismatched.push(`${destination.href} — aucune route GET ne répond à ce chemin`)
        continue
      }

      const declaration = declarationOf(route)

      if ('admin' in destination.access) {
        if (declaration?.kind !== 'admin') {
          mismatched.push(`${destination.href} — destination admin, route ${declaration?.kind}`)
        }
        continue
      }

      if (declaration?.kind !== 'capability') {
        mismatched.push(
          `${destination.href} — destination sous capacité, route ${declaration?.kind}`
        )
      } else if (declaration.capability !== destination.access.capability) {
        mismatched.push(
          `${destination.href} — destination « ${destination.access.capability} », ` +
            `route « ${declaration.capability} »`
        )
      }
    }

    assert.deepEqual(mismatched, [], 'Destinations et routes ne disent pas la même chose')
  })

  test('l’atterrissage suit ce que le compte peut réellement ouvrir', ({ assert }) => {
    const admin = { isAdmin: true, capabilities: new Set<string>() }
    const lecteur = { isAdmin: false, capabilities: new Set(['leitner.view']) }
    const nu = { isAdmin: false, capabilities: new Set<string>() }

    // ⚠️ Un administrateur ne porte **aucune** capacité : il passe outre. Si `landingFor` lisait
    // la liste au lieu du drapeau, il tomberait ici sur « aucun accès ».
    assert.equal(navigation.landingFor(admin)?.href, '/')
    assert.equal(navigation.landingFor(lecteur)?.href, '/revision')
    assert.isNull(navigation.landingFor(nu))
  })

  test('une capacité n’ouvre jamais une destination réservée à is_admin', ({ assert }) => {
    // L'invariant de CC-71 vu depuis la navigation : ce compte porte toutes les capacités
    // déclarées par les modules, et Services comme Agents restent invisibles — parce qu'aucune
    // capacité ne les couvre, pas parce qu'une règle les nomme.
    const complet = { isAdmin: false, capabilities: new Set(capabilities.all()) }

    const visibles = navigation.visibleFor(complet).map((destination) => destination.href)

    assert.notInclude(visibles, '/services')
    assert.notInclude(visibles, '/agents')
    assert.include(visibles, '/veille')
    assert.include(visibles, '/revision')
  })
})
