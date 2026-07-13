import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import LeitnerReview from '#modules/leitner/models/leitner_review'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'

export default class LeitnerCard extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare front: string

  @column()
  declare back: string

  @column()
  declare box: number

  @column.date()
  declare nextReview: DateTime

  // Classement de la carte : un thème, lui-même rattaché à une catégorie.
  // `null` = carte non classée.
  @column()
  declare leitnerThemeId: number | null

  @belongsTo(() => LeitnerTheme)
  declare theme: BelongsTo<typeof LeitnerTheme>

  @hasMany(() => LeitnerReview)
  declare reviews: HasMany<typeof LeitnerReview>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
