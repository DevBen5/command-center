import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#core/auth/models/user'
import UserCapability from '#core/auth/models/user_capability'
import UserInvitation from '#core/auth/models/user_invitation'
import Role from '#core/auth/models/role'
import invitationService from '#core/auth/services/invitation_service'
import { createAdmin, createUserWith } from '#tests/helpers/users'

test.group('Core / administration des comptes', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('crée un compte sans jamais poser de mot de passe choisi', async ({ client, assert }) => {
    const admin = await createAdmin()

    const response = await client
      .post('/admin/users')
      .json({ fullName: 'Nouvelle Personne', email: 'nouvelle@example.com' })
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const cree = await User.findByOrFail('email', 'nouvelle@example.com')
    assert.isFalse(cree.isAdmin)
    assert.isTrue(cree.isActive)
    assert.isNull(cree.roleId)

    // ⚠️ Le compte naît avec un secret inutilisable, et une invitation l'attend. Aucun mot
    // de passe n'a été saisi, aucun n'a été rendu : le corps de la réponse est une
    // redirection, et il ne contient rien à recopier.
    const invitation = await UserInvitation.findByOrFail('user_id', cree.id)
    assert.isTrue(invitation.isPending)
    assert.notInclude(response.text(), invitation.tokenHash)
  })

  test('le lien d’invitation ne s’obtient que par un appel explicite', async ({
    client,
    assert,
  }) => {
    const admin = await createAdmin()
    const cible = await createUserWith([])

    // La fiche ne porte pas le lien : elle dit qu'une invitation existe, rien de plus.
    const fiche = await client.get(`/admin/users/${cible.id}`).loginAs(admin).withInertia()
    fiche.assertStatus(200)
    assert.notProperty(fiche.inertiaProps as Record<string, any>, 'invitationUrl')

    const emission = await client
      .post(`/admin/users/${cible.id}/invitation`)
      .loginAs(admin)
      .withCsrfToken()

    emission.assertStatus(200)
    const { path } = emission.body() as { path: string }
    assert.match(path, /^\/invitation\/[0-9a-f]{64}$/)
  })

  test('émettre un lien révoque le précédent', async ({ client, assert }) => {
    const admin = await createAdmin()
    const cible = await createUserWith([])

    const premier = await client
      .post(`/admin/users/${cible.id}/invitation`)
      .loginAs(admin)
      .withCsrfToken()
    const second = await client
      .post(`/admin/users/${cible.id}/invitation`)
      .loginAs(admin)
      .withCsrfToken()

    const cheminPremier = (premier.body() as { path: string }).path
    const cheminSecond = (second.body() as { path: string }).path
    assert.notEqual(cheminPremier, cheminSecond)

    // ⚠️ Sans la révocation, « je regénère parce que j'ai un doute sur le premier lien »
    // ne fermerait rien du tout : les deux resteraient valides.
    const ancien = await client.get(cheminPremier).withInertia()
    assert.isFalse((ancien.inertiaProps as Record<string, any>).valid)

    const nouveau = await client.get(cheminSecond).withInertia()
    assert.isTrue((nouveau.inertiaProps as Record<string, any>).valid)
  })

  test('désactive un compte, et refuse de se désactiver soi-même', async ({ client, assert }) => {
    const admin = await createAdmin()
    const cible = await createUserWith(['dashboard.view'])

    const ok = await client
      .post(`/admin/users/${cible.id}/activation`)
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)
    ok.assertStatus(302)
    await cible.refresh()
    assert.isFalse(cible.isActive)

    // ⚠️ Se désactiver soi-même est un verrouillage sans retour : plus personne ne pourrait
    // rouvrir le compte depuis l'application.
    const refus = await client
      .post(`/admin/users/${admin.id}/activation`)
      .loginAs(admin)
      .withCsrfToken()
    refus.assertStatus(400)
    await admin.refresh()
    assert.isTrue(admin.isActive)
  })

  test('refuse qu’un administrateur se retire son propre droit', async ({ client, assert }) => {
    const admin = await createAdmin()

    const response = await client
      .put(`/admin/users/${admin.id}`)
      .json({ fullName: 'Administrateur Test', isAdmin: false })
      .loginAs(admin)
      .withCsrfToken()

    response.assertStatus(400)
    await admin.refresh()
    assert.isTrue(admin.isAdmin)
  })

  test('supprime un compte qui n’a jamais servi', async ({ client, assert }) => {
    const admin = await createAdmin()
    const jamaisServi = await createUserWith(['leitner.view'])
    await invitationService.issueFor(jamaisServi)

    const response = await client
      .delete(`/admin/users/${jamaisServi.id}`)
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.isNull(await User.find(jamaisServi.id))
    // Les lignes rattachées partent avec, par leur ON DELETE CASCADE.
    assert.lengthOf(await UserInvitation.query().where('user_id', jamaisServi.id), 0)
  })

  test('supprime un compte qui a servi ; ses capacités et invitations partent avec lui', async ({
    client,
    assert,
  }) => {
    // ⚠️ Le cœur de CC-80 : un compte **utilisé** se supprime désormais. Aucune table de
    // contenu ne porte de `user_id` — seules `user_capabilities` et `user_invitations` le
    // référencent, en `ON DELETE CASCADE`. La suppression n'emporte que ses données perso.
    const admin = await createAdmin()
    const aServi = await createUserWith(['leitner.view'])
    const token = await invitationService.issueFor(aServi)

    await client
      .post(`/invitation/${token}`)
      .form({ password: 'motdepasse-long-1', password_confirmation: 'motdepasse-long-1' })
      .withCsrfToken()
      .redirects(0)

    // Une surcharge personnelle, pour prouver que `user_capabilities` part bien en cascade —
    // et pas seulement l'invitation.
    await UserCapability.create({ userId: aServi.id, capability: 'leitner.view', granted: true })

    const response = await client
      .delete(`/admin/users/${aServi.id}`)
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.isNull(await User.find(aServi.id))
    assert.lengthOf(await UserCapability.query().where('user_id', aServi.id), 0)
    assert.lengthOf(await UserInvitation.query().where('user_id', aServi.id), 0)
  })

  test('supprime un compte sans aucune invitation', async ({ client, assert }) => {
    // ⚠️ Le compte propriétaire, créé sans invitation (écran d'installation depuis CC-138,
    // seeder avant lui) : l'ancien critère « jamais servi » le refusait. Désormais supprimable —
    // tant qu'il n'est ni soi-même ni le dernier administrateur actif. Ici, un non-admin sans
    // invitation.
    const admin = await createAdmin()
    const seede = await createUserWith(['leitner.view'])

    const response = await client
      .delete(`/admin/users/${seede.id}`)
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.isNull(await User.find(seede.id))
  })

  test('refuse de supprimer le dernier administrateur actif', async ({ client, assert }) => {
    // ⚠️ Verrouillage sans retour : plus aucun admin actif = administration fermée, réparable
    // seulement en SQL. Vérifié AVANT « pas soi-même » — c'est l'invariant le plus fort, et le
    // seul cas où il mord est l'unique admin qui tente de se supprimer.
    const seul = await createAdmin()

    const response = await client
      .delete(`/admin/users/${seul.id}`)
      .accept('json')
      .loginAs(seul)
      .withCsrfToken()

    response.assertStatus(400)
    assert.include((response.body() as { error: string }).error, 'administrateur')
    assert.isNotNull(await User.find(seul.id))
  })

  test('refuse de se supprimer soi-même quand un autre admin existe', async ({
    client,
    assert,
  }) => {
    // Deux admins : le garde « dernier admin » passe (l'autre reste), donc c'est bien le
    // verrou « pas soi-même » qui ferme — un verrouillage sans retour comme la désactivation.
    const admin = await createAdmin()
    await createAdmin()

    const response = await client
      .delete(`/admin/users/${admin.id}`)
      .accept('json')
      .loginAs(admin)
      .withCsrfToken()

    response.assertStatus(400)
    assert.include((response.body() as { error: string }).error, 'propre compte')
    assert.isNotNull(await User.find(admin.id))
  })

  test('supprime un autre administrateur tant qu’il en reste un actif', async ({
    client,
    assert,
  }) => {
    // Un admin peut en supprimer un autre : le garde ne mord que sur le **dernier** actif.
    const admin = await createAdmin()
    const autre = await createAdmin()

    const response = await client
      .delete(`/admin/users/${autre.id}`)
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.isNull(await User.find(autre.id))
    assert.isNotNull(await User.find(admin.id))
  })

  test('la suppression est refusée à un non-admin', async ({ client, assert }) => {
    const lecteur = await createUserWith(['dashboard.view'])
    const cible = await createUserWith([])
    await invitationService.issueFor(cible)

    const response = await client
      .delete(`/admin/users/${cible.id}`)
      .loginAs(lecteur)
      .withCsrfToken()

    response.assertStatus(403)
    assert.isNotNull(await User.find(cible.id))
  })

  test('un isAdmin absent est refusé, pas interprété comme « non »', async ({ client, assert }) => {
    // ⚠️ Le contrôleur remplace l'état complet : sans ce refus, un appel partiel — un script,
    // un futur écran qui ne toucherait qu'au nom — dégraderait un administrateur en silence.
    const admin = await createAdmin()
    const autre = await createAdmin()

    const response = await client
      .put(`/admin/users/${autre.id}`)
      .accept('json')
      .json({ fullName: 'Renommé' })
      .loginAs(admin)
      .withCsrfToken()

    response.assertStatus(422)
    await autre.refresh()
    assert.isTrue(autre.isAdmin)
  })

  test('refuse une surcharge sur une capacité qui n’existe dans aucun module', async ({
    client,
  }) => {
    const admin = await createAdmin()
    const cible = await createUserWith([])

    // ⚠️ Sans ce refus, la ligne existerait en base et n'ouvrirait jamais rien : le droit
    // paraîtrait accordé et ne le serait pas.
    const response = await client
      .put(`/admin/users/${cible.id}/capabilities`)
      .accept('json')
      .json({ overrides: [{ capability: 'leitner.reviw', granted: true }] })
      .loginAs(admin)
      .withCsrfToken()

    response.assertStatus(422)
  })

  test('un rôle ne peut pas porter une capacité inconnue', async ({ client }) => {
    const admin = await createAdmin()

    const response = await client
      .post('/admin/roles')
      .accept('json')
      .json({ name: 'Bancal', capabilities: ['leitner.inexistant'] })
      .loginAs(admin)
      .withCsrfToken()

    response.assertStatus(422)
  })

  test('crée un rôle et l’affecte à un compte', async ({ client, assert }) => {
    const admin = await createAdmin()

    const creation = await client
      .post('/admin/roles')
      .json({ name: 'Relecteur', capabilities: ['leitner.view', 'veille.view'] })
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)
    creation.assertStatus(302)

    const role = await Role.findByOrFail('name', 'Relecteur')
    const cible = await createUserWith([])

    const affectation = await client
      .put(`/admin/users/${cible.id}`)
      .json({ fullName: 'Utilisateur Test', roleId: role.id, isAdmin: false })
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)
    affectation.assertStatus(302)

    await cible.refresh()
    assert.equal(cible.roleId, role.id)

    const acces = await client.get('/revision').loginAs(cible)
    acces.assertStatus(200)
  })
})
