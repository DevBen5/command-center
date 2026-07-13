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

  // Les colonnes `decimal` de PostgreSQL reviennent en chaînes via node-postgres ;
  // on les reconvertit en nombres pour que les calculs (moyennes, jauges) soient corrects.
  @column({ consume: (value: string | null) => (value === null ? null : Number(value)) })
  declare cpuPercent: number | null

  @column({ consume: (value: string | null) => (value === null ? null : Number(value)) })
  declare ramPercent: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
