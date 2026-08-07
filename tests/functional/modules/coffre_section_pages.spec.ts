import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { createUserWith } from '#tests/helpers/users'
import { createVault, createMedia, unlockedSession, PASSPHRASE } from '#tests/helpers/coffre'
import CoffreEntry from '#modules/coffre/models/coffre_entry'
import { deriveKey } from '#modules/coffre/services/vault_crypto'

/**
 * Les pages de section (CC-208) : `GET /coffre/<section>` ne rend que les entrées de la nature
 * demandée — et seulement celles-là. Le mur (`middleware.can`/`coffreOuvert`) est prouvé dans
 * `coffre_wall.spec.ts`, ce fichier ne le reprouve pas.
 */
test.group('Coffre / les pages de section', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('chaque page de section ne rend que les entrées de sa nature, et seulement celles-là', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view', 'coffre.write'])
    const vault = await createVault(user)
    const session = await unlockedSession(user, vault)
    const key = deriveKey(PASSPHRASE, vault.kdfSalt)

    await client
      .post('/coffre')
      .form({ type: 'note', title: 'Une note', content: 'Contenu' })
      .loginAs(user)
      .withSession(session)
      .withCsrfToken()
    await client
      .post('/coffre')
      .form({ type: 'url', title: 'Un lien', content: 'https://exemple.fr' })
      .loginAs(user)
      .withSession(session)
      .withCsrfToken()
    await client
      .post('/coffre')
      .form({
        type: 'credential',
        title: 'Un identifiant',
        content: 'utilisateur',
        password: 'secret',
      })
      .loginAs(user)
      .withSession(session)
      .withCsrfToken()
    await client
      .post('/coffre')
      .form({ type: 'note', title: 'Une photo', content: 'Contenu' })
      .loginAs(user)
      .withSession(session)
      .withCsrfToken()

    // ⚠️ La dernière entrée porte un média : elle bascule en section Photos, PAS Notes, malgré
    // son `type: 'note'` déclaré (CC-204 — le média prime sur le type). C'est le cas qui prouve
    // que le filtre passe bien par `groupEntriesByNature`, pas par une requête `where('type', …)`.
    const entreePhoto = await CoffreEntry.query()
      .where('owner_id', user.id)
      .where('type', 'note')
      .orderBy('id', 'desc')
      .firstOrFail()
    await createMedia(entreePhoto.id, user.id, key)

    const notes = await client.get('/coffre/notes').loginAs(user).withSession(session).withInertia()
    notes.assertStatus(200)
    notes.assertInertiaComponent('modules/coffre/section')
    const notesProps = notes.inertiaProps as { section: string; entries: Array<{ title: string }> }
    assert.equal(notesProps.section, 'note')
    assert.lengthOf(notesProps.entries, 1)
    assert.equal(notesProps.entries[0].title, 'Une note')

    const liens = await client.get('/coffre/liens').loginAs(user).withSession(session).withInertia()
    const liensProps = liens.inertiaProps as { section: string; entries: Array<{ title: string }> }
    assert.equal(liensProps.section, 'url')
    assert.lengthOf(liensProps.entries, 1)
    assert.equal(liensProps.entries[0].title, 'Un lien')

    const identifiants = await client
      .get('/coffre/identifiants')
      .loginAs(user)
      .withSession(session)
      .withInertia()
    const identifiantsProps = identifiants.inertiaProps as {
      section: string
      entries: Array<{ title: string }>
    }
    assert.equal(identifiantsProps.section, 'credential')
    assert.lengthOf(identifiantsProps.entries, 1)
    assert.equal(identifiantsProps.entries[0].title, 'Un identifiant')

    const photos = await client
      .get('/coffre/photos')
      .loginAs(user)
      .withSession(session)
      .withInertia()
    const photosProps = photos.inertiaProps as {
      section: string
      entries: Array<{ title: string }>
    }
    assert.equal(photosProps.section, 'photo')
    assert.lengthOf(photosProps.entries, 1)
    assert.equal(photosProps.entries[0].title, 'Une photo')
  })

  test('une section sans entrée rend une liste vide, pas une erreur', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)

    const response = await client
      .get('/coffre/photos')
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))
      .withInertia()

    response.assertStatus(200)
    const props = response.inertiaProps as { entries: unknown[] }
    assert.lengthOf(props.entries, 0)
  })

  test('un segment de section inconnu répond 404', async ({ client }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)

    const response = await client
      .get('/coffre/inconnu')
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))
      .redirects(0)

    response.assertStatus(404)
  })
})

/**
 * `redirect().back()` sur `store`/`update`/`destroy` (CC-208) — remplace le `/coffre` en dur
 * d'avant ce lot : ajouter/éditer/supprimer depuis une page de section doit y ramener, pas
 * renvoyer systématiquement à l'accueil. Groupe séparé du précédent : ce n'est pas le filtrage
 * par section qui est en jeu ici, mais où le serveur renvoie après une écriture.
 */
test.group('Coffre / le retour après écriture reste sur la page d’origine', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('ajouter depuis une page de section y ramène, pas à l’accueil', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view', 'coffre.write'])
    const vault = await createVault(user)

    const response = await client
      .post('/coffre')
      .form({ type: 'note', title: 'Une note', content: 'Contenu' })
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))
      .withCsrfToken()
      .header('referrer', '/coffre/notes')
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.headers()['location'], '/coffre/notes')
  })

  test('ajouter depuis l’accueil y reste — comportement inchangé, seul cas avant ce lot', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view', 'coffre.write'])
    const vault = await createVault(user)

    const response = await client
      .post('/coffre')
      .form({ type: 'note', title: 'Une note', content: 'Contenu' })
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))
      .withCsrfToken()
      .header('referrer', '/coffre')
      .redirects(0)

    response.assertStatus(302)
    assert.equal(response.headers()['location'], '/coffre')
  })
})
