import { test } from '@japa/runner'
import limiter from '@adonisjs/limiter/services/main'
import User from '#core/auth/models/user'
import installationToken from '#core/auth/services/installation_token_service'
import BackupSettings from '#core/backup/models/backup_settings'

const VALID_FORM = {
  fullName: 'Propriétaire Test',
  email: 'proprietaire@example.com',
  password: 'motdepasse-long-1',
  password_confirmation: 'motdepasse-long-1',
  // Sauvegarde (CC-140) : toujours envoyés par la page réelle, pré-remplis depuis les props.
  backupKeep: 10,
  backupDailyEnabled: true,
}

/**
 * L'écran d'installation (CC-138) : la porte n'existe que sur une base vide, le jeton couvre
 * la fenêtre, et la course à deux POST ne fabrique qu'un administrateur.
 *
 * ⚠️ **Jamais `withGlobalTransaction()`, et c'est le point qui rend le test de course
 * honnête** : la transaction globale ferait passer toutes les requêtes par la MÊME connexion
 * Postgres — deux POST « simultanés » s'y sérialiseraient d'office, et le test resterait
 * vert même sans le verrou (`pg_advisory_xact_lock`) qu'il est censé prouver. Avec deux
 * connexions du pool, seule la sérialisation faite par le code empêche le doublon.
 *
 * ⚠️ Et pas `truncate()` non plus : il vide TOUTES les tables, donc aussi la ligne unique de
 * `leitner_settings` posée par migration — `leitner_readonly.spec.ts` la lit après nous.
 * Le nettoyage est chirurgical : `users` seulement, tout le personnel part en cascade.
 */
test.group('Auth / écran d’installation', (group) => {
  // Base VIDE avant ET après chaque test : l'état que la porte exige, et rien laissé aux
  // suites suivantes (ces tests écrivent hors transaction).
  group.each.setup(async () => {
    await User.query().delete()
    return async () => {
      await User.query().delete()
    }
  })
  // Les compteurs du throttle vivent dans le store mémoire, que rien ne vide entre deux
  // tests (CC-78) — et le test de blocage ci-dessous en pose dix d'un coup.
  group.each.setup(() => limiter.clear(['memory']))
  group.each.teardown(() => limiter.clear(['memory']))

  test('base vide : /login redirige vers l’écran d’installation', async ({ client }) => {
    const response = await client.get('/login').redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/installation')
  })

  test('base vide : l’écran s’affiche — sans jamais porter le jeton', async ({
    client,
    assert,
  }) => {
    const response = await client.get('/installation')

    response.assertStatus(200)
    // Le jeton se recopie depuis les journaux du serveur : aucune réponse HTTP ne le porte.
    assert.notInclude(response.text(), installationToken.current())
  })

  test('base déjà installée : l’écran redirige, même en tapant l’URL à la main', async ({
    client,
    assert,
  }) => {
    await User.create({
      fullName: 'Compte Existant',
      email: 'a@example.com',
      password: 'x'.repeat(12),
    })

    const get = await client.get('/installation').redirects(0)
    get.assertStatus(302)
    get.assertHeader('location', '/login')

    // Le POST aussi — un formulaire rejoué depuis un onglet resté ouvert n'écrit rien.
    const post = await client
      .post('/installation')
      .form({ ...VALID_FORM, token: installationToken.current() })
      .withCsrfToken()
      .redirects(0)
    post.assertStatus(302)
    post.assertHeader('location', '/login')

    assert.isNull(await User.findBy('email', VALID_FORM.email))
  })

  test('jeton valide : crée le compte administrateur, qui peut se connecter et atteindre /admin', async ({
    client,
    assert,
  }) => {
    const response = await client
      .post('/installation')
      .form({ ...VALID_FORM, token: installationToken.current() })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/login')

    const owner = await User.findByOrFail('email', VALID_FORM.email)
    assert.isTrue(owner.isAdmin)
    assert.isTrue(owner.isActive)

    // Les réglages de sauvegarde saisis à l'écran (CC-140) sont bien persistés.
    const backupSettings = await BackupSettings.findOrFail(1)
    assert.equal(backupSettings.keep, VALID_FORM.backupKeep)
    assert.equal(backupSettings.dailyEnabled, VALID_FORM.backupDailyEnabled)

    // Le compte se connecte par la porte normale…
    const login = await client
      .post('/login')
      .form({ email: VALID_FORM.email, password: VALID_FORM.password })
      .withCsrfToken()
      .redirects(0)
    login.assertStatus(302)

    // …et atteint l'écran d'administration : c'est ce que `is_admin` doit ouvrir.
    const admin = await client.get('/admin/users').loginAs(owner).withInertia()
    admin.assertStatus(200)
  })

  test('jeton faux : refuse sans créer de compte, et la réponse ne porte jamais le jeton', async ({
    client,
    assert,
  }) => {
    const response = await client
      .post('/installation')
      .form({ ...VALID_FORM, token: 'jeton-faux' })
      .header('referrer', '/installation')
      .withCsrfToken()

    // La redirection est suivie : c'est la page ré-affichée, erreur comprise, qu'on inspecte.
    response.assertStatus(200)
    assert.notInclude(response.text(), installationToken.current())
    assert.isNull(await User.findBy('email', VALID_FORM.email))
  })

  test('jeton absent : erreur de validation, aucun compte', async ({ client, assert }) => {
    const response = await client
      .post('/installation')
      .form(VALID_FORM)
      .header('referrer', '/installation')
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.isNull(await User.findBy('email', VALID_FORM.email))
  })

  test('mot de passe trop court : refusé par la même règle que partout', async ({
    client,
    assert,
  }) => {
    const response = await client
      .post('/installation')
      .form({
        ...VALID_FORM,
        password: 'court',
        password_confirmation: 'court',
        token: installationToken.current(),
      })
      .header('referrer', '/installation')
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.isNull(await User.findBy('email', VALID_FORM.email))
  })

  test('les échecs de jeton comptent : au 10e, même le bon jeton est refusé', async ({
    client,
    assert,
  }) => {
    for (let i = 0; i < 10; i++) {
      await client
        .post('/installation')
        .form({ ...VALID_FORM, token: 'jeton-faux' })
        .header('referrer', '/installation')
        .withCsrfToken()
        .redirects(0)
    }

    // Le blocage se vérifie AVANT la comparaison : le bon jeton n'ouvre plus rien.
    const response = await client
      .post('/installation')
      .form({ ...VALID_FORM, token: installationToken.current() })
      .header('referrer', '/installation')
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.isNull(await User.findBy('email', VALID_FORM.email))
  })

  test('la course : deux POST simultanés ne font qu’UN administrateur', async ({
    client,
    assert,
  }) => {
    // Deux requêtes réellement concurrentes, deux connexions du pool : sans le
    // `pg_advisory_xact_lock` de `InstallationService`, les deux verraient « aucun compte »
    // sous READ COMMITTED et inséreraient toutes les deux.
    const [premiere, seconde] = await Promise.all([
      client
        .post('/installation')
        .form({ ...VALID_FORM, token: installationToken.current() })
        .withCsrfToken()
        .redirects(0),
      client
        .post('/installation')
        .form({
          ...VALID_FORM,
          email: 'concurrent@example.com',
          token: installationToken.current(),
        })
        .withCsrfToken()
        .redirects(0),
    ])

    // Les deux aboutissent sur /login — le perdant découvre une installation déjà faite,
    // jamais une erreur.
    premiere.assertStatus(302)
    seconde.assertStatus(302)

    const comptes = await User.query()
    assert.lengthOf(comptes, 1)
    assert.isTrue(comptes[0].isAdmin)
  })
})
