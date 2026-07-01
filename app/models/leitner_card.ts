import { DateTime } from 'luxon'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import LeitnerReview from '#models/leitner_review'

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

  @column()
  declare tags: string[]

  @hasMany(() => LeitnerReview)
  declare reviews: HasMany<typeof LeitnerReview>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
