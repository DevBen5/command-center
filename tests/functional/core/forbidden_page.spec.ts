import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { createUserWith, createUserWithoutAccess } from '#tests/helpers/users'

/**
 * Le refus, rendu.
 *
 * ⚠️ **Ce que ces tests verrouillent n'est pas le code HTTP, c'est le corps.** Un 403 restait un
 * 403 avant CC-81 : ce qui manquait, c'est qu'il rende `{"error":"Accès refusé."}` à un
 * navigateur. Un test qui n'asserterait que le statut resterait vert si le correctif redevenait
 * inerte — et il peut le redevenir sans bruit, il suffit qu'un middleware refuse par
 * `response.forbidden()` au lieu de lever : `statusPages` n'est consulté que sur exception.
 */
test.group('Core / page 403', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('un refus rend la page pour une navigation de navigateur', async ({ client, assert }) => {
    const user = await createUserWithoutAccess()

    // Le cas réel : un signet, un lien partagé — une navigation directe, pas un appel Inertia.
    const response = await client.get('/').loginAs(user).header('accept', 'text/html')

    response.assertStatus(403)
    // La page est servie par la racine Inertia : son nom de composant voyage dans `data-page`.
    assert.include(response.text(), 'core/shared/errors/forbidden')
    assert.notInclude(response.text(), '"error":"Accès refusé."')
  })

  test('un refus reste du JSON pour un appel qui ne demande pas de HTML', async ({
    client,
    assert,
  }) => {
    // ⚠️ **L'ordre de la négociation est l'invariant** : un client qui accepte tout sans
    // préférence doit recevoir du JSON. Inversé, les routes JSON du module Leitner recevraient
    // une page HTML et casseraient la page appelante au lieu de dire non.
    const user = await createUserWithoutAccess()

    const response = await client.get('/').loginAs(user)

    response.assertStatus(403)
    assert.property(response.body(), 'error')
  })

  test('un refus explicitement JSON rend un corps JSON', async ({ client, assert }) => {
    const user = await createUserWithoutAccess()

    const response = await client.get('/').loginAs(user).accept('json')

    response.assertStatus(403)
    assert.property(response.body(), 'error')
  })

  test('le refus d’une route réservée aux administrateurs rend la même page', async ({
    client,
    assert,
  }) => {
    // ⚠️ Trois middlewares refusent (`can`, `admin`, le garde-barrière) : corriger le premier
    // seul aurait laissé Services et Agents rendre du JSON brut.
    const user = await createUserWith(['dashboard.view'])

    const response = await client.get('/services').loginAs(user).header('accept', 'text/html')

    response.assertStatus(403)
    assert.include(response.text(), 'core/shared/errors/forbidden')
  })

  test('un refus sur une visite Inertia reste une réponse Inertia', async ({ client }) => {
    // ⚠️ **Le cas qu'on ne voit pas en tapant l'URL** : un clic interne est une requête XHR
    // portant `x-inertia`. Si la réponse ne portait pas l'en-tête en retour, le client Inertia
    // la traiterait comme une réponse étrangère et afficherait sa modale d'erreur au lieu de la
    // page — un refus resterait illisible, exactement le défaut qu'on corrige, mais seulement
    // pour les liens internes.
    const user = await createUserWithoutAccess()

    const response = await client.get('/').loginAs(user).withInertia()

    response.assertStatus(403)
    response.assertInertiaComponent('core/shared/errors/forbidden')
  })

  test('la page ne nomme jamais la capacité manquante', async ({ client, assert }) => {
    // Nommer le droit refusé décrirait le découpage interne de l'application à quelqu'un qui
    // n'y a précisément pas accès.
    const user = await createUserWithoutAccess()

    const response = await client.get('/revision').loginAs(user).header('accept', 'text/html')

    assert.notInclude(response.text(), 'leitner.view')
  })
})
