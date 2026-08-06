import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Le contenu du coffre : des notes et des URLs, chiffrées au repos (CC-178).
 *
 * ⚠️ **Le TITRE est chiffré, pas seulement le contenu.** C'est le point qu'on rate en premier : un
 * titre en clair (« Compte bancaire », « Serveur de sauvegarde ») dit l'essentiel de ce que le
 * coffre protège, et il partirait tel quel dans chaque `npm run db:backup` — donc chez le miroir
 * `BACKUP_MIRROR_DIR`, où les dumps voyagent en clair par décision assumée du dépôt. Un coffre dont
 * l'index est lisible n'est pas un coffre.
 *
 * ⚠️ **Conséquence directe, et elle ne se contourne pas : aucune recherche, aucun tri SQL sur le
 * contenu.** Postgres ne voit que des octets. Pas de `search_vector` ici, pas d'index GIN, pas
 * d'`orderBy('title')` — l'ordre est `created_at`, la seule colonne qui reste en clair et qui peut
 * l'être. C'est le prix du chiffrement au repos, pas un manque à combler.
 *
 * ⚠️ **`type` n'est pas un enum natif** (pas de `useNative: true`) : knex produit un `text` + une
 * contrainte `CHECK`, comme `veille_items.type`. Ajouter une valeur = `DROP`/`ADD CONSTRAINT`,
 * jamais `ALTER TYPE`.
 *
 * ⚠️ **`CASCADE` — voir `…_create_coffre_vaults_table`** : le coffre parti, ces lignes ne sont plus
 * déchiffrables par personne.
 */
export default class extends BaseSchema {
  protected tableName = 'coffre_entries'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('owner_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      table.enum('type', ['note', 'url']).notNullable()

      table.text('title_cipher').notNullable()
      table.text('content_cipher').notNullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      table.index(['owner_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
