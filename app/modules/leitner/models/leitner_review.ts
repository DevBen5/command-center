import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import LeitnerCard from '#modules/leitner/models/leitner_card'

export default class LeitnerReview extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare leitnerCardId: number

  @column()
  declare grade: 'again' | 'hard' | 'good' | 'easy'

  @column.dateTime()
  declare reviewedAt: DateTime

  @belongsTo(() => LeitnerCard)
  declare leitnerCard: BelongsTo<typeof LeitnerCard>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
