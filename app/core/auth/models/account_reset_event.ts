import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * Un passage de la porte de service : `auth:reset-account` a réinitialisé un compte (CC-129).
 *
 * ⚠️ **Rien de secret ici, et c'est voulu** : ni le mot de passe posé, ni sa longueur, ni quoi
 * que ce soit qui aiderait à le deviner. La ligne répond à une seule question — *quel compte,
 * quand* — parce que c'est la seule à laquelle personne ne pouvait répondre après coup.
 *
 * Se relit sans écran, là où on a déjà les droits pour le faire :
 *
 * ```
 * docker compose exec postgres psql -U root -d app \
 *   -c 'select user_email, created_at from account_reset_events order by id desc limit 20'
 * ```
 */
export default class AccountResetEvent extends BaseModel {
  static table = 'account_reset_events'

  @column({ isPrimary: true })
  declare id: number

  /** ⚠️ `null` si le compte a été supprimé depuis — `userEmail` reste, lui. */
  @column()
  declare userId: number | null

  /** L'email tel qu'il était au moment du geste. */
  @column()
  declare userEmail: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
