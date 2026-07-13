import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'veille_items'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table.enum('type', ['rss', 'bookmark', 'note']).notNullable()
      table.string('url').nullable()
      table.string('title').notNullable()
      table.text('content').nullable()
      table.specificType('tags', 'text[]').notNullable().defaultTo('{}')
      table.jsonb('metadata').notNullable().defaultTo('{}')
      table.boolean('reading_queue').notNullable().defaultTo(false)

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })

    // Colonne générée par Postgres (tsvector), tenue à jour automatiquement à
    // chaque écriture — pas besoin de la renseigner depuis l'application.
    this.schema.raw(`
      ALTER TABLE ${this.tableName}
      ADD COLUMN search_vector tsvector
      GENERATED ALWAYS AS (to_tsvector('french', coalesce(title, '') || ' ' || coalesce(content, ''))) STORED
    `)
    this.schema.raw(
      `CREATE INDEX veille_items_search_vector_idx ON ${this.tableName} USING GIN (search_vector)`
    )
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
