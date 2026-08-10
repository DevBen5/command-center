import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Le cache de vignettes du catalogue NAS (CC-228) — une ligne PAR élément de catalogue, générée à
 * la demande (jamais au moment de `coffre:sync-catalog`), et chiffrée par la clé du coffre.
 *
 * ⚠️ **Table CHIFFRÉE, contrairement à `coffre_catalog_items`.** Le catalogue lui-même est en clair
 * (décision de l'épique CC-224, voir son CLAUDE.md) parce qu'il ne porte que des métadonnées déjà
 * connues de la source (nom, date, taille). Une vignette est un rendu du CONTENU du fichier — la
 * même chose que le coffre existe pour protéger. Deux arbitrages différents sur deux tables
 * différentes, pas une incohérence.
 *
 * ⚠️ **`catalog_item_id` UNIQUE, jamais une ligne par génération.** Une regénération remplace la
 * ligne existante (`updateOrCreate` côté service) — ce n'est pas un historique, seulement le
 * dernier rendu connu.
 *
 * ⚠️ **`owner_id` dupliqué depuis `coffre_catalog_items.owner_id`**, même doctrine que
 * `coffre_entry_media`/`coffre_entry_nas_file` : permet un scoping direct sans jointure, défense en
 * profondeur si `catalog_item_id` est un jour deviné.
 */
export default class extends BaseSchema {
  protected tableName = 'coffre_catalog_thumbnails'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table
        .integer('catalog_item_id')
        .unsigned()
        .notNullable()
        .unique()
        .references('id')
        .inTable('coffre_catalog_items')
        .onDelete('CASCADE')

      table
        .integer('owner_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      table.text('content_cipher').notNullable()
      table.string('content_type', 32).notNullable()

      table.timestamp('generated_at').notNullable()

      table.index(['owner_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
