import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'leitner_cards'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table.text('front').notNullable()
      table.text('back').notNullable()
      table.integer('box').notNullable().defaultTo(1)
      table.date('next_review').notNullable()
      table.specificType('tags', 'text[]').notNullable().defaultTo('{}')

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
