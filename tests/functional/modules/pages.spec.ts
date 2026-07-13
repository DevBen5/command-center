import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#core/auth/models/user'

const PAGES: Array<{ route: string; component: string }> = [
  { route: '/', component: 'core/dashboard/home' },
  { route: '/services', component: 'modules/services/index' },
  { route: '/agents', component: 'modules/agents/index' },
  { route: '/veille', component: 'modules/veille/index' },
  { route: '/revision', component: 'modules/leitner/index' },
  { route: '/revision/settings', component: 'modules/leitner/settings' },
]

test.group('Modules / accès authentifié', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  for (const { route, component } of PAGES) {
    test(`GET ${route} rend le composant ${component}`, async ({ client }) => {
      const user = await User.create({
        fullName: 'Utilisateur Test',
        email: 'test@example.com',
        password: 'secret123',
      })

      const response = await client.get(route).loginAs(user).withInertia()

      response.assertStatus(200)
      response.assertInertiaComponent(component)
    })
  }
})
