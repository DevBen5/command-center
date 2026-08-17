import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Les sections d'un cours (CC-251), découpées par titres Markdown, sans recouvrement —
 * distinct de `chunkCourse` (chevauchement de 400 caractères pour un LLM). Voir
 * `services/leitner_course_sections.ts`.
 *
 * ⚠️ **Ne porte PAS `owner_id`/`is_shared`** : une section appartient toujours à
 * exactement un cours (`course_id` non nullable), sa visibilité se dérive par jointure
 * — même doctrine que `leitner_draft_cards` vis-à-vis de son ingestion.
 *
 * `slug` est le chemin de titres, stable à la ré-édition : c'est ce qui permet la
 * doctrine des pierres tombales (voir le service) — jamais de suppression physique
 * d'une section vivante, seulement `obsolete_at` posé. `unique(course_id, slug)`
 * couvre aussi bien les sections vivantes que tombées : un slug réapparu ressuscite
 * la ligne existante plutôt que d'en créer une seconde.
 */
export default class extends BaseSchema {
  protected tableName = 'leitner_course_sections'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table
        .integer('course_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('leitner_courses')
        .onDelete('CASCADE')

      table.string('slug', 300).notNullable()
      // Le chemin de titres, tel qu'affiché (« Réseaux › TLS › Handshake »).
      table.jsonb('heading_path').notNullable()
      table.text('body').notNullable()
      // La ligne `> notion: X, Y` sous le titre, si elle existe. `null` = la section
      // n'entre pas au glossaire — elle reste consultable normalement.
      table.jsonb('aliases').nullable()
      // Pierre tombale : posée quand le slug disparaît au remplacement du markdown,
      // le texte est CONSERVÉ. Purge = geste manuel depuis `/revision/cours`.
      table.timestamp('obsolete_at').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      table.unique(['course_id', 'slug'])
      table.index(['course_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
