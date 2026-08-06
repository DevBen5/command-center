import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * Une référence à un asset Immich, attachée à une entrée du coffre (CC-180).
 *
 * ⚠️ **`assetIdCipher` ne sort JAMAIS vers une page.** L'UUID Immich est du contenu du coffre,
 * chiffré comme un titre — mais contrairement au titre, il ne redescend jamais en clair dans la
 * charge utile Inertia : seul l'`id` de cette ligne y voyage, pour construire
 * `/coffre/media/:id/thumbnail`. Le déchiffrement n'a lieu que dans ce proxy, à la demande, avec
 * la clé de session élevée. Voir `VaultService.listMediaFor` / `mediaThumbnailAssetId`.
 */
export default class CoffreEntryMedia extends BaseModel {
  static table = 'coffre_entry_media'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare entryId: number

  @column()
  declare ownerId: number

  @column({ serializeAs: null })
  declare assetIdCipher: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
