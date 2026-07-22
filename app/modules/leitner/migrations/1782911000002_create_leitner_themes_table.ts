import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'leitner_themes'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table
        .integer('leitner_category_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('leitner_categories')
        .onDelete('CASCADE')
      table.string('name', 60).notNullable()

      // Un thème est unique *dans sa catégorie* : « docker » peut exister sous
      // DevOps et sous Infra sans collision.
      table.unique(['leitner_category_id', 'name'])

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
