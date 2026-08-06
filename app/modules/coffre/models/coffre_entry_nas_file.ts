import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type { NasFileKind } from '#modules/coffre/services/nas_file_format'

/**
 * Une référence à un fichier média (photo ou vidéo) du NAS, attachée à une entrée du coffre
 * (CC-181).
 *
 * ⚠️ **`pathCipher` ne sort JAMAIS vers une page.** Le chemin est du contenu du coffre, chiffré
 * comme un titre — mais contrairement au titre, il ne redescend jamais en clair dans la charge
 * utile Inertia : seul l'`id` et le `kind` de cette ligne y voyagent, pour construire
 * `/coffre/nas/:id/stream` et choisir le bon élément (`<video>`/`<img>`). Le déchiffrement n'a
 * lieu que dans ce proxy, à la demande, avec la clé de session élevée. Voir
 * `VaultService.#nasFileIdsByEntry` / `nasFilePathFor`.
 *
 * ⚠️ **`kind` n'est PAS sensible, contrairement à `pathCipher`** : il ne révèle que la nature du
 * fichier (déjà connue de l'allow-list publique), jamais son nom ni son emplacement.
 */
export default class CoffreEntryNasFile extends BaseModel {
  static table = 'coffre_entry_nas_file'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare entryId: number

  @column()
  declare ownerId: number

  @column({ serializeAs: null })
  declare pathCipher: string

  @column()
  declare kind: NasFileKind

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
