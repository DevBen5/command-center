import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import Service from '#modules/services/models/service'
import Agent from '#modules/agents/models/agent'
import VeilleItem from '#modules/veille/models/veille_item'
import { createAdmin, createUserWith } from '#tests/helpers/users'

/**
 * Ce que le tableau de bord **envoie**, pas ce qu'il affiche.
 *
 * ⚠️ **L'assertion porte sur le payload Inertia, et c'est tout le sujet.** Le contrôleur
 * publiait les noms des services arrêtés et des agents en échec à quiconque portait
 * `dashboard.view` — or Services et Agents sont réservés à `is_admin` **parce qu'ils exécutent
 * des commandes sur la machine hôte**. Un `v-if` dans `home.vue` n'aurait rien fermé : les noms
 * seraient restés dans le payload, lisibles dans le source de la page. Masquer n'est pas
 * fermer ; c'est le serveur qui ferme, et c'est ici qu'on le vérifie (CC-81).
 */
test.group('Core / portée du tableau de bord', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  /** De quoi rendre la fuite visible si elle revenait : des noms reconnaissables. */
  async function seed() {
    await Service.create({
      name: 'postgres-prod',
      category: 'base',
      status: 'down',
      config: {},
    })
    await Agent.create({
      name: 'sauvegarde-nocturne',
      framework: 'cron',
      status: 'failed',
      config: {},
      logs: [],
    })
    await VeilleItem.create({ title: 'Un article', type: 'article', tags: [] })
  }

  test('un non-admin ne reçoit ni Services ni Agents', async ({ client, assert }) => {
    await seed()
    const lecteur = await createUserWith(['dashboard.view', 'leitner.view'])

    const response = await client.get('/').loginAs(lecteur).withInertia()

    response.assertStatus(200)
    const props = response.inertiaProps as Record<string, any>

    assert.isNull(props.cards.services)
    assert.isNull(props.cards.agents)
    // La preuve directe : le nom du conteneur n'est nulle part dans ce qui est envoyé.
    assert.notInclude(JSON.stringify(props), 'postgres-prod')
    assert.notInclude(JSON.stringify(props), 'sauvegarde-nocturne')
  })

  test('un module non accordé ne descend pas non plus', async ({ client, assert }) => {
    // ⚠️ Le ticket ne citait que Services et Agents, mais Veille et Leitner partaient sans
    // garde eux aussi. `NavStatsService` filtre déjà ses quatre sections : le tableau de bord
    // était le seul endroit qui ne le faisait pas.
    await seed()
    const lecteur = await createUserWith(['dashboard.view', 'leitner.view'])

    const response = await client.get('/').loginAs(lecteur).withInertia()

    const props = response.inertiaProps as Record<string, any>
    assert.isNull(props.cards.veille)
    // Celui-là est accordé : c'est un objet, pas `null` — les deux ne veulent pas dire la
    // même chose, exactement comme pour les compteurs de la barre latérale.
    assert.isNotNull(props.cards.leitner)
  })

  test('un administrateur reçoit tout, comme avant', async ({ client, assert }) => {
    await seed()
    const admin = await createAdmin()

    const response = await client.get('/').loginAs(admin).withInertia()

    const props = response.inertiaProps as Record<string, any>

    assert.deepEqual(props.cards.services.down, ['postgres-prod'])
    // `failed` porte l'id en plus du nom (CC-52) : la carte d'accueil pointe chaque agent vers
    // `/agents?id=<id>`. L'id est auto-généré, on asserte donc la forme, pas sa valeur.
    assert.lengthOf(props.cards.agents.failed, 1)
    assert.equal(props.cards.agents.failed[0].name, 'sauvegarde-nocturne')
    assert.isNumber(props.cards.agents.failed[0].id)
    assert.equal(props.cards.veille.total, 1)
    assert.isNotNull(props.cards.leitner)
  })

  test('les entrées de navigation partagées suivent les mêmes droits', async ({
    client,
    assert,
  }) => {
    const lecteur = await createUserWith(['dashboard.view', 'leitner.view'])

    const response = await client.get('/').loginAs(lecteur).withInertia()

    const props = response.inertiaProps as Record<string, any>
    const hrefs = props.destinations.map((destination: { href: string }) => destination.href)

    assert.deepEqual(hrefs, ['/', '/revision'])
  })
})
