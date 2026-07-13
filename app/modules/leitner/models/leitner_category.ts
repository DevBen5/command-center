import { DateTime } from 'luxon'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'

export default class LeitnerCategory extends BaseModel {
  static table = 'leitner_categories'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string

  @hasMany(() => LeitnerTheme)
  declare themes: HasMany<typeof LeitnerTheme>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
