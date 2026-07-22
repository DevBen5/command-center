import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import UserInvitation from '#core/auth/models/user_invitation'
import invitationService from '#core/auth/services/invitation_service'
import { createUserWith } from '#tests/helpers/users'

test.group('Auth / invitation', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('un jeton valide permet de poser son mot de passe et connecte', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['dashboard.view'])
    const token = await invitationService.issueFor(user)

    const response = await client
      .post(`/invitation/${token}`)
      .form({ password: 'motdepasse-long-1', password_confirmation: 'motdepasse-long-1' })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/')

    const invitation = await UserInvitation.findByOrFail('user_id', user.id)
    assert.isNotNull(invitation.usedAt)

    // Le mot de passe posé fonctionne réellement.
    const connexion = await client
      .post('/login')
      .form({ email: user.email, password: 'motdepasse-long-1' })
      .withCsrfToken()
      .redirects(0)
    connexion.assertHeader('location', '/')
  })

  test('un jeton ne sert qu’une fois', async ({ client, assert }) => {
    const user = await createUserWith(['dashboard.view'])
    const token = await invitationService.issueFor(user)

    const premier = await client
      .post(`/invitation/${token}`)
      .form({ password: 'motdepasse-long-1', password_confirmation: 'motdepasse-long-1' })
      .withCsrfToken()
      .redirects(0)
    premier.assertStatus(302)

    const page = await client.get(`/invitation/${token}`).withInertia()
    page.assertStatus(200)
    assert.isFalse((page.inertiaProps as Record<string, any>).valid)
  })

  test('un jeton expiré ne vaut rien', async ({ client, assert }) => {
    const user = await createUserWith(['dashboard.view'])
    const token = await invitationService.issueFor(user)

    const invitation = await UserInvitation.findByOrFail('user_id', user.id)
    invitation.expiresAt = DateTime.now().minus({ minutes: 1 })
    await invitation.save()

    const page = await client.get(`/invitation/${token}`).withInertia()
    assert.isFalse((page.inertiaProps as Record<string, any>).valid)
  })

  test('un jeton inventé rend la même page qu’un jeton consommé', async ({ client, assert }) => {
    // ⚠️ La réponse ne distingue pas « inexistant », « expiré » et « déjà utilisé » : elle
    // n'apprend donc rien à qui essaierait des liens au hasard.
    const page = await client.get(`/invitation/${'0'.repeat(64)}`).withInertia()
    assert.isFalse((page.inertiaProps as Record<string, any>).valid)
  })

  test('le jeton n’est pas stocké en clair', async ({ assert }) => {
    const user = await createUserWith(['dashboard.view'])
    const token = await invitationService.issueFor(user)

    const invitation = await UserInvitation.findByOrFail('user_id', user.id)
    assert.notEqual(invitation.tokenHash, token)
    assert.lengthOf(invitation.tokenHash, 64)
  })

  test('un compte désactivé ne se réveille pas par un lien resté en boîte mail', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['dashboard.view'])
    const token = await invitationService.issueFor(user)
    user.isActive = false
    await user.save()

    const response = await client
      .post(`/invitation/${token}`)
      .form({ password: 'motdepasse-long-1', password_confirmation: 'motdepasse-long-1' })
      .header('referrer', `/invitation/${token}`)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const invitation = await UserInvitation.findByOrFail('user_id', user.id)
    assert.isNull(invitation.usedAt)
  })

  test('refuse un mot de passe trop court', async ({ client }) => {
    const user = await createUserWith(['dashboard.view'])
    const token = await invitationService.issueFor(user)

    const response = await client
      .post(`/invitation/${token}`)
      .accept('json')
      .json({ password: 'court', password_confirmation: 'court' })
      .withCsrfToken()

    response.assertStatus(422)
  })
})
