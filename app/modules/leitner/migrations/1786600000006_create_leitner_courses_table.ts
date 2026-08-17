import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Le corpus de cours (CC-251). Un cours est du **contenu**, comme les cartes et la
 * taxonomie : `owner_id` + `is_shared`, même doctrine que CC-139. Table neuve — aucune
 * ligne à backfiller — donc `is_shared` prend directement son défaut définitif
 * (`false`, privé) au lieu du couple alter-puis-defer-puis-alter des migrations
 * `add_owner_to_leitner_*`, qui existait pour ne pas casser des lignes déjà en base.
 *
 * `unique(owner_id, content_hash)` porte la dédup « même texte exactement » ;
 * `unique(owner_id, title)` porte la détection « même titre, texte différent ». Les
 * deux sont **scopées au propriétaire**, jamais globales — même raison que
 * `unique(owner_id, name)` sur `leitner_categories` (CC-139) : deux comptes peuvent
 * chacun avoir un cours « Réseaux » sans se marcher dessus.
 */
export default class extends BaseSchema {
  protected tableName = 'leitner_courses'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table.string('title', 200).notNullable()
      table.text('markdown').notNullable()
      // SHA-256 hex du markdown normalisé (fins de ligne, bords) — voir
      // `leitner_course_sections.ts#hashCourseMarkdown`.
      table.string('content_hash', 64).notNullable()
      // D'où vient le cours : collé/téléversé sur `/revision/cours`, ou créé depuis
      // la case « conserver » de `/revision/ingest`.
      table.string('source', 16).notNullable()

      table
        .integer('owner_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.boolean('is_shared').notNullable().defaultTo(false)

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      table.unique(['owner_id', 'content_hash'])
      table.unique(['owner_id', 'title'])
      table.index(['owner_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
