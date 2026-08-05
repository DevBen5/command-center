import type { ApplicationService } from '@adonisjs/core/types'

/**
 * Le point d'accroche de la sauvegarde automatique quotidienne (CC-140) — même patron que
 * `VeilleProvider`/`LeitnerProvider` : la boucle démarre au boot, s'arrête à l'extinction.
 *
 * ⚠️ `environment: ['web']` (adonisrc.ts) : seul le processus qui sert des requêtes a une
 * boucle de fond à faire tourner. Ni `node ace db:backup` (qui EST déjà une sauvegarde, pas
 * besoin d'une seconde boucle), ni les tests (une boucle réelle irait tenter d'écrire dans
 * `/data/backups`, absent du poste de dev et des runners CI).
 */
export default class BackupProvider {
  constructor(protected app: ApplicationService) {}

  async ready() {
    const { startBackupScheduler } = await import('#core/backup/services/backup_scheduler')
    startBackupScheduler()
  }

  async shutdown() {
    const { stopBackupScheduler } = await import('#core/backup/services/backup_scheduler')
    stopBackupScheduler()
  }
}
