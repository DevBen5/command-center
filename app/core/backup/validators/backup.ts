import vine from '@vinejs/vine'

/**
 * Les deux seuls réglages de sauvegarde qui n'engagent aucune infrastructure — voir
 * `BackupSettings` (CC-140). `keep` suit la même règle que `BACKUP_KEEP` côté poste de dev :
 * un entier, `0` désactive la purge sans être un défaut par accident.
 */
export const backupSettingsValidator = vine.compile(
  vine.object({
    keep: vine.number().min(0).max(1000),
    dailyEnabled: vine.boolean(),
  })
)
