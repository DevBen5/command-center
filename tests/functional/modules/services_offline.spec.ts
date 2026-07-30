import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import dockerConfig from '#config/docker'
import Service from '#modules/services/models/service'
import { createAdmin } from '#tests/helpers/users'

/**
 * L'écran Services quand le déploiement n'a pas Docker (CC-116).
 *
 * ⚠️ Le chemin « hors service » n'est atteignable par aucun `.env` de test sans redémarrage :
 * on mute la propriété `disponible` du singleton de config, restaurée en teardown. C'est la
 * couture que `config/docker.ts` documente — le contrôleur lit le flag **à chaque requête**.
 * Si quelqu'un le destructure à l'import, ces tests rougissent : c'est leur second rôle.
 */
test.group('Services / hors service (CC-116)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.setup(() => {
    dockerConfig.disponible = false
    return () => {
      dockerConfig.disponible = true
    }
  })

  test("GET /services annonce hors service et n'envoie aucun conteneur", async ({
    client,
    assert,
  }) => {
    const admin = await createAdmin()
    // Une ligne en base, pour prouver qu'elle ne DESCEND pas : un écran vide par absence de
    // données serait vert même sur un contrôleur qui continue d'envoyer la table.
    await Service.create({
      name: 'Jellyfin',
      category: 'Média',
      status: 'up',
      cpuPercent: 12,
      ramPercent: 30,
    })

    const response = await client.get('/services').loginAs(admin).withInertia()

    response.assertStatus(200)
    response.assertInertiaComponent('modules/services/index')
    const props = response.inertiaProps as Record<string, any>
    assert.isFalse(props.dockerDisponible)
    assert.deepEqual(props.services, [])
    assert.equal(props.stats.total, 0)
  })

  test("un POST d'action ne touche pas la base", async ({ client, assert }) => {
    const admin = await createAdmin()
    const service = await Service.create({ name: 'Jellyfin', category: 'Média', status: 'down' })

    const response = await client
      .post(`/services/${service.id}/start`)
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    await service.refresh()
    assert.equal(
      service.status,
      'down',
      'la garde serveur a laissé un POST direct fabriquer un statut inventé'
    )
  })
})

/**
 * Le pendant : sous le défaut de test (`disponible`), l'écran garde son comportement — c'est le
 * « rien ne change en dev » du ticket, prouvé plutôt qu'affirmé.
 */
test.group('Services / Docker disponible (CC-116)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test("l'écran envoie le flag vrai et les services", async ({ client, assert }) => {
    const admin = await createAdmin()
    await Service.create({ name: 'Jellyfin', category: 'Média', status: 'up' })

    const response = await client.get('/services').loginAs(admin).withInertia()

    response.assertStatus(200)
    const props = response.inertiaProps as Record<string, any>
    assert.isTrue(props.dockerDisponible)
    assert.equal(props.services.length, 1)
  })
})
