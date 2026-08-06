import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/** Les deux natures du lot 1. Identifiants, médias et fichiers viennent après. */
export type CoffreEntryType = 'note' | 'url'

/**
 * Une entrée du coffre (CC-178).
 *
 * ⚠️ **`titleCipher` et `contentCipher` ne sortent JAMAIS telles quelles vers une page.** Ce ne
 * sont pas des colonnes qu'on affiche : le contrôleur déchiffre, et n'envoie au navigateur que le
 * clair. Sérialiser le chiffré ferait voyager du contenu de coffre dans une charge utile Inertia —
 * inutile, et une invitation à le traiter comme une donnée ordinaire.
 *
 * ⚠️ **Aucun `orderBy` sur le titre n'est possible**, et ce n'est pas un oubli : Postgres ne voit
 * que des octets. L'ordre du module est `created_at`. Voir la migration.
 */
export default class CoffreEntry extends BaseModel {
  static table = 'coffre_entries'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare ownerId: number

  @column()
  declare type: CoffreEntryType

  @column({ serializeAs: null })
  declare titleCipher: string

  @column({ serializeAs: null })
  declare contentCipher: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
