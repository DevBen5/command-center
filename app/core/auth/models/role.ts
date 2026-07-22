import { DateTime } from 'luxon'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import RoleCapability from '#core/auth/models/role_capability'

/**
 * Un rôle est un préréglage, rien de plus : un nom posé sur un ensemble de capacités.
 *
 * Pas de hiérarchie, pas d'héritage. À cette échelle, ça se paierait cher (ordre de
 * résolution, cycles, capacités « héritées » qu'on ne voit nulle part à l'écran) pour
 * un besoin qui n'existe pas. Ce qu'un rôle ne couvre pas se règle par une surcharge
 * sur l'utilisateur.
 */
export default class Role extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string

  @hasMany(() => RoleCapability)
  declare capabilities: HasMany<typeof RoleCapability>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
