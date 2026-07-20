import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import VeilleSource from '#modules/veille/models/veille_source'

/**
 * Ce qu'est l'item, pas d'où il vient — la provenance est portée par `veille_sources.kind`.
 * `bookmark` et `note` restent les deux formes de capture manuelle.
 *
 * ⚠️ Cette liste est dupliquée dans la contrainte `veille_items_type_check` (migration) et
 * dans `captureValidator` (VineJS). Les trois bougent ensemble.
 */
export type VeilleItemType = 'article' | 'bookmark' | 'note'

export default class VeilleItem extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare type: VeilleItemType

  /** Nul pour une capture manuelle. */
  @column()
  declare veilleSourceId: number | null

  /**
   * Clé de déduplication, sous index unique. Nulle pour les captures manuelles : Postgres
   * autorise plusieurs NULL dans un index unique, elles ne se bloquent donc jamais entre elles.
   */
  @column()
  declare dedupKey: string | null

  @column()
  declare url: string | null

  @column()
  declare title: string

  /** Texte brut : le HTML du flux est réduit à du texte à la collecte, jamais stocké tel quel. */
  @column()
  declare content: string | null

  @column()
  declare tags: string[]

  @column({ prepare: (value: Record<string, unknown>) => JSON.stringify(value) })
  declare metadata: Record<string, unknown>

  @column()
  declare readingQueue: boolean

  /** Date annoncée par le flux. Nulle si absent — le tri retombe alors sur `createdAt`. */
  @column.dateTime()
  declare publishedAt: DateTime | null

  /** Nul tant que l'item n'a pas été lu. Un timestamp plutôt qu'un booléen : on sait *quand*. */
  @column.dateTime()
  declare readAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => VeilleSource)
  declare source: BelongsTo<typeof VeilleSource>
}
