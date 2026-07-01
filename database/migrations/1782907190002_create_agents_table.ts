import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'agents'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table.string('name').notNullable()
      table.string('framework').notNullable()
      table.enum('status', ['active', 'idle', 'running', 'failed']).notNullable().defaultTo('idle')
      table.jsonb('config').notNullable().defaultTo('{}')
      table.jsonb('logs').notNullable().defaultTo('[]')

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
