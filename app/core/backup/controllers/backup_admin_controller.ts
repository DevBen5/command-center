import type { HttpContext } from '@adonisjs/core/http'
import backupService from '#core/backup/services/backup_service'
import backupSettings from '#core/backup/services/backup_settings_service'
import { backupSettingsValidator } from '#core/backup/validators/backup'

/**
 * L'écran d'administration de la sauvegarde (CC-140) : déclenche une sauvegarde, liste celles
 * qui existent avec leur âge, et règle rétention + automatique.
 *
 * ⚠️ `middleware.admin()`, comme Services et Agents — pas de capacité déléguable : cet écran
 * touche l'intégralité de la base, une sauvegarde à la fois.
 */
export default class BackupAdminController {
  async index({ inertia, session }: HttpContext) {
    const [settings, status, dumps] = await Promise.all([
      backupSettings.current(),
      Promise.resolve(backupService.status()),
      backupService.list(),
    ])

    return inertia.render('core/backup/admin/index', {
      keep: settings.keep,
      dailyEnabled: settings.dailyEnabled,
      directoryReady: status.directoryReady,
      mirrorConfigured: status.mirrorConfigured,
      dumps: dumps
        .slice()
        .reverse()
        .map((dump) => ({
          name: dump.name,
          sizeBytes: dump.sizeBytes,
          ageDays: Math.floor((Date.now() - dump.mtimeMs) / 86_400_000),
        })),
      notice: session.flashMessages.get('notice') ?? null,
      error: session.flashMessages.get('backupError') ?? null,
    })
  }

  async store({ session, response }: HttpContext) {
    const resultat = await backupService.runBackup()

    if (!resultat.ok) {
      session.flash('backupError', resultat.error ?? 'Sauvegarde échouée.')
      return response.redirect().back()
    }

    session.flash(
      'notice',
      resultat.error
        ? `Sauvegarde effectuée. ${resultat.error}`
        : 'Sauvegarde effectuée' + (resultat.mirrored ? ', copiée hors-disque.' : '.')
    )
    return response.redirect().back()
  }

  async update({ request, response, session }: HttpContext) {
    const { keep, dailyEnabled } = await request.validateUsing(backupSettingsValidator)
    await backupSettings.update({ keep, dailyEnabled })

    session.flash('notice', 'Réglages de sauvegarde mis à jour.')
    return response.redirect().back()
  }
}
