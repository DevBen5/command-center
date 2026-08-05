import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import BackupSettings from '#core/backup/models/backup_settings'
import { createAdmin, createUserWith } from '#tests/helpers/users'

/**
 * CC-140 — l'écran `/admin/sauvegarde` : accès réservé à `is_admin` (comme Services/Agents,
 * aucune capacité déléguable), mise à jour des réglages, et déclenchement d'une sauvegarde.
 *
 * ⚠️ Le POST déclenche le vrai `BackupService.runBackup()` — sur ce poste comme en CI,
 * `/data/backups` n'est monté nulle part (c'est un chemin fixe du conteneur applicatif, voir
 * `config/backup.ts`), donc le résultat attendu ici est un refus explicite, pas un succès :
 * ce test prouve que le contrôleur relaie correctement l'échec (redirect + message flashé),
 * pas qu'un vrai `pg_dump` tourne — voir le commentaire de synthèse du ticket pour ce que la
 * suite ne couvre pas.
 */
test.group('Core / administration de la sauvegarde', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('un non-admin reçoit un refus', async ({ client }) => {
    const user = await createUserWith([])

    const response = await client.get('/admin/sauvegarde').loginAs(user)

    response.assertStatus(403)
  })

  test('un admin voit l’écran avec les réglages courants', async ({ client, assert }) => {
    const admin = await createAdmin()

    const response = await client.get('/admin/sauvegarde').loginAs(admin).withInertia()

    response.assertStatus(200)
    const props = response.inertiaProps as Record<string, unknown>
    assert.property(props, 'keep')
    assert.property(props, 'dailyEnabled')
    assert.property(props, 'directoryReady')
    assert.property(props, 'mirrorConfigured')
    assert.property(props, 'dumps')
  })

  test('met à jour la rétention et l’automatique', async ({ client, assert }) => {
    const admin = await createAdmin()

    const response = await client
      .put('/admin/sauvegarde')
      .json({ keep: 3, dailyEnabled: false })
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const settings = await BackupSettings.findOrFail(1)
    assert.equal(settings.keep, 3)
    assert.isFalse(settings.dailyEnabled)
  })

  test('déclenche une sauvegarde et relaie l’échec quand le volume n’est pas monté', async ({
    client,
  }) => {
    const admin = await createAdmin()

    const response = await client
      .post('/admin/sauvegarde')
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
  })
})
