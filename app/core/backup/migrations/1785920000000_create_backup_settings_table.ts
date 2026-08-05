import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'backup_settings'

  async up() {
    // Réglage unique (CC-140) : une seule ligne, jamais plusieurs — même motif que
    // `leitner_settings`. `keep` et `daily_enabled` sont les seuls réglages qui n'engagent
    // aucune infrastructure (contrairement au dossier de sauvegarde et au miroir, des chemins
    // FIXES dans le conteneur, montés par le compose — voir le CLAUDE.md racine).
    this.schema.createTable(this.tableName, (table) => {
      table.integer('id').primary().defaultTo(1)
      table.check('id = 1')

      table.integer('keep').notNullable().defaultTo(10)
      // Activée par défaut : le silence actuel (aucune sauvegarde tant que personne ne pense à
      // lancer une commande) est exactement le risque que ce lot ferme. Décochable à
      // l'installation.
      table.boolean('daily_enabled').notNullable().defaultTo(true)

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })

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
