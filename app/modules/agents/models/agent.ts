import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class Agent extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare name: string

  @column()
  declare framework: string

  @column()
  declare status: 'active' | 'idle' | 'running' | 'failed'

  @column({ prepare: (value: Record<string, unknown>) => JSON.stringify(value) })
  declare config: Record<string, unknown>

  @column({ prepare: (value: string[]) => JSON.stringify(value) })
  declare logs: string[]

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
