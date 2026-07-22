import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { createAdmin, createUserWith } from '#tests/helpers/users'

/**
 * ⚠️ Chaque page déclare **la capacité qui l'ouvre**, et le compte de test ne porte que
 * celle-là. La facilité serait de tout passer en `isAdmin` — la suite redeviendrait verte
 * d'un coup, mais plus aucune de ces pages ne traverserait la vérification de capacité :
 * on pourrait en déclarer une avec la mauvaise capacité sans que rien ne rougisse.
 */
const PAGES: Array<{ route: string; component: string; capability: string | 'admin' }> = [
  { route: '/', component: 'core/dashboard/home', capability: 'dashboard.view' },
  { route: '/services', component: 'modules/services/index', capability: 'admin' },
  { route: '/agents', component: 'modules/agents/index', capability: 'admin' },
  { route: '/veille', component: 'modules/veille/index', capability: 'veille.view' },
  { route: '/veille/sources', component: 'modules/veille/sources', capability: 'veille.view' },
  { route: '/revision', component: 'modules/leitner/index', capability: 'leitner.view' },
  {
    route: '/revision/settings',
    component: 'modules/leitner/settings',
    capability: 'leitner.cards.read',
  },
  { route: '/revision/stats', component: 'modules/leitner/stats', capability: 'leitner.view' },
  { route: '/revision/ingest', component: 'modules/leitner/ingest', capability: 'leitner.ingest' },
  { route: '/admin/users', component: 'core/auth/admin/users', capability: 'admin' },
  { route: '/admin/roles', component: 'core/auth/admin/roles', capability: 'admin' },
]

test.group('Modules / accès authentifié', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  for (const { route, component, capability } of PAGES) {
    test(`GET ${route} rend le composant ${component}`, async ({ client, assert }) => {
      const user = capability === 'admin' ? await createAdmin() : await createUserWith([capability])

      const response = await client.get(route).loginAs(user).withInertia()

      response.assertStatus(200)
      response.assertInertiaComponent(component)

      // ⚠️ **La prop partagée `user` désigne le compte CONNECTÉ, sur toutes les pages.**
      // `AppLayout` s'en sert pour décider ce que la barre latérale affiche. Une page qui
      // rendrait une prop du même nom l'écraserait, et le layout lirait un objet d'une autre
      // forme — `capabilities` absent, donc `TypeError` au rendu, donc **page blanche**.
      //
      // Ça s'est produit : la fiche d'un compte rendait `user` (la personne affichée). Le bug
      // ne se voyait que sur un compte **non-admin** — pour un admin, `isAdmin` court-circuite
      // avant que `capabilities` ne soit lu — d'où un écran qui marchait sur sa propre fiche
      // et tombait sur celle des autres. Une page qui montre quelqu'un le nomme `account`.
      const props = response.inertiaProps as Record<string, any>
      assert.equal(
        props.user?.email,
        user.email,
        `La prop partagée « user » de ${route} n’est plus le compte connecté : une prop de page ` +
          `du même nom l’a écrasée. Renomme-la (account, profile…).`
      )
      assert.isArray(props.user?.capabilities, `${route} : « user.capabilities » a disparu`)
    })
  }

  test('la fiche d’un autre compte n’écrase pas la prop partagée « user »', async ({
    client,
    assert,
  }) => {
    // La page qui a réellement déclenché le bug, et le seul cas qui le révélait : un
    // administrateur regarde la fiche de quelqu'un **qui n'est pas administrateur**.
    const admin = await createAdmin()
    const autre = await createUserWith(['leitner.view'])

    const response = await client.get(`/admin/users/${autre.id}`).loginAs(admin).withInertia()

    response.assertStatus(200)
    const props = response.inertiaProps as Record<string, any>

    assert.equal(props.user.email, admin.email, 'user = le compte connecté')
    assert.isTrue(props.user.isAdmin)
    assert.isArray(props.user.capabilities)
    // Et la personne affichée vit sous son propre nom.
    assert.equal(props.account.email, autre.email)
    assert.deepEqual(props.account.effective, ['leitner.view'])
  })
})
