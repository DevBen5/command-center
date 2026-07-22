import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCategory from '#modules/leitner/models/leitner_category'

export default class LeitnerTheme extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare leitnerCategoryId: number

  @column()
  declare name: string

  @belongsTo(() => LeitnerCategory)
  declare category: BelongsTo<typeof LeitnerCategory>

  @hasMany(() => LeitnerCard)
  declare cards: HasMany<typeof LeitnerCard>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
