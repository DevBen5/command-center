import { DateTime } from 'luxon'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import VeilleItem from '#modules/veille/models/veille_item'

/** Provenance du flux. Le lot 1 ne connaît que `rss` — qui couvre RSS 2.0 *et* Atom. */
export type SourceKind = 'rss'

export default class VeilleSource extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare kind: SourceKind

  @column()
  declare url: string

  @column()
  declare title: string

  @column()
  declare fetchIntervalMinutes: number

  @column()
  declare etag: string | null

  @column()
  declare lastModified: string | null

  @column.dateTime()
  declare lastFetchedAt: DateTime | null

  /** Message d'échec, affichable tel quel. `null` tant que rien n'a échoué. */
  @column()
  declare lastError: string | null

  @column.dateTime()
  declare lastErrorAt: DateTime | null

  /** Entrées reconnues à la dernière collecte réussie. `0` est une anomalie, pas une erreur. */
  @column()
  declare lastItemCount: number | null

  @column()
  declare active: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @hasMany(() => VeilleItem)
  declare items: HasMany<typeof VeilleItem>

  /**
   * La source est-elle due ? Jamais collectée = due immédiatement, c'est ce qui fait qu'une
   * source neuve remonte du contenu sans attendre un cycle complet.
   */
  isDue(now: DateTime = DateTime.now()): boolean {
    if (!this.active) return false
    if (this.lastFetchedAt === null) return true
    return this.lastFetchedAt.plus({ minutes: this.fetchIntervalMinutes }) <= now
  }
}
