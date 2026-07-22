import { DateTime } from 'luxon'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import { BaseModel, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'
import Role from '#core/auth/models/role'
import UserCapability from '#core/auth/models/user_capability'
import UserInvitation from '#core/auth/models/user_invitation'

const AuthFinder = withAuthFinder(() => hash.use('scrypt'), {
  uids: ['email'],
  passwordColumnName: 'password',
})

export default class User extends compose(BaseModel, AuthFinder) {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare fullName: string | null

  @column()
  declare email: string

  @column({ serializeAs: null })
  declare password: string

  /**
   * ⚠️ Court-circuite toute vérification de capacité, et c'est le **seul** chemin vers
   * Services et Agents. Volontairement un booléen : une capacité « tout » devrait être
   * tenue à jour à chaque ajout, et l'oubli ouvrirait une porte au lieu d'en fermer une.
   */
  @column()
  declare isAdmin: boolean

  /** Un compte désactivé garde ses données mais n'accède plus à rien — voir `AuthMiddleware`. */
  @column()
  declare isActive: boolean

  @column()
  declare roleId: number | null

  @belongsTo(() => Role)
  declare role: BelongsTo<typeof Role>

  @hasMany(() => UserCapability)
  declare capabilities: HasMany<typeof UserCapability>

  @hasMany(() => UserInvitation)
  declare invitations: HasMany<typeof UserInvitation>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
