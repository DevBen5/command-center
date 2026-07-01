import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

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

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
