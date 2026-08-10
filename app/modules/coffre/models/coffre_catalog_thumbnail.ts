import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * Le cache de vignettes du catalogue NAS (CC-228) — une ligne par élément de catalogue, voir la
 * migration pour la doctrine complète (chiffré, généré à la demande, `catalog_item_id` unique).
 *
 * ⚠️ **`contentCipher` ne sort JAMAIS vers une page** (`serializeAs: null`), même doctrine que
 * `CoffreEntryNasFile.pathCipher` : seul `catalog_thumbnail_cache.ts` le déchiffre.
 */
export default class CoffreCatalogThumbnail extends BaseModel {
  static table = 'coffre_catalog_thumbnails'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare catalogItemId: number

  @column()
  declare ownerId: number

  @column({ serializeAs: null })
  declare contentCipher: string

  @column()
  declare contentType: string

  @column.dateTime()
  declare generatedAt: DateTime
}
