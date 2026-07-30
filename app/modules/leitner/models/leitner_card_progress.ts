import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#core/auth/models/user'
import LeitnerCard from '#modules/leitner/models/leitner_card'

/**
 * Où en est **une personne** sur **une carte** : sa boîte, sa prochaine échéance.
 *
 * ⚠️ **L'absence de ligne n'est pas un trou, c'est une valeur** : elle vaut « boîte 1,
 * due aujourd'hui ». C'est ce qui donne à un compte neuf une file pleine sans rien semer,
 * et à une carte créée aujourd'hui d'être due pour tout le monde sans re-semis. Toute
 * lecture doit donc passer par une jointure **externe** avec un `coalesce`, jamais par un
 * `where` sur cette table seule — qui rendrait invisibles toutes les cartes jamais notées.
 *
 * ⚠️ **`updatedAt` porte l'ordre de la file.** Une carte notée `again` reste due le jour
 * même ; ce qui la renvoie en fin de file, c'est que sa progression vient d'être écrite.
 * Avant CC-119 ce rôle était tenu par `leitner_cards.updated_at`, qui ne bouge plus à la
 * note — s'y fier laisserait la carte ratée se re-présenter en boucle.
 */
export default class LeitnerCardProgress extends BaseModel {
  static table = 'leitner_card_progress'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare leitnerCardId: number

  @column()
  declare box: number

  @column.date()
  declare nextReview: DateTime

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @belongsTo(() => LeitnerCard)
  declare leitnerCard: BelongsTo<typeof LeitnerCard>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
