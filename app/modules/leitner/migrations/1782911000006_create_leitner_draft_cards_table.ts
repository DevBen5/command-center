import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'leitner_draft_cards'

  async up() {
    // Cartes **proposées**, jamais des cartes : ni boîte ni échéance ici. Une carte
    // naît en boîte 1 dans `leitner_cards` au moment de la validation humaine.
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table
        .integer('leitner_ingestion_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('leitner_ingestions')
        // Supprimer une ingestion emporte ses brouillons : ils n'ont aucun sens seuls.
        .onDelete('CASCADE')

      table.text('front').notNullable()
      table.text('back').notNullable()

      // La taxonomie proposée par le modèle, **par son nom** — jamais un id : ce que
      // sort un LLM n'est pas fiable, et un id réinjecté casserait les séquences.
      // Les noms sont résolus (ou créés) à la promotion, via LeitnerCatalogService.
      table.string('category', 60).nullable()
      table.string('theme', 60).nullable()

      table.string('status', 16).notNullable().defaultTo('pending')

      // La carte née de ce brouillon. `SET NULL` : supprimer la carte plus tard ne
      // doit pas emporter la trace de son origine.
      table
        .integer('leitner_card_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('leitner_cards')
        .onDelete('SET NULL')

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
