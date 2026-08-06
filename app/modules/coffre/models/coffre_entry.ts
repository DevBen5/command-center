import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * Les natures d'entrée. Médias et fichiers viennent après.
 *
 * ⚠️ **Un `credential` réutilise les colonnes existantes** : `titleCipher` porte le **service**,
 * `contentCipher` le **nom d'utilisateur**, et seul le mot de passe obtient sa propre colonne
 * (CC-179). Cette correspondance-là n'est écrite nulle part en base — c'est l'écran et le
 * validateur qui la tiennent, et c'est pourquoi elle est nommée ici.
 */
export type CoffreEntryType = 'note' | 'url' | 'credential'

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

  /**
   * Le mot de passe d'un identifiant, chiffré. `null` pour une note ou un lien.
   *
   * ⚠️ **Elle est déclarée pour être ABSENTE des requêtes de liste, pas pour être filtrée
   * ensuite** (CC-179). `VaultService.entriesFor` énumère ses colonnes et ne cite pas celle-ci :
   * le chiffré n'est jamais chargé, donc le clair n'existe à aucun instant en mémoire du serveur
   * pendant un rendu de liste. Un modèle qui la chargerait puis un `map` qui la retirerait
   * marcherait aujourd'hui et fuirait au premier `...entry` de complaisance. **Ne l'ajoute pas à
   * une requête de liste**, quelle que soit la commodité.
   *
   * ⚠️ Le `serializeAs: null` reste indispensable et ne remplace pas le point ci-dessus : il
   * empêche le **chiffré** de voyager, il ne dit rien du clair.
   */
  @column({ serializeAs: null })
  declare secretCipher: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
