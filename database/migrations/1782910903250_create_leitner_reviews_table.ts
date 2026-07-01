import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'leitner_reviews'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table
        .integer('leitner_card_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('leitner_cards')
        .onDelete('CASCADE')
      table.enum('grade', ['again', 'hard', 'good', 'easy']).notNullable()
      table.timestamp('reviewed_at').notNullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
