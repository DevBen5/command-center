import { BaseSchema } from '@adonisjs/lucid/schema'

/** CC-277 — le glossaire est un contenu Corpus autonome. */
export default class extends BaseSchema {
  protected tableName = 'glossary_terms'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('term', 200).notNullable()
      table.jsonb('aliases').notNullable().defaultTo('[]')
      table.text('definition').notNullable()
      table
        .integer('leitner_course_section_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('leitner_course_sections')
        .onDelete('SET NULL')
      table
        .integer('owner_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.boolean('is_shared').notNullable().defaultTo(false)
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
      table.index(['owner_id'])
      table.index(['leitner_course_section_id'])
    })

    this.schema.raw(`
      INSERT INTO glossary_terms
        (term, aliases, definition, leitner_course_section_id, owner_id, is_shared, created_at, updated_at)
      SELECT
        sections.aliases ->> 0,
        CASE WHEN jsonb_array_length(sections.aliases) > 1 THEN sections.aliases - 0 ELSE '[]'::jsonb END,
        sections.body,
        sections.id,
        courses.owner_id,
        courses.is_shared,
        NOW(), NOW()
      FROM leitner_course_sections AS sections
      INNER JOIN leitner_courses AS courses ON courses.id = sections.course_id
      WHERE sections.aliases IS NOT NULL
        AND jsonb_array_length(sections.aliases) > 0
        AND NULLIF(BTRIM(sections.aliases ->> 0), '') IS NOT NULL
    `)

    this.schema.alterTable('leitner_course_sections', (table) => table.dropColumn('aliases'))
  }

  async down() {
    this.schema.alterTable('leitner_course_sections', (table) => table.jsonb('aliases').nullable())
    this.schema.dropTable(this.tableName)
  }
}
