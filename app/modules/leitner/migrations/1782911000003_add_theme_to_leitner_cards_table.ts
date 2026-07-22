import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'leitner_cards'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // Un thème supprimé ne doit pas emporter ses cartes : elles retombent
      // simplement « non classées ».
      table
        .integer('leitner_theme_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('leitner_themes')
        .onDelete('SET NULL')
    })

    // Reprise des `tags` avant leur suppression : le premier tag de chaque carte
    // devient un thème sous la catégorie « Import », à reclasser depuis l'écran de
    // gestion. Les tags suivants sont perdus (le classement est désormais unique).
    this.defer(async (db) => {
      const cards = await db
        .from(this.tableName)
        .select('id', 'tags')
        .whereRaw('array_length(tags, 1) > 0')

      if (cards.length === 0) return

      // Les deux tables viennent d'être créées par les migrations précédentes :
      // elles sont vides, aucun conflit de nom n'est possible ici.
      const now = new Date()
      await db
        .table('leitner_categories')
        .insert({ name: 'Import', created_at: now, updated_at: now })
      const category = await db.from('leitner_categories').where('name', 'Import').firstOrFail()

      const themeIds = new Map<string, number>()
      for (const card of cards) {
        const name = String(card.tags[0]).slice(0, 60)

        if (!themeIds.has(name)) {
          await db.table('leitner_themes').insert({
            leitner_category_id: category.id,
            name,
            created_at: now,
            updated_at: now,
          })
          const theme = await db
            .from('leitner_themes')
            .where('leitner_category_id', category.id)
            .where('name', name)
            .firstOrFail()
          themeIds.set(name, theme.id)
        }

        await db
          .from(this.tableName)
          .where('id', card.id)
          .update({ leitner_theme_id: themeIds.get(name)! })
      }
    })

    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('tags')
    })
  }

  async down() {
    // La colonne `tags` est recréée vide : son contenu n'est pas reconstruit
    // depuis les thèmes.
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('leitner_theme_id')
      table.specificType('tags', 'text[]').notNullable().defaultTo('{}')
    })
  }
}
