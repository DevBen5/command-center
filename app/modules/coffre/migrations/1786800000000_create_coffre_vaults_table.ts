import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Le coffre d'un compte : son sel de dérivation et son témoin (CC-178).
 *
 * ⚠️ **Rien ici n'est un secret, et c'est voulu.** `kdf_salt` est public par construction (un sel
 * n'a jamais été confidentiel, il empêche les tables précalculées), et `verifier` est une constante
 * connue chiffrée avec la clé dérivée : sans la passphrase, il ne se déchiffre pas. La passphrase,
 * elle, n'est **stockée nulle part** — ni en clair, ni hachée. C'est ce qui rend
 * « passphrase perdue = contenu perdu » vrai plutôt que rhétorique.
 *
 * ⚠️ **`user_id` est UNIQUE, et cette contrainte est le seul garde-fou qui tienne.** Deux
 * `POST /coffre/creation` concurrents généreraient deux sels : la clé changerait sous les pieds des
 * entrées déjà écrites, qui deviendraient indéchiffrables **sans qu'aucune erreur ne le signale**.
 * Un contrôle applicatif « existe-t-il déjà un coffre ? » ne couvre pas ce cas — les deux requêtes
 * lisent avant que l'une n'écrive. C'est la base qui arbitre, comme pour `veille_items.dedup_key` ;
 * ne prends pas pour modèle la déduplication applicative de Leitner, elle ne tient pas ici.
 *
 * ⚠️ **`CASCADE`, contrairement au contenu de Leitner qui survit en `SET NULL`.** Rien n'est
 * partagé dans un coffre et la clé dérive de la passphrase d'**une** personne : une ligne orpheline
 * serait un chiffré que plus personne au monde ne peut déchiffrer. La garder ne conserverait pas
 * des données, seulement des octets.
 */
export default class extends BaseSchema {
  protected tableName = 'coffre_vaults'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('user_id')
        .unsigned()
        .notNullable()
        .unique()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      // Hexadécimal, jamais du binaire : une colonne `text` se relit à l'œil dans un dump et
      // traverse `pg_dump`/`psql` sans encodage à négocier.
      table.text('kdf_salt').notNullable()
      table.text('verifier').notNullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
