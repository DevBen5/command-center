import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * Un code de secours à usage unique (CC-114).
 *
 * ⚠️ Le code en clair n'existe qu'une fois : dans l'écran qui vient de le fabriquer. La base
 * n'en connaît que l'empreinte, comme les jetons d'invitation — une fuite du dump ne donne
 * aucun code utilisable.
 */
export default class UserRecoveryCode extends BaseModel {
  static table = 'user_recovery_codes'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column({ serializeAs: null })
  declare codeHash: string

  @column.dateTime()
  declare usedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
