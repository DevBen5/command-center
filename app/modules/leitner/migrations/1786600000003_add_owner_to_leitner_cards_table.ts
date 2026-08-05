import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * `owner_id` + `is_shared` sur les cartes (CC-139) — la table la plus visible du lot.
 * Même règle de backfill que `…_add_owner_to_leitner_categories_table` : `is_shared =
 * true` sur tout l'existant, jamais `false`, pour ne pas verrouiller rétroactivement du
 * contenu qui était visible de tous la veille de cette migration.
 */
export default class extends BaseSchema {
  protected tableName = 'leitner_cards'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table
        .integer('owner_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.boolean('is_shared').nullable()
    })

    this.defer(async (db) => {
      const cards = await db.from(this.tableName).count('* as total').first()
      if (Number(cards?.total ?? 0) === 0) return

      const owner =
        (await db
          .from('users')
          .where('is_admin', true)
          .orderBy('id', 'asc')
          .select('id')
          .first()) ?? (await db.from('users').orderBy('id', 'asc').select('id').first())

      if (!owner) {
        throw new Error(
          `${this.tableName} porte des cartes mais la table « users » est vide : ` +
            `impossible de leur attribuer un propriétaire. Crée un compte via l'écran ` +
            `d'installation puis relance la migration.`
        )
      }

      await db.from(this.tableName).update({ owner_id: owner.id, is_shared: true })
    })

    this.schema.alterTable(this.tableName, (table) => {
      // Défaut BASE `true`, filet pour ce qui contourne le service — voir le commentaire
      // identique de `…_add_owner_to_leitner_categories_table`. `LeitnerCatalogService`
      // pose toujours une valeur explicite (`false` par défaut) : ce défaut ne joue que
      // pour ce qui écrit hors du service (SQL à la main, tests).
      table.boolean('is_shared').notNullable().defaultTo(true).alter()
      table.index(['owner_id'])
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropIndex(['owner_id'])
      table.dropColumn('is_shared')
      table.dropColumn('owner_id')
    })
  }
}
