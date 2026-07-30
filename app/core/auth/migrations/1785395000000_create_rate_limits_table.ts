import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Table du store `database` de @adonisjs/limiter (CC-78) — les compteurs du
 * throttle de connexion. Schéma repris tel quel du stub officiel du paquet :
 * `rate-limiter-flexible` lit et écrit ces trois colonnes par leur nom.
 */
export default class extends BaseSchema {
  protected tableName = 'rate_limits'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('key', 255).notNullable().primary()
      table.integer('points', 9).notNullable().defaultTo(0)
      table.bigint('expire').unsigned()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
