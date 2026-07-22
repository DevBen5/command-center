import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'services'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table.string('name').notNullable()
      table.string('category').notNullable()
      table.string('url').nullable()
      table.enum('status', ['up', 'down', 'unknown']).notNullable().defaultTo('unknown')
      table.jsonb('config').notNullable().defaultTo('{}')
      table.decimal('cpu_percent', 5, 2).nullable()
      table.decimal('ram_percent', 5, 2).nullable()

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
