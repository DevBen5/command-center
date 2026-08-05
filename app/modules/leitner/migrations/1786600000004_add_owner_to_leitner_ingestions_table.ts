import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * `owner_id` + `is_shared` sur les travaux d'ingestion (CC-139). Même règle de backfill
 * que les trois migrations jumelles sur `categories`/`themes`/`cards`.
 *
 * ⚠️ **`leitner_draft_cards` ne reçoit PAS ces colonnes** : un brouillon appartient
 * toujours à exactement une ingestion (`leitner_ingestion_id` non nullable), et sa
 * visibilité se dérive par jointure sur cette ingestion plutôt que de dupliquer la
 * propriété — même doctrine que `applyScope`/`joinProgress` : une seule copie de la vérité.
 */
export default class extends BaseSchema {
  protected tableName = 'leitner_ingestions'

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
      const ingestions = await db.from(this.tableName).count('* as total').first()
      if (Number(ingestions?.total ?? 0) === 0) return

      const owner =
        (await db
          .from('users')
          .where('is_admin', true)
          .orderBy('id', 'asc')
          .select('id')
          .first()) ?? (await db.from('users').orderBy('id', 'asc').select('id').first())

      if (!owner) {
        throw new Error(
          `${this.tableName} porte des ingestions mais la table « users » est vide : ` +
            `impossible de leur attribuer un propriétaire. Crée un compte via l'écran ` +
            `d'installation puis relance la migration.`
        )
      }

      await db.from(this.tableName).update({ owner_id: owner.id, is_shared: true })
    })

    this.schema.alterTable(this.tableName, (table) => {
      // Défaut BASE `true`, filet pour ce qui contourne le service — voir le commentaire
      // identique de `…_add_owner_to_leitner_categories_table`.
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
