import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Les identifiants : une troisième nature d'entrée, et une colonne que la liste ne lit pas
 * (CC-179, lot 2 de l'épique CC-177).
 *
 * ⚠️ **Un identifiant réutilise les colonnes du lot 1 plutôt que d'en ajouter trois.** Le titre
 * porte le **service**, le contenu porte le **nom d'utilisateur**, et seule la partie qui ne doit
 * jamais descendre dans une liste obtient sa propre colonne. Trois colonnes neuves auraient
 * dupliqué un chiffrement déjà en place et donné trois occasions d'en oublier une.
 *
 * ⚠️ **`secret_cipher` existe pour être ABSENTE d'une requête, pas pour être filtrée après coup.**
 * C'est tout le sujet du lot : `VaultService.entriesFor` énumère ses colonnes et ne cite pas
 * celle-ci, donc le chiffré n'est jamais chargé et le clair n'existe à aucun instant en mémoire
 * du serveur pendant un rendu de liste. Une colonne chargée puis retirée en JS marcherait
 * aujourd'hui et fuirait au premier `...entry` de complaisance.
 *
 * ⚠️ **Nullable, et ça ne peut pas être autrement** : les entrées du lot 1 (notes, liens) n'ont
 * pas de secret, et une valeur par défaut sur une colonne chiffrée ne veut rien dire — il n'y a
 * pas de « chiffré vide ». C'est `type = 'credential'` qui dit si la colonne est renseignée, et
 * `VaultService.addEntry` est le seul endroit qui l'écrit.
 *
 * ⚠️ **`type` n'est pas un enum natif** (voir `…_create_coffre_entries_table`) : knex a produit un
 * `text` plus une contrainte `CHECK` nommée `coffre_entries_type_check` — vérifiée en base, pas
 * devinée. On la remplace donc en SQL brut ; il n'y a **pas** d'`ALTER TYPE` à faire ici, et
 * `table.enum(...)` sur une colonne existante ne saurait pas la modifier.
 */
export default class extends BaseSchema {
  protected tableName = 'coffre_entries'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.text('secret_cipher').nullable()
    })

    this.schema.raw('alter table coffre_entries drop constraint coffre_entries_type_check')
    this.schema.raw(
      "alter table coffre_entries add constraint coffre_entries_type_check check (type in ('note', 'url', 'credential'))"
    )
  }

  /**
   * ⚠️ **Ce `down` ÉCHOUE s'il reste des identifiants, et c'est le sens sûr.** Restaurer une
   * contrainte à deux valeurs sur une table qui en porte trois est refusé par Postgres — bruyamment,
   * avant que la colonne ne soit supprimée, puisque l'ordre est inversé par rapport à `up`.
   *
   * L'alternative aurait été de supprimer les lignes `credential` pour faire passer le rollback :
   * ce serait détruire du contenu que personne d'autre ne détient — la seule copie — pour la
   * commodité d'une commande. Le module n'a ni corbeille ni récupération de passphrase ; il n'aura
   * pas non plus de suppression implicite. Vider les identifiants depuis l'écran est un geste
   * conscient, et c'est le seul qui doit exister.
   */
  async down() {
    this.schema.raw('alter table coffre_entries drop constraint coffre_entries_type_check')
    this.schema.raw(
      "alter table coffre_entries add constraint coffre_entries_type_check check (type in ('note', 'url'))"
    )

    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('secret_cipher')
    })
  }
}
