import BackupSettings from '#core/backup/models/backup_settings'

export interface BackupSettingsUpdate {
  keep: number
  dailyEnabled: boolean
}

/**
 * Lecture/écriture de la ligne unique de réglages (CC-140). Ne porte que ce qui est
 * réellement éditable sans dépendance d'infrastructure — voir `BackupSettings`.
 */
export class BackupSettingsService {
  /** Ligne unique (`id = 1`), recréée aux valeurs par défaut de la migration si absente. */
  async current(): Promise<BackupSettings> {
    return BackupSettings.firstOrCreate({ id: 1 }, { keep: 10, dailyEnabled: true })
  }

  async update(values: BackupSettingsUpdate): Promise<BackupSettings> {
    const settings = await this.current()
    settings.merge(values)
    await settings.save()
    return settings
  }
}

export default new BackupSettingsService()
