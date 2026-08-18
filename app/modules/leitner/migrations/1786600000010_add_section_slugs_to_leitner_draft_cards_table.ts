import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * La provenance d'un brouillon (CC-253) : les slugs de section que le morceau qui l'a
 * produit couvre réellement, calculés à la construction du morceau (`chunkCourse`) —
 * jamais retrouvés après coup. `null` sur toute ligne antérieure à ce lot.
 *
 * ⚠️ Toujours un tableau côté application dès l'ingestion (potentiellement vide), même
 * quand l'ingestion n'a conservé aucun cours (`leitner_ingestions.leitner_course_id`
 * nul) : c'est `linkIngestionSections`, à la promotion, qui décide s'il y a quelque
 * chose à lier — cette colonne ne fait que porter le calcul.
 */
export default class extends BaseSchema {
  protected tableName = 'leitner_draft_cards'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.jsonb('section_slugs').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('section_slugs')
    })
  }
}
