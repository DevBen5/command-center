import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'leitner_ingestions'

  async up() {
    // Le travail d'ingestion d'un cours : ce qu'on a soumis, où on en est, ce qui a
    // échoué. La colonne `status` porte déjà les quatre états, dont `pending` et
    // `running` — inutilisés en synchrone (lot 1), mais c'est ce qui fait du passage
    // à l'asynchrone (lot 2) un changement de mode d'exécution, pas de schéma.
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table.string('status', 16).notNullable().defaultTo('pending')
      table.string('source', 16).notNullable()
      // Nom du fichier téléversé ; null quand le cours a été collé.
      table.string('source_name').nullable()

      table.integer('char_count').notNullable().defaultTo(0)
      table.integer('chunk_count').notNullable().defaultTo(0)
      table.integer('chunks_done').notNullable().defaultTo(0)
      table.integer('cards_proposed').notNullable().defaultTo(0)

      // Message d'échec, affiché tel quel : un statut `failed` sans raison ne sert à rien.
      table.text('error').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
