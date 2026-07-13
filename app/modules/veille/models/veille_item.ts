import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class VeilleItem extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare type: 'rss' | 'bookmark' | 'note'

  @column()
  declare url: string | null

  @column()
  declare title: string

  @column()
  declare content: string | null

  @column()
  declare tags: string[]

  @column({ prepare: (value: Record<string, unknown>) => JSON.stringify(value) })
  declare metadata: Record<string, unknown>

  @column()
  declare readingQueue: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
