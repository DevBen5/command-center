import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class Service extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string

  @column()
  declare category: string

  @column()
  declare url: string | null

  @column()
  declare status: 'up' | 'down' | 'unknown'

  @column({ prepare: (value: Record<string, unknown>) => JSON.stringify(value) })
  declare config: Record<string, unknown>

  @column()
  declare cpuPercent: number | null

  @column()
  declare ramPercent: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
