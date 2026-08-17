import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Le lien optionnel entre un travail d'ingestion et le cours qu'il a fait naître
 * (CC-251, case « conserver ce cours »). `SET NULL` : supprimer le cours ne doit pas
 * effacer la trace du travail qui l'a produit, et supprimer l'ingestion ne doit
 * jamais emporter le cours — c'est du contenu, il survit toujours.
 */
export default class extends BaseSchema {
  protected tableName = 'leitner_ingestions'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table
        .integer('leitner_course_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('leitner_courses')
        .onDelete('SET NULL')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('leitner_course_id')
    })
  }
}
