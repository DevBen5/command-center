import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * `box` et `next_review` quittent `leitner_cards` pour `leitner_card_progress` (CC-119).
 * La progression existante devient celle du propriétaire.
 *
 * ⚠️ **Les colonnes sont supprimées dans le même lot que leur remplacement, et c'est
 * délibéré.** Les laisser en place « le temps de migrer les lectures » donnerait deux
 * sources de vérité pour la même question — l'état qui diverge en silence. Les retirer
 * fait du typecheck la liste **exhaustive** des sites à traiter : tout ce qui lisait
 * `card.box` cesse de compiler, rien ne peut être oublié.
 *
 * ⚠️ **Toutes les cartes sont migrées, y compris celles restées en boîte 1 et dues le
 * jour même** — donc y compris celles qui auraient exactement le sens de l'absence de
 * ligne. Deviner lesquelles sont « neuves » demanderait de lire l'historique ; poser la
 * ligne telle quelle préserve l'échéance réelle du propriétaire, ce qui est le seul
 * objectif ici. Une ligne redondante ne coûte rien, une échéance perdue si.
 *
 * Le propriétaire se déduit comme dans `…_add_user_to_leitner_reviews_table` : premier
 * compte administrateur, à défaut premier compte. La règle est recopiée plutôt
 * qu'importée — une migration est de l'histoire figée, elle ne doit pas casser parce
 * qu'un helper a bougé.
 */
export default class extends BaseSchema {
  protected tableName = 'leitner_cards'

  async up() {
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

      // ⚠️ On lève plutôt que d'inventer : une progression sans compte à qui l'attribuer
      // est un état qu'on ne sait pas interpréter, et l'abandonner en silence perdrait
      // le planning réel du propriétaire — la seule donnée que ce lot risque de casser.
      if (!owner) {
        throw new Error(
          `${this.tableName} porte des cartes mais la table « users » est vide : ` +
            `impossible d'attribuer leur progression. Seede un compte ` +
            `(ADMIN_PASSWORD + « node ace db:seed ») puis relance la migration.`
        )
      }

      const now = new Date()
      await db.rawQuery(
        `INSERT INTO leitner_card_progress
           (user_id, leitner_card_id, box, next_review, created_at, updated_at)
         SELECT ?, c.id, c.box, c.next_review, ?, c.updated_at
         FROM leitner_cards c
         ON CONFLICT (user_id, leitner_card_id) DO NOTHING`,
        [owner.id, now]
      )
    })

    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('box')
      table.dropColumn('next_review')
    })
  }

  /**
   * Le retour en arrière est **complet pour le propriétaire, et pour lui seul** : les
   * colonnes ne peuvent porter qu'une progression. Celle des autres comptes reste dans
   * `leitner_card_progress`, que la migration précédente supprimera.
   */
  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.integer('box').notNullable().defaultTo(1)
      table.date('next_review').nullable()
    })

    this.defer(async (db) => {
      const owner =
        (await db
          .from('users')
          .where('is_admin', true)
          .orderBy('id', 'asc')
          .select('id')
          .first()) ?? (await db.from('users').orderBy('id', 'asc').select('id').first())

      if (owner) {
        await db.rawQuery(
          `UPDATE leitner_cards c
              SET box = p.box, next_review = p.next_review
             FROM leitner_card_progress p
            WHERE p.leitner_card_id = c.id AND p.user_id = ?`,
          [owner.id]
        )
      }

      // Les cartes sans progression reprennent le défaut d'une carte neuve.
      await db.from(this.tableName).whereNull('next_review').update({ next_review: new Date() })
    })

    this.schema.alterTable(this.tableName, (table) => {
      table.date('next_review').notNullable().alter()
    })
  }
}
