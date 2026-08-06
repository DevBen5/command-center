import { DateTime } from 'luxon'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import { BaseModel, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'
import Role from '#core/auth/models/role'
import UserCapability from '#core/auth/models/user_capability'
import UserInvitation from '#core/auth/models/user_invitation'
import UserRecoveryCode from '#core/auth/models/user_recovery_code'

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

  /**
   * Le secret TOTP **chiffré** (CC-114), ou `null` si ce compte n'a jamais enrôlé.
   *
   * ⚠️ `serializeAs: null` : ce champ ne doit atteindre aucun payload. Le dépôt compose ses
   * props à la main plutôt que de sérialiser un modèle, donc rien ne le rendrait aujourd'hui
   * — la ceinture vaut pour le jour où quelqu'un écrira `user.serialize()`.
   */
  @column({ serializeAs: null })
  declare totpSecret: string | null

  /**
   * ⚠️ **C'est ce champ qui dit « le second facteur est actif », pas `totpSecret`** — voir
   * `hasTotp` et la migration. Un secret posé mais non confirmé n'exige rien à la connexion.
   */
  @column.dateTime()
  declare totpConfirmedAt: DateTime | null

  /** Le dernier pas de temps consommé — l'anti-rejeu de la RFC 6238. */
  @column({ serializeAs: null })
  declare totpLastStep: number | null

  @hasMany(() => UserRecoveryCode)
  declare recoveryCodes: HasMany<typeof UserRecoveryCode>

  /**
   * La borne des sessions de ce compte (CC-176) : toute session dont le tampon de connexion
   * précède cette date est morte, à sa requête suivante.
   *
   * ⚠️ **`null` n'est pas « inconnu », c'est « jamais révoqué »** — le comportement d'avant le
   * lot, et le seul cas où une session sans tampon reste tolérée (voir `AuthMiddleware`).
   * Ne l'écris jamais à la main : `revokeSessions` est le seul chemin, parce que c'est lui qui
   * garantit que la session qui déclenche le geste ne s'auto-expulse pas.
   */
  @column.dateTime()
  declare sessionsValidFrom: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  /**
   * Ce compte doit-il un second facteur pour se connecter ?
   *
   * ⚠️ **Les deux conditions, jamais la seule présence du secret** : l'enrôlement pose un
   * secret avant que quiconque ait prouvé savoir le lire. Se fier à `totpSecret` seul
   * verrouillerait dehors tout compte dont le QR n'a pas été scanné correctement.
   */
  get hasTotp(): boolean {
    return this.totpSecret !== null && this.totpConfirmedAt !== null
  }
}
