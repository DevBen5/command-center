import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * `owner_id` + `is_shared` sur la taxonomie (CC-139). Renverse la ligne directrice de
 * CC-119 (« le contenu ne connaît aucun utilisateur ») : voir `app/modules/leitner/CLAUDE.md`.
 *
 * ⚠️ **Le backfill pose `is_shared = true` sur TOUT l'existant, jamais `false`.** Une
 * installation déjà en usage à plusieurs comptes verrait sinon son contenu partagé
 * disparaître de la vue de tout le monde sauf le propriétaire déduit — en silence, sans
 * erreur, juste un catalogue qui paraît vide. `false` n'est le défaut que pour ce qui est
 * créé APRÈS cette migration ; il n'a aucune vocation à verrouiller rétroactivement du
 * contenu qui était visible de tous la veille.
 *
 * ⚠️ **`unique(name)` devient `unique(owner_id, name)`.** Sans ce changement, deux comptes
 * ne pourraient jamais chacun avoir une catégorie privée nommée « DevOps » : la contrainte
 * globale casserait la fonctionnalité dès le premier cas réel à deux comptes actifs.
 */
export default class extends BaseSchema {
  protected tableName = 'leitner_categories'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table
        .integer('owner_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      // Nullable ici aussi : la valeur définitive (`false`) n'arrive qu'après le backfill,
      // pour ne jamais laisser une fenêtre où une ligne existante lirait le défaut réel.
      table.boolean('is_shared').nullable()
    })

    this.defer(async (db) => {
      const categories = await db.from(this.tableName).count('* as total').first()
      if (Number(categories?.total ?? 0) === 0) return

      // Même règle que CC-119 : premier compte administrateur, à défaut premier compte.
      // Recopiée plutôt qu'importée — une migration est de l'histoire figée.
      const owner =
        (await db
          .from('users')
          .where('is_admin', true)
          .orderBy('id', 'asc')
          .select('id')
          .first()) ?? (await db.from('users').orderBy('id', 'asc').select('id').first())

      if (!owner) {
        throw new Error(
          `${this.tableName} porte des catégories mais la table « users » est vide : ` +
            `impossible de leur attribuer un propriétaire. Crée un compte via l'écran ` +
            `d'installation puis relance la migration.`
        )
      }

      await db.from(this.tableName).update({ owner_id: owner.id, is_shared: true })
    })

    this.schema.alterTable(this.tableName, (table) => {
      // ⚠️ Le défaut BASE est `true`, pas `false` — et ce n'est PAS le défaut de
      // l'APPLICATION (privé, voir `LeitnerCatalogService`, qui pose toujours une valeur
      // explicite). Ce défaut ne sert que de filet pour ce qui contourne le service :
      // SQL à la main, une future migration, un test qui insère sans le champ. Le faire
      // échouer au visible plutôt qu'à l'invisible-pour-toujours est le sens d'erreur le
      // moins coûteux à découvrir.
      table.boolean('is_shared').notNullable().defaultTo(true).alter()
      table.index(['owner_id'])
    })

    this.schema.alterTable(this.tableName, (table) => {
      table.dropUnique(['name'])
      table.unique(['owner_id', 'name'])
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropUnique(['owner_id', 'name'])
      // ⚠️ Redevient une contrainte globale : si deux catégories homonymes ont été créées
      // sous deux propriétaires différents depuis cette migration, cet `alter` échoue —
      // volontairement (refuser plutôt que fusionner en silence deux catégories distinctes).
      table.unique(['name'])
    })

    this.schema.alterTable(this.tableName, (table) => {
      table.dropIndex(['owner_id'])
      table.dropColumn('is_shared')
      table.dropColumn('owner_id')
    })
  }
}
