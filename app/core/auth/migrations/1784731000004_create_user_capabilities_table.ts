import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'user_capabilities'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.string('capability', 100).notNullable()
      // La surcharge accorde (`true`) **ou retire** (`false`) une capacité hors du rôle.
      // Les deux sens comptent : sans le retrait, on ne pourrait fermer une capacité à une
      // personne qu'en lui fabriquant un rôle à elle seule.
      table.boolean('granted').notNullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.unique(['user_id', 'capability'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
