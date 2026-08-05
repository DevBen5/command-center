import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * `owner_id` + `is_shared` sur les thèmes (CC-139). Même règle de backfill que la
 * migration jumelle sur `leitner_categories` : voir son commentaire.
 *
 * ⚠️ **`unique(leitner_category_id, name)` ne change pas.** Un thème est déjà isolé par
 * sa catégorie, et une catégorie est désormais elle-même isolée par propriétaire (voir
 * `…_add_owner_to_leitner_categories_table`) : l'isolation par personne est donc déjà
 * transitive, sans qu'il faille toucher à cette contrainte-ci.
 */
export default class extends BaseSchema {
  protected tableName = 'leitner_themes'

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
      const themes = await db.from(this.tableName).count('* as total').first()
      if (Number(themes?.total ?? 0) === 0) return

      const owner =
        (await db
          .from('users')
          .where('is_admin', true)
          .orderBy('id', 'asc')
          .select('id')
          .first()) ?? (await db.from('users').orderBy('id', 'asc').select('id').first())

      if (!owner) {
        throw new Error(
          `${this.tableName} porte des thèmes mais la table « users » est vide : ` +
            `impossible de leur attribuer un propriétaire. Crée un compte via l'écran ` +
            `d'installation puis relance la migration.`
        )
      }

      await db.from(this.tableName).update({ owner_id: owner.id, is_shared: true })
    })

    this.schema.alterTable(this.tableName, (table) => {
      // Défaut BASE `true`, filet pour ce qui contourne le service — voir le commentaire
      // identique de la migration jumelle sur `leitner_categories`.
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
