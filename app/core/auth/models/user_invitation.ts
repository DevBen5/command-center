import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * Un lien à usage unique par lequel un compte se donne son premier mot de passe.
 *
 * ⚠️ Le jeton en clair n'existe qu'une fois, dans la réponse HTTP faite à l'admin qui le
 * demande. Ni la base, ni les journaux, ni un message flash ne le portent : `SESSION_DRIVER`
 * vaut `cookie`, donc un flash partirait chez le client.
 */
export default class UserInvitation extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column({ serializeAs: null })
  declare tokenHash: string

  @column.dateTime()
  declare expiresAt: DateTime

  @column.dateTime()
  declare usedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  /** Utilisable = ni consommée, ni expirée. */
  get isPending(): boolean {
    return this.usedAt === null && this.expiresAt > DateTime.now()
  }
}
