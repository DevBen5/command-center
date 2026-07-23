import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import type User from '#core/auth/models/user'
import invitationService from '#core/auth/services/invitation_service'
import { createAdmin, createUserWith, createUserWithoutAccess } from '#tests/helpers/users'

/**
 * L'atterrissage : **où arrive un compte qui n'a demandé aucune page**.
 *
 * ⚠️ Les trois portes de l'application redirigeaient vers `/` en dur, une route qui exige
 * `dashboard.view`. Un collègue sans cette capacité recevait donc `{"error":"Accès refusé."}`
 * comme tout premier écran, juste après avoir choisi son mot de passe (CC-81). Ces tests
 * couvrent les trois portes, parce que corriger la première seule laissait les deux autres.
 */
test.group('Core / atterrissage', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  /** La connexion par le formulaire, sans suivre la redirection. */
  function login(client: any, user: User) {
    return client
      .post('/login')
      .form({ email: user.email, password: 'secret123' })
      .withCsrfToken()
      .redirects(0)
  }

  test('la connexion mène à la première destination ouvrable', async ({ client }) => {
    const accueil = await login(client, await createUserWith(['dashboard.view']))
    accueil.assertHeader('location', '/')

    // Sans `dashboard.view`, l'accueil est sauté — c'est exactement le compte de CC-72 qui
    // recevait un JSON d'erreur.
    const revision = await login(
      client,
      await createUserWith(['leitner.view', 'leitner.stats.view'])
    )
    revision.assertHeader('location', '/revision')

    const veille = await login(client, await createUserWith(['veille.view']))
    veille.assertHeader('location', '/veille')
  })

  test('un compte sans aucun droit atterrit sur l’écran « aucun accès »', async ({ client }) => {
    const nu = await createUserWithoutAccess()

    const response = await login(client, nu)

    response.assertHeader('location', '/aucun-acces')
  })

  test('un administrateur atterrit sur l’accueil', async ({ client }) => {
    // ⚠️ Il ne porte **aucune** capacité, il passe outre. Si l'atterrissage lisait la liste des
    // capacités au lieu du drapeau, l'administrateur tomberait sur « aucun accès ».
    const admin = await createAdmin()

    const response = await login(client, admin)

    response.assertHeader('location', '/')
  })

  test('l’acceptation d’une invitation mène au même endroit', async ({ client }) => {
    // ⚠️ **C'est la porte qui compte le plus** : le tout premier écran d'un collègue, à la
    // seconde où il vient de poser son mot de passe.
    const user = await createUserWith(['leitner.view'])
    const token = await invitationService.issueFor(user)

    const response = await client
      .post(`/invitation/${token}`)
      .form({ password: 'motdepasse-long-1', password_confirmation: 'motdepasse-long-1' })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/revision')
  })

  test('un compte déjà connecté qui rouvre /login ne va pas sur un refus', async ({ client }) => {
    // La troisième porte, et celle que le ticket ne citait pas : `guest_middleware` redirigeait
    // lui aussi vers `/` en dur — un signet vers `/login` suffisait à rejouer le défaut.
    const user = await createUserWith(['leitner.view'])

    const response = await client.get('/login').loginAs(user).redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/revision')
  })

  test('la destination d’atterrissage répond réellement 200', async ({ client }) => {
    // ⚠️ **L'assertion qui compte** : rediriger n'a de sens que si la cible s'ouvre. Une
    // destination dont la capacité aurait divergé de celle de sa route enverrait l'utilisateur
    // droit sur le refus qu'on vient de lui épargner — un 302 vers un 403.
    const user = await createUserWith(['leitner.view', 'leitner.stats.view'])

    const arrivee = await client.get('/revision').loginAs(user)

    arrivee.assertStatus(200)
  })

  test('« aucun accès » renvoie ailleurs quiconque a une destination', async ({ client }) => {
    // Sans cette redirection, un administrateur ouvrant cette URL lirait « aucun accès ne vous
    // a été attribué » alors qu'il a accès à tout : un écran qui ment sur les droits fait
    // chercher la panne ailleurs.
    const admin = await createAdmin()

    const response = await client.get('/aucun-acces').loginAs(admin).redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/')
  })

  test('« aucun accès » s’affiche pour un compte qui n’a réellement rien', async ({ client }) => {
    const nu = await createUserWithoutAccess()

    const response = await client.get('/aucun-acces').loginAs(nu)

    // 200, et surtout pas un 403 : le compte n'est pas refusé, il est vide.
    response.assertStatus(200)
  })

  test('« aucun accès » reste fermé à un visiteur non authentifié', async ({ client }) => {
    const response = await client.get('/aucun-acces').redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/login')
  })
})
