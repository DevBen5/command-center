import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import type { SessionData } from '@adonisjs/session/types'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import type User from '#core/auth/models/user'
import vault from '#modules/coffre/services/vault_service'
import { createUserWith } from '#tests/helpers/users'
import { createVault, unlockedSession } from '#tests/helpers/coffre'

/**
 * Les identifiants du coffre (CC-179, lot 2) : **montrer sans exposer**.
 *
 * Le lot porte trois promesses, et elles ne se prouvent pas au même endroit :
 *
 * 1. le mot de passe n'est pas lisible en base → la **colonne brute**, comme au lot 1 ;
 * 2. la charge utile de la **liste** n'en porte aucune trace → la **prop Inertia sérialisée**,
 *    et le **SQL** de la requête de liste ;
 * 3. la révélation passe par le mur → `coffre_wall.spec.ts`, qui lit le routeur.
 *
 * ⚠️ **La deuxième est celle qu'un test rend faussement vert, et il a fallu deux assertions pour
 * la tenir.** Regarder la charge utile ne dit *que* le résultat : deux mécanismes indépendants
 * l'obtiennent — le `select` qui ne charge pas la colonne, et la vue construite champ par champ,
 * qui n'a pas de place pour un secret. Retirer le `select` laisse donc la charge utile propre et
 * la suite verte, alors que le clair vient de transiter par la mémoire du serveur pour rien.
 * C'est la leçon mesurée sur le middleware du mur, transposée : on lit aussi le **SQL**.
 */
const SERVICE = 'Banque en ligne'
const IDENTIFIANT = 'benoit.dupond'
const MOT_DE_PASSE = 'correct-cheval-batterie-agrafe'

/** Pose un identifiant par la route, et rend son id lu en base. */
async function poserIdentifiant(
  client: ApiClient,
  user: User,
  session: SessionData
): Promise<number> {
  const ecriture = await client
    .post('/coffre')
    .form({
      type: 'credential',
      title: SERVICE,
      content: IDENTIFIANT,
      password: MOT_DE_PASSE,
    })
    .loginAs(user)
    .withSession(session)
    .withCsrfToken()
    .redirects(0)

  ecriture.assertStatus(302)

  const lignes = await db.rawQuery('select id from coffre_entries where owner_id = ?', [user.id])

  return lignes.rows[0].id as number
}

test.group('Coffre / les identifiants — ce que la base porte', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('le mot de passe n’est lisible dans aucune colonne', async ({ client, assert }) => {
    const user = await createUserWith(['coffre.view', 'coffre.write'])
    const vaultRow = await createVault(user)
    const session = await unlockedSession(user, vaultRow)

    await poserIdentifiant(client, user, session)

    const lignes = await db.rawQuery(
      'select type, title_cipher, content_cipher, secret_cipher from coffre_entries where owner_id = ?',
      [user.id]
    )

    assert.lengthOf(lignes.rows, 1, 'l’entrée n’a pas été écrite — le reste ne prouve rien')
    const [ligne] = lignes.rows

    assert.equal(ligne.type, 'credential')
    assert.isNotNull(ligne.secret_cipher, 'aucun secret écrit — le test suivant serait vide')

    assert.notInclude(ligne.secret_cipher, MOT_DE_PASSE)
    assert.notInclude(ligne.secret_cipher, Buffer.from(MOT_DE_PASSE).toString('base64'))
    // Et le service comme l'identifiant restent chiffrés, comme au lot 1.
    assert.notInclude(ligne.title_cipher, SERVICE)
    assert.notInclude(ligne.content_cipher, IDENTIFIANT)
  })

  test('un mot de passe posté avec une note n’est PAS enregistré', async ({ client, assert }) => {
    // ⚠️ Le validateur exige le champ sur un identifiant, il n'interdit pas de l'envoyer avec une
    // note : c'est le service qui tranche. Sans ce garde, un chiffré que plus rien ne lit
    // s'attacherait à l'entrée et partirait dans chaque sauvegarde.
    const user = await createUserWith(['coffre.view', 'coffre.write'])
    const vaultRow = await createVault(user)

    await client
      .post('/coffre')
      .form({ type: 'note', title: 'Une note', content: 'Du texte', password: MOT_DE_PASSE })
      .loginAs(user)
      .withSession(await unlockedSession(user, vaultRow))
      .withCsrfToken()
      .redirects(0)

    const lignes = await db.rawQuery(
      'select secret_cipher from coffre_entries where owner_id = ?',
      [user.id]
    )

    assert.lengthOf(lignes.rows, 1)
    assert.isNull(lignes.rows[0].secret_cipher)
  })
})

test.group('Coffre / les identifiants — ce que la liste ne porte pas', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('la charge utile de la liste ne porte aucune trace du mot de passe', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view', 'coffre.write'])
    const vaultRow = await createVault(user)
    const session = await unlockedSession(user, vaultRow)

    await poserIdentifiant(client, user, session)

    const lecture = await client.get('/coffre').loginAs(user).withSession(session).withInertia()

    lecture.assertStatus(200)
    const props = lecture.inertiaProps as { entries: Array<Record<string, unknown>> }

    // ⚠️ Le plancher : sans lui, une liste vide passerait toutes les assertions ci-dessous.
    assert.lengthOf(props.entries, 1)
    assert.equal(props.entries[0].type, 'credential')
    assert.equal(props.entries[0].title, SERVICE)
    assert.equal(props.entries[0].content, IDENTIFIANT)

    // Ni sous une clé, ni ailleurs dans la charge utile — c'est la VALEUR qui ne doit pas voyager.
    assert.notProperty(props.entries[0], 'secret')
    assert.notProperty(props.entries[0], 'password')
    assert.notProperty(props.entries[0], 'secretCipher')
    assert.notInclude(JSON.stringify(props), MOT_DE_PASSE)
  })

  test('⚠️ la requête de liste ne CHARGE même pas la colonne du secret', async ({ assert }) => {
    /**
     * ⚠️ **Le test précédent ne prouve pas ça, et c'est tout l'objet de celui-ci.** La vue rendue
     * par `entriesFor` est construite champ par champ : elle n'a aucune place pour un secret.
     * Retirer le `select` de `listQueryFor` chargerait donc le chiffré, le déchiffrerait — non,
     * pire : le tiendrait en mémoire du serveur à chaque rendu de liste — **et la charge utile
     * resterait propre**, donc la suite resterait verte.
     *
     * On lit le SQL, exactement comme `coffre_wall.spec.ts` lit le routeur plutôt que de se
     * contenter des 403 : la seule façon de dire *quel* mécanisme est en place, plutôt que
     * *qu'un* résultat correct arrive.
     */
    const sql = vault.listQueryFor(1).toQuery()

    /**
     * ⚠️ **`notInclude('secret_cipher')` ne suffit PAS, et la mutation l'a montré.** En retirant
     * le `select`, la requête devient `select * from "coffre_entries" …` : elle charge la colonne
     * du secret **sans la nommer**, donc l'assertion d'absence passe au vert sur exactement le
     * code qu'elle est censée interdire. C'est le plancher qui avait rattrapé le coup.
     *
     * La règle qu'on veut n'est donc pas « le nom n'apparaît pas » mais « les colonnes sont
     * ÉNUMÉRÉES, et celle-là n'y est pas ». Les trois assertions ensemble le disent ; aucune ne
     * le dit seule.
     */
    assert.notInclude(sql, 'select *')
    assert.notInclude(sql, 'secret_cipher')
    // Plancher : sans lui, un `toQuery()` rendant une chaîne vide passerait les deux ci-dessus.
    assert.include(sql, 'title_cipher')
    assert.include(sql, 'content_cipher')
  })
})

test.group('Coffre / les identifiants — l’édition (CC-186)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('éditer avec un nouveau mot de passe le fait pivoter', async ({ client, assert }) => {
    const user = await createUserWith(['coffre.view', 'coffre.write'])
    const vaultRow = await createVault(user)
    const session = await unlockedSession(user, vaultRow)

    const id = await poserIdentifiant(client, user, session)

    const avant = await db.rawQuery('select secret_cipher from coffre_entries where id = ?', [id])
    const NOUVEAU = 'nouveau-mot-de-passe-tourne'

    const edition = await client
      .put(`/coffre/${id}`)
      .form({ title: SERVICE, content: IDENTIFIANT, password: NOUVEAU })
      .loginAs(user)
      .withSession(session)
      .withCsrfToken()
      .redirects(0)

    edition.assertStatus(302)

    const apres = await db.rawQuery('select secret_cipher from coffre_entries where id = ?', [id])
    assert.notEqual(apres.rows[0].secret_cipher, avant.rows[0].secret_cipher)
    assert.notInclude(apres.rows[0].secret_cipher, NOUVEAU)

    const reponse = await client
      .get(`/coffre/${id}/secret`)
      .loginAs(user)
      .withSession(session)
      .accept('json')

    reponse.assertBodyContains({ secret: NOUVEAU })
  })

  test('éditer sans toucher au mot de passe le laisse INTACT — un champ vide ne l’efface pas', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view', 'coffre.write'])
    const vaultRow = await createVault(user)
    const session = await unlockedSession(user, vaultRow)

    const id = await poserIdentifiant(client, user, session)

    const avant = await db.rawQuery('select secret_cipher from coffre_entries where id = ?', [id])

    await client
      .put(`/coffre/${id}`)
      .form({ title: 'Nouveau nom de service', content: IDENTIFIANT })
      .loginAs(user)
      .withSession(session)
      .withCsrfToken()
      .redirects(0)

    const apres = await db.rawQuery('select secret_cipher from coffre_entries where id = ?', [id])
    assert.equal(apres.rows[0].secret_cipher, avant.rows[0].secret_cipher)

    const reponse = await client
      .get(`/coffre/${id}/secret`)
      .loginAs(user)
      .withSession(session)
      .accept('json')

    reponse.assertBodyContains({ secret: MOT_DE_PASSE })
  })

  test('un mot de passe posté en éditant une NOTE reste sans effet — le type ne se poste pas', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view', 'coffre.write'])
    const vaultRow = await createVault(user)
    const session = await unlockedSession(user, vaultRow)

    const ecriture = await client
      .post('/coffre')
      .form({ type: 'note', title: 'Une note', content: 'Du texte' })
      .loginAs(user)
      .withSession(session)
      .withCsrfToken()
      .redirects(0)
    ecriture.assertStatus(302)

    const lignes = await db.rawQuery('select id from coffre_entries where owner_id = ?', [user.id])
    const id = lignes.rows[0].id as number

    await client
      .put(`/coffre/${id}`)
      .form({ title: 'Une note', content: 'Du texte modifié', password: MOT_DE_PASSE })
      .loginAs(user)
      .withSession(session)
      .withCsrfToken()
      .redirects(0)

    const apres = await db.rawQuery('select secret_cipher from coffre_entries where id = ?', [id])
    assert.isNull(apres.rows[0].secret_cipher)
  })
})

test.group('Coffre / les identifiants — la révélation', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('le mot de passe se demande une entrée à la fois, et ne se met pas en cache', async ({
    client,
    assert,
  }) => {
    const user = await createUserWith(['coffre.view', 'coffre.write'])
    const vaultRow = await createVault(user)
    const session = await unlockedSession(user, vaultRow)

    const id = await poserIdentifiant(client, user, session)

    const reponse = await client
      .get(`/coffre/${id}/secret`)
      .loginAs(user)
      .withSession(session)
      .accept('json')

    reponse.assertStatus(200)
    reponse.assertBodyContains({ secret: MOT_DE_PASSE })

    // ⚠️ `no-store`, pas `no-cache` : c'est l'écriture qu'on interdit, pas la revalidation.
    assert.include(String(reponse.header('cache-control')), 'no-store')
  })

  test('l’identifiant d’un autre compte ne rend jamais son mot de passe', async ({
    client,
    assert,
  }) => {
    const proprietaire = await createUserWith(['coffre.view', 'coffre.write'])
    const vaultProprietaire = await createVault(proprietaire)
    const id = await poserIdentifiant(
      client,
      proprietaire,
      await unlockedSession(proprietaire, vaultProprietaire)
    )

    // Un second compte, son propre coffre ouvert, qui devine l'identifiant de l'entrée.
    const autre = await createUserWith(['coffre.view', 'coffre.write'])
    const vaultAutre = await createVault(autre)

    const reponse = await client
      .get(`/coffre/${id}/secret`)
      .loginAs(autre)
      .withSession(await unlockedSession(autre, vaultAutre))
      .accept('json')

    reponse.assertStatus(404)
    assert.notInclude(JSON.stringify(reponse.body()), MOT_DE_PASSE)
  })

  test('une note n’a pas de mot de passe à révéler — et ce n’est pas un secret vide', async ({
    client,
  }) => {
    const user = await createUserWith(['coffre.view', 'coffre.write'])
    const vaultRow = await createVault(user)
    const session = await unlockedSession(user, vaultRow)

    await client
      .post('/coffre')
      .form({ type: 'note', title: 'Une note', content: 'Du texte' })
      .loginAs(user)
      .withSession(session)
      .withCsrfToken()
      .redirects(0)

    const lignes = await db.rawQuery('select id from coffre_entries where owner_id = ?', [user.id])

    const reponse = await client
      .get(`/coffre/${lignes.rows[0].id}/secret`)
      .loginAs(user)
      .withSession(session)
      .accept('json')

    reponse.assertStatus(404)
  })

  test('⚠️ un déchiffrement raté REFUSE, il ne rend pas un mot de passe vide', async ({
    client,
    assert,
  }) => {
    // La doctrine du module : « illisible » et « absent » ne se confondent jamais. Un secret vide
    // rendu 200 s'afficherait comme un mot de passe blanc et se copierait comme tel — désarmant
    // la protection au moment précis où quelque chose d'anormal est arrivé à la base.
    const user = await createUserWith(['coffre.view', 'coffre.write'])
    const vaultRow = await createVault(user)
    const session = await unlockedSession(user, vaultRow)

    const id = await poserIdentifiant(client, user, session)

    await db.rawQuery('update coffre_entries set secret_cipher = ? where id = ?', [
      'chiffré-que-personne-ne-peut-ouvrir',
      id,
    ])

    const reponse = await client
      .get(`/coffre/${id}/secret`)
      .loginAs(user)
      .withSession(session)
      .accept('json')

    reponse.assertStatus(422)
    assert.notProperty(reponse.body(), 'secret')
  })
})
