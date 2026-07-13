import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'leitner_settings'

  async up() {
    // Réglage unique du module : une seule ligne, jamais plusieurs. La contrainte
    // `id = 1` interdit d'en créer une seconde en base — le service lit toujours
    // celle-là (LeitnerService.boxIntervals).
    this.schema.createTable(this.tableName, (table) => {
      table.integer('id').primary().defaultTo(1)
      table.check('id = 1')

      table.integer('box_1_days').notNullable().defaultTo(1)
      table.integer('box_2_days').notNullable().defaultTo(2)
      table.integer('box_3_days').notNullable().defaultTo(4)
      table.integer('box_4_days').notNullable().defaultTo(7)
      table.integer('box_5_days').notNullable().defaultTo(30)

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })

    // Les valeurs par défaut sont celles de DEFAULT_BOX_INTERVAL_DAYS : la ligne
    // existe dès la migration, l'écran de réglages n'a qu'à la modifier.
    this.defer(async (db) => {
      await db
        .table(this.tableName)
        .insert({ id: 1, created_at: new Date(), updated_at: new Date() })
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
