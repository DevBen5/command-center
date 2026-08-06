import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Les références de médias NAS — photos et vidéos (CC-181, lot 4 de l'épique CC-177) — table
 * dédiée, même doctrine que `coffre_entry_media` : un second type de référence demande une
 * colonne dédiée, pas un discriminant sur la même table. Les deux sources (Immich, disque local)
 * ont des règles de sécurité entièrement différentes (UUID vs. chemin de fichier) ; les mélanger
 * brouillerait la lecture d'un mécanisme dont la sûreté tient justement à être isolé et simple.
 *
 * ⚠️ **`path_cipher` est chiffré, comme `asset_id_cipher` côté médias Immich.** Un chemin de
 * fichier révèle des noms — dossiers, titres de fichiers — qui font partie du contenu que le
 * coffre protège, et partirait sinon en clair dans chaque `npm run db:backup`.
 *
 * ⚠️ **`kind` est en clair, sous CHECK — et ce n'est PAS une incohérence avec `path_cipher`.**
 * `kind` (« video » | « photo ») ne révèle que la NATURE du fichier, déjà connue de l'allow-list
 * publique (`nas_file_format.ts`) ; le CHEMIN, lui, reste le seul secret. Stocker `kind` en clair
 * permet à l'écran de choisir `<video>` ou `<img>` **sans jamais charger `path_cipher`** pour une
 * simple liste — même doctrine que `COLONNES_DE_LISTE` (CC-179) : le chargement du chiffré reste
 * réservé au proxy de streaming, une ligne à la fois.
 *
 * ⚠️ **`owner_id` dénormalisé, `CASCADE` sur les deux FK** — identique à `coffre_entry_media`,
 * pour les mêmes raisons (autorisation par clause plate, pas d'entrée orpheline illisible).
 *
 * ⚠️ **`kind` n'est pas un enum natif** (pas de `useNative: true`), même doctrine que
 * `coffre_entries.type` : knex produit un `text` + une contrainte `CHECK`. Ajouter une valeur
 * (un format futur) = `DROP`/`ADD CONSTRAINT`, jamais `ALTER TYPE`.
 */
export default class extends BaseSchema {
  protected tableName = 'coffre_entry_nas_file'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('entry_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('coffre_entries')
        .onDelete('CASCADE')
      table
        .integer('owner_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      table.text('path_cipher').notNullable()
      table.enum('kind', ['video', 'photo']).notNullable()

      table.timestamp('created_at').notNullable()

      table.index(['entry_id'])
      table.index(['owner_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
