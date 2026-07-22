import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * Une surcharge par utilisateur : accorde (`granted = true`) ou retire (`granted = false`)
 * une capacité, indépendamment de son rôle. Elle l'emporte toujours sur le rôle.
 */
export default class UserCapability extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare capability: string

  @column()
  declare granted: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
