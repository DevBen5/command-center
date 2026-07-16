import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'leitner_ingestions'

  async up() {
    // Le passage à l'asynchrone n'ajoute qu'une colonne : `status`, `chunk_count` et
    // `chunks_done` existaient déjà (la barre de progression avait sa source de données
    // avant d'avoir sa page). Le titre, lui, manquait : sans lui, l'historique ne sait
    // désigner un travail que par son origine — d'où les dix « Texte collé » de la v1.
    //
    // Nullable pour les lignes déjà en base : une ingestion créée depuis cette
    // migration porte toujours un titre (fourni, ou déduit du cours).
    this.schema.alterTable(this.tableName, (table) => {
      table.string('title', 120).nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('title')
    })
  }
}
