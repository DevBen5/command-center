import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type { CatalogItemNature, CatalogSourceKey } from '#modules/coffre/services/catalog_source'

/**
 * Une ligne du catalogue des sources — un élément découvert dans une source externe, indépendant
 * de toute entrée du coffre (CC-225). Voir la migration pour la doctrine complète (par compte,
 * en clair, `missing_since` porte l'absence).
 */
export default class CoffreCatalogItem extends BaseModel {
  static table = 'coffre_catalog_items'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare ownerId: number

  @column()
  declare entryId: number | null

  @column()
  declare source: CatalogSourceKey

  @column()
  declare reference: string

  @column()
  declare nature: CatalogItemNature

  @column()
  declare displayName: string | null

  @column.dateTime()
  declare capturedAt: DateTime | null

  @column()
  declare sizeBytes: number | null

  @column.dateTime()
  declare discoveredAt: DateTime

  @column.dateTime()
  declare lastSeenAt: DateTime

  @column.dateTime()
  declare missingSince: DateTime | null
}
