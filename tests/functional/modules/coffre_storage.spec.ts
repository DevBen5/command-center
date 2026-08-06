import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { createUserWith } from '#tests/helpers/users'
import { createVault, unlockedSession } from '#tests/helpers/coffre'

/**
 * Le chiffrement au repos, vu depuis la BASE (CC-178).
 *
 * ⚠️ **C'est le point de validation qu'un test rend faussement vert.** « On relit bien ce qu'on a
 * écrit » réussirait à l'identique sans le moindre chiffrement : le contrôleur écrirait en clair,
 * relirait en clair, et la suite serait verte. La seule chose qui prouve quelque chose est de
 * regarder ce que Postgres porte réellement — d'où le SQL brut ci-dessous, qui ne passe ni par le
 * modèle Lucid ni par le service.
 */
const SECRET = 'code-du-coffre-fort-42'
const TITRE = 'Banque en ligne'

test.group('Coffre / ce que la base porte vraiment', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('ni le contenu ni le TITRE ne sont lisibles dans les colonnes', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view', 'coffre.write'])
    const vault = await createVault(user)

    const ecriture = await client
      .post('/coffre')
      .form({ type: 'note', title: TITRE, content: SECRET })
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))
      .withCsrfToken()
      .redirects(0)

    ecriture.assertStatus(302)

    const lignes = await db.rawQuery(
      'select type, title_cipher, content_cipher from coffre_entries where owner_id = ?',
      [user.id]
    )

    assert.lengthOf(lignes.rows, 1, 'l’entrée n’a pas été écrite — le reste ne prouve rien')

    const [ligne] = lignes.rows

    // ⚠️ **Le titre autant que le contenu.** Un titre en clair (« Banque en ligne ») dit
    // l'essentiel de ce que le coffre protège, et partirait tel quel dans chaque dump — donc
    // vers `BACKUP_MIRROR_DIR`, où ils voyagent en clair par décision assumée du dépôt.
    assert.notInclude(ligne.content_cipher, SECRET)
    assert.notInclude(ligne.title_cipher, TITRE)

    // Et pas davantage sous un encodage qui n'est pas un chiffrement.
    assert.notInclude(ligne.content_cipher, Buffer.from(SECRET).toString('base64'))
    assert.notInclude(ligne.title_cipher, Buffer.from(TITRE).toString('base64'))

    // `type`, lui, reste en clair : c'est une étiquette technique, pas du contenu — et elle est
    // sous contrainte CHECK, donc elle ne pourrait pas être chiffrée sans mentir sur sa nature.
    assert.equal(ligne.type, 'note')
  })

  test('la même entrée redevient lisible par la page qui la relit', async ({ client, assert }) => {
    // ⚠️ Le pendant du test ci-dessus, et il ne se suffit pas à lui-même : sans le précédent,
    // celui-ci passerait au vert sur un module qui ne chiffre rien du tout.
    const user = await createUserWith(['coffre.view', 'coffre.write'])
    const vault = await createVault(user)
    const session = await unlockedSession(user, vault)

    await client
      .post('/coffre')
      .form({ type: 'url', title: TITRE, content: 'https://exemple.fr/banque' })
      .loginAs(user)
      .withSession(session)
      .withCsrfToken()
      .redirects(0)

    const lecture = await client.get('/coffre').loginAs(user).withSession(session).withInertia()

    lecture.assertStatus(200)
    const props = lecture.inertiaProps as { entries: Array<Record<string, unknown>> }

    assert.lengthOf(props.entries, 1)
    assert.equal(props.entries[0].title, TITRE)
    assert.equal(props.entries[0].content, 'https://exemple.fr/banque')
    assert.equal(props.entries[0].type, 'url')

    // ⚠️ Le chiffré ne descend JAMAIS jusqu'au navigateur : `serializeAs: null` sur les deux
    // colonnes. Le laisser voyager n'ouvrirait rien, mais inviterait à le traiter comme une
    // donnée ordinaire — même raisonnement que `dedup_key` en veille (CC-111).
    assert.notProperty(props.entries[0], 'titleCipher')
    assert.notProperty(props.entries[0], 'contentCipher')
  })

  test('éditer une entrée REMPLACE le chiffré en base, l’ancienne valeur n’y reste plus', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view', 'coffre.write'])
    const vault = await createVault(user)
    const session = await unlockedSession(user, vault)

    await client
      .post('/coffre')
      .form({ type: 'note', title: TITRE, content: SECRET })
      .loginAs(user)
      .withSession(session)
      .withCsrfToken()
      .redirects(0)

    const avant = await db.rawQuery(
      'select id, content_cipher from coffre_entries where owner_id = ?',
      [user.id]
    )
    const [ligneAvant] = avant.rows
    const nouveauContenu = 'un contenu tout différent'

    const edition = await client
      .put(`/coffre/${ligneAvant.id}`)
      .form({ title: TITRE, content: nouveauContenu })
      .loginAs(user)
      .withSession(session)
      .withCsrfToken()
      .redirects(0)

    edition.assertStatus(302)

    const apres = await db.rawQuery(
      'select id, content_cipher from coffre_entries where owner_id = ?',
      [user.id]
    )

    // ⚠️ Une seule ligne, la MÊME : sinon l'édition aurait créé une entrée au lieu de remplacer
    // la sienne, et l'ancienne valeur resterait déchiffrable depuis la ligne orpheline.
    assert.lengthOf(apres.rows, 1, 'l’édition a créé une ligne au lieu de remplacer la sienne')
    assert.equal(apres.rows[0].id, ligneAvant.id, 'l’édition doit toucher la MÊME ligne')
    assert.notEqual(
      apres.rows[0].content_cipher,
      ligneAvant.content_cipher,
      'le chiffré n’a pas changé — l’édition n’a rien écrit'
    )
    assert.notInclude(apres.rows[0].content_cipher, nouveauContenu)

    const lecture = await client.get('/coffre').loginAs(user).withSession(session).withInertia()
    const props = lecture.inertiaProps as { entries: Array<Record<string, unknown>> }
    assert.equal(props.entries[0].content, nouveauContenu)
  })

  test('poster un `type` en éditant est sans effet — il n’est même pas dans le schéma validé', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view', 'coffre.write'])
    const vault = await createVault(user)
    const session = await unlockedSession(user, vault)

    await client
      .post('/coffre')
      .form({ type: 'note', title: TITRE, content: SECRET })
      .loginAs(user)
      .withSession(session)
      .withCsrfToken()
      .redirects(0)

    const lignes = await db.rawQuery('select id from coffre_entries where owner_id = ?', [user.id])
    const id = lignes.rows[0].id as number

    // ⚠️ Le `type` n'existe pas dans `entryUpdateValidator` : VineJS le rejette de l'objet validé
    // sans lever, donc `updateEntry` ne le voit jamais. On le poste quand même, en même temps
    // qu'un mot de passe, pour vérifier que RIEN de tout ça n'atteint la ligne.
    await client
      .put(`/coffre/${id}`)
      .form({ type: 'credential', title: TITRE, content: 'nouveau contenu', password: 'x' })
      .loginAs(user)
      .withSession(session)
      .withCsrfToken()
      .redirects(0)

    const apres = await db.rawQuery('select type, secret_cipher from coffre_entries where id = ?', [
      id,
    ])
    assert.equal(apres.rows[0].type, 'note')
    assert.isNull(apres.rows[0].secret_cipher)
  })

  test('une entrée n’appartient qu’à son compte, à l’édition aussi', async ({ client, assert }) => {
    const proprietaire = await createUserWith(['coffre.view', 'coffre.write'])
    const vaultProprietaire = await createVault(proprietaire)
    const session = await unlockedSession(proprietaire, vaultProprietaire)

    await client
      .post('/coffre')
      .form({ type: 'note', title: TITRE, content: SECRET })
      .loginAs(proprietaire)
      .withSession(session)
      .withCsrfToken()
      .redirects(0)

    const posees = await db.rawQuery(
      'select id, content_cipher from coffre_entries where owner_id = ?',
      [proprietaire.id]
    )
    const [entree] = posees.rows

    const autre = await createUserWith(['coffre.view', 'coffre.write'])
    const vaultAutre = await createVault(autre)

    await client
      .put(`/coffre/${entree.id}`)
      .form({ title: 'Détourné', content: 'Détourné aussi' })
      .loginAs(autre)
      .withSession(await unlockedSession(autre, vaultAutre))
      .withCsrfToken()
      .redirects(0)

    // ⚠️ Comme la suppression : 302 dans les deux cas, jamais un oracle d'existence. On vérifie
    // donc en BASE que rien n'a bougé sur l'entrée d'un autre compte.
    const apres = await db.rawQuery('select content_cipher from coffre_entries where id = ?', [
      entree.id,
    ])
    assert.equal(apres.rows[0].content_cipher, entree.content_cipher)
  })

  test('une entrée n’appartient qu’à son compte, en lecture comme à la suppression', async ({
    client,
    assert,
  }) => {
    const proprietaire = await createUserWith(['coffre.view', 'coffre.write'])
    const vaultProprietaire = await createVault(proprietaire)

    await client
      .post('/coffre')
      .form({ type: 'note', title: TITRE, content: SECRET })
      .loginAs(proprietaire)
      .withSession(await unlockedSession(proprietaire, vaultProprietaire))
      .withCsrfToken()
      .redirects(0)

    const posees = await db.rawQuery('select id from coffre_entries where owner_id = ?', [
      proprietaire.id,
    ])
    const [entree] = posees.rows

    // Un second compte, son propre coffre ouvert : il ne voit rien, et ne peut rien supprimer.
    const autre = await createUserWith(['coffre.view', 'coffre.write'])
    const vaultAutre = await createVault(autre)
    const sessionAutre = await unlockedSession(autre, vaultAutre)

    const lecture = await client
      .get('/coffre')
      .loginAs(autre)
      .withSession(sessionAutre)
      .withInertia()
    assert.lengthOf((lecture.inertiaProps as { entries: unknown[] }).entries, 0)

    await client
      .delete(`/coffre/${entree.id}`)
      .loginAs(autre)
      .withSession(sessionAutre)
      .withCsrfToken()
      .redirects(0)

    // ⚠️ La suppression rend 302 dans les deux cas — elle ne dit pas si elle a trouvé quelque
    // chose, pour ne pas faire un oracle d'existence d'un identifiant deviné. C'est donc la BASE
    // qu'on interroge, jamais le code de réponse.
    const restantes = await db.rawQuery('select id from coffre_entries where id = ?', [entree.id])
    assert.lengthOf(restantes.rows, 1, 'l’entrée d’un autre compte a été supprimée')
  })

  test('son propriétaire, lui, la supprime', async ({ client, assert }) => {
    const user = await createUserWith(['coffre.view', 'coffre.write'])
    const vault = await createVault(user)
    const session = await unlockedSession(user, vault)

    await client
      .post('/coffre')
      .form({ type: 'note', title: TITRE, content: SECRET })
      .loginAs(user)
      .withSession(session)
      .withCsrfToken()
      .redirects(0)

    const posees = await db.rawQuery('select id from coffre_entries where owner_id = ?', [user.id])
    const [entree] = posees.rows

    await client
      .delete(`/coffre/${entree.id}`)
      .loginAs(user)
      .withSession(session)
      .withCsrfToken()
      .redirects(0)

    const restantes = await db.rawQuery('select id from coffre_entries where id = ?', [entree.id])
    assert.lengthOf(restantes.rows, 0)
  })
})
