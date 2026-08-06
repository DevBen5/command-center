import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * Le coffre d'un compte : son sel et son témoin (CC-178).
 *
 * ⚠️ **Un coffre par compte, pas un par installation.** Rien n'y est partagé, et la clé dérive de
 * la passphrase d'**une** personne. Un coffre commun rendrait le contenu du propriétaire lisible
 * par quiconque reçoit `coffre.view` et connaît la passphrase — c'est la leçon de CC-139 sur
 * Leitner, appliquée avant d'avoir à la réapprendre.
 *
 * ⚠️ **Aucun secret n'est stocké ici**, et surtout pas la passphrase : ni en clair, ni hachée. Ce
 * qui rend « passphrase perdue = contenu perdu » vrai, et ce qui interdit tout équivalent
 * d'`auth:reset-account` — ce serait une porte dérobée sur le coffre.
 */
export default class CoffreVault extends BaseModel {
  static table = 'coffre_vaults'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare kdfSalt: string

  @column()
  declare verifier: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
