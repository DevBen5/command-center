import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * Réglages de la sauvegarde (CC-140) — **une seule ligne**, `id = 1` (contrainte en base).
 * Ne jamais en créer d'autre : `BackupSettingsService` lit celle-là.
 *
 * ⚠️ Ne porte PAS le dossier de sauvegarde ni le miroir : ce sont des chemins FIXES dans le
 * conteneur (`/data/backups`, `/data/backup-mirror`), montés par le compose — les rendre
 * éditables en base réintroduirait le risque qu'un chemin accepté ne corresponde à aucun
 * volume monté (voir le CLAUDE.md racine).
 */
export default class BackupSettings extends BaseModel {
  static table = 'backup_settings'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare keep: number

  @column()
  declare dailyEnabled: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
