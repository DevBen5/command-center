import { test } from '@japa/runner'
import { HttpContextFactory } from '@adonisjs/core/factories/http'
import type { StoreRouteNode } from '@adonisjs/http-server/types'
import DeclaredCapabilityMiddleware from '#core/auth/middleware/declared_capability_middleware'
import ForbiddenException from '#core/shared/exceptions/forbidden_exception'

/**
 * Le garde-barrière : **il refuse une route qui n'a rien déclaré**.
 *
 * ⚠️ **Pourquoi ce fichier existe.** Le test d'énumération (`capabilities_routes.spec.ts`)
 * relit `start/routes.ts` et vérifie que chaque route porte sa déclaration — il ne dit rien
 * du middleware. On l'a mesuré : en retirant la ligne du `router.use([...])` de
 * `start/kernel.ts`, **toute la suite restait verte**. La protection runtime pouvait donc
 * disparaître sans qu'aucun test ne bronche, et une route oubliée serait restée ouverte
 * jusqu'au prochain passage de la suite — voire indéfiniment sur une branche qui ne la
 * lance pas.
 *
 * Ces tests couvrent le **comportement** du middleware ; le verrou sur son enregistrement
 * dans le stack global vit dans `capabilities_routes.spec.ts`, faute de pouvoir identifier
 * un middleware global par introspection (ils sont tous anonymes, cf. le commentaire là-bas).
 */
test.group('Core / garde-barrière des routes', () => {
  /** Une route factice, avec le stack de middlewares qu'on veut lui donner. */
  function fakeRoute(middleware: unknown[]): StoreRouteNode {
    return {
      pattern: '/route-de-test',
      middleware: { all: () => new Set(middleware) },
    } as unknown as StoreRouteNode
  }

  /**
   * ⚠️ **Le refus est une exception levée, plus une réponse écrite** (CC-81) : c'est le seul
   * chemin qui passe devant les status pages, donc devant la page 403. On lit donc le statut
   * sur l'exception, jamais sur `ctx.response` — qui n'a rien reçu.
   */
  async function run(route: StoreRouteNode | undefined) {
    const ctx = new HttpContextFactory().create()
    ctx.route = route
    let passed = false
    let status: number | null = null

    try {
      await new DeclaredCapabilityMiddleware().handle(ctx, async () => {
        passed = true
      })
    } catch (error) {
      // Le `instanceof` fait partie de l'assertion : une autre exception ne compte pas comme
      // un refus, elle laisserait `status` à `null` et ferait rougir les tests ci-dessous.
      status = error instanceof ForbiddenException ? error.status : null
    }

    return { passed, status }
  }

  test('refuse une route qui n’a déclaré aucune condition d’accès', async ({ assert }) => {
    const { passed, status } = await run(fakeRoute([{ name: 'auth' }]))

    assert.isFalse(passed, 'la requête ne doit pas atteindre le contrôleur')
    assert.equal(status, 403)
  })

  test('laisse passer une route qui exige une capacité', async ({ assert }) => {
    const { passed } = await run(fakeRoute([{ name: 'can', args: 'leitner.view' }]))

    assert.isTrue(passed)
  })

  test('laisse passer une route réservée aux administrateurs', async ({ assert }) => {
    const { passed } = await run(fakeRoute([{ name: 'admin' }]))

    assert.isTrue(passed)
  })

  test('laisse passer une route explicitement ouverte', async ({ assert }) => {
    const { passed } = await run(fakeRoute([{ name: 'openRoute' }]))

    assert.isTrue(passed)
  })

  test('un can() sans capacité ne compte pas comme une déclaration', async ({ assert }) => {
    // Un oubli à mi-chemin — `middleware.can()` écrit sans argument. Le traiter comme une
    // déclaration valide ouvrirait la route à tout compte authentifié.
    const { passed, status } = await run(fakeRoute([{ name: 'can' }]))

    assert.isFalse(passed)
    assert.equal(status, 403)
  })

  test('un middleware anonyme ne déclare rien', async ({ assert }) => {
    // Les middlewares globaux du router sont des fonctions sans nom : ils ne doivent en
    // aucun cas être pris pour une déclaration, sinon **toutes** les routes passeraient.
    const { passed, status } = await run(fakeRoute([() => {}, { name: '' }]))

    assert.isFalse(passed)
    assert.equal(status, 403)
  })

  test('une URL qui ne correspond à aucune route reste une 404', async ({ assert }) => {
    // Sans route trouvée, il n'y a rien à déclarer : le middleware se retire et laisse le
    // framework rendre sa 404. La transformer en 403 masquerait les vraies erreurs de chemin.
    const { passed } = await run(undefined)

    assert.isTrue(passed)
  })
})
