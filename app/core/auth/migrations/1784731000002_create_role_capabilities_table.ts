import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'role_capabilities'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.integer('role_id').notNullable().references('id').inTable('roles').onDelete('CASCADE')
      // La capacité est stockée comme la chaîne `module.action` elle-même : aucune table de
      // référence. Le catalogue des capacités vit dans le code de chaque module (registre),
      // pas en base — une capacité retirée d'un module doit disparaître avec lui, pas
      // survivre en base à l'état de ligne orpheline que plus personne ne sait interpréter.
      table.string('capability', 100).notNullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.unique(['role_id', 'capability'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
