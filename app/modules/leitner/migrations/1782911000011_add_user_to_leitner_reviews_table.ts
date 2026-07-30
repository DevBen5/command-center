import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * L'historique de révision devient personnel (CC-119).
 *
 * ⚠️ **Ce n'est pas un raffinement du lot « progression par personne », c'en est la
 * moitié manquante.** Trois règles de progression lisent cette table sans aucun filtre
 * d'utilisateur : la règle du 2ᵉ `hard` d'affilée (`LeitnerService.lastGrade`),
 * `wasPresentedToday` et `hasReviewedTodayInScope`. Cloisonner `box`/`next_review` sans
 * cloisonner l'historique laisserait le `hard` d'un collègue rétrograder la carte d'un
 * autre — exactement ce que l'épique CC-77 existe pour supprimer.
 *
 * ⚠️ **Le backfill attribue tout au propriétaire, et le propriétaire se déduit** — voir
 * la migration jumelle `…_move_progress_from_leitner_cards_table`, qui applique la même
 * règle. La duplication est voulue : une migration est de l'histoire figée, elle ne doit
 * pas casser parce qu'un helper a bougé.
 */
export default class extends BaseSchema {
  protected tableName = 'leitner_reviews'

  async up() {
    // Nullable d'abord : la colonne doit exister avant qu'on puisse la remplir.
    this.schema.alterTable(this.tableName, (table) => {
      table
        .integer('user_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
    })

    this.defer(async (db) => {
      const reviews = await db.from(this.tableName).count('* as total').first()
      if (Number(reviews?.total ?? 0) === 0) return

      // Le premier compte administrateur, à défaut le premier compte tout court : sur
      // une base réelle c'est celui que `ADMIN_PASSWORD` a créé, et l'historique existant
      // est le sien par construction — aucun autre compte ne pouvait réviser.
      const owner =
        (await db
          .from('users')
          .where('is_admin', true)
          .orderBy('id', 'asc')
          .select('id')
          .first()) ?? (await db.from('users').orderBy('id', 'asc').select('id').first())

      // ⚠️ **On lève plutôt que d'inventer.** Un historique sans aucun compte à qui
      // l'attribuer est un état qu'on ne sait pas interpréter ; le rattacher à un compte
      // fabriqué, ou supprimer les lignes, perdrait des données réelles en silence.
      if (!owner) {
        throw new Error(
          `${this.tableName} porte des révisions mais la table « users » est vide : ` +
            `impossible de leur attribuer un propriétaire. Seede un compte ` +
            `(ADMIN_PASSWORD + « node ace db:seed ») puis relance la migration.`
        )
      }

      await db.from(this.tableName).whereNull('user_id').update({ user_id: owner.id })
    })

    // Et seulement ensuite la contrainte : une colonne d'historique sans propriétaire
    // n'a plus de sens, mais elle ne pouvait pas naître `notNullable`.
    this.schema.alterTable(this.tableName, (table) => {
      table.integer('user_id').unsigned().notNullable().alter()
    })
    this.schema.alterTable(this.tableName, (table) => {
      // Toutes les lectures d'historique sont désormais filtrées par personne.
      table.index(['user_id', 'reviewed_at'])
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropIndex(['user_id', 'reviewed_at'])
      table.dropColumn('user_id')
    })
  }
}
