import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * Réglages du module — **une seule ligne**, `id = 1` (contrainte en base).
 * Ne jamais en créer d'autre : `LeitnerService.settings()` lit celle-là.
 *
 * Les noms de colonnes sont déclarés explicitement : la conversion automatique
 * de `box1Days` vers `box_1_days` dépend de la stratégie de nommage, ne pas
 * s'y fier pour un identifiant qui mêle lettres et chiffres.
 */
export default class LeitnerSettings extends BaseModel {
  static table = 'leitner_settings'

  @column({ isPrimary: true })
  declare id: number

  @column({ columnName: 'box_1_days' })
  declare box1Days: number

  @column({ columnName: 'box_2_days' })
  declare box2Days: number

  @column({ columnName: 'box_3_days' })
  declare box3Days: number

  @column({ columnName: 'box_4_days' })
  declare box4Days: number

  @column({ columnName: 'box_5_days' })
  declare box5Days: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
