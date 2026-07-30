import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * La progression d'une personne sur une carte — ce que `leitner_cards.box` et
 * `leitner_cards.next_review` portaient pour tout le monde à la fois (CC-119).
 *
 * ⚠️ **Le sens des `CASCADE` n'est pas symétrique, et c'est le principe directeur de
 * CC-77.** Cette table est une donnée **personnelle** : elle référence l'utilisateur,
 * donc elle part avec lui. Le contenu, lui, ne référence jamais personne — supprimer un
 * compte ne touche aucune carte. C'est ce qui rend la suppression d'un utilisateur sûre
 * *par construction*, sans vérification de dépendances.
 *
 * La cascade sur `leitner_card_id` dit autre chose : une progression sur une carte qui
 * n'existe plus n'a pas de sens. Même raisonnement que `leitner_reviews`.
 *
 * ⚠️ **L'absence de ligne est une valeur, pas un trou** : elle vaut « boîte 1, due
 * aujourd'hui ». Rien n'est semé à la création d'un compte, ni à celle d'une carte —
 * sans quoi un compte créé avant une carte ne la verrait jamais, et il faudrait un
 * re-semis à chaque ajout. La ligne naît à la première note.
 */
export default class extends BaseSchema {
  protected tableName = 'leitner_card_progress'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table
        .integer('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table
        .integer('leitner_card_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('leitner_cards')
        .onDelete('CASCADE')

      table.integer('box').notNullable().defaultTo(1)
      table.date('next_review').notNullable()

      table.timestamp('created_at')
      // ⚠️ **C'est cette colonne qui porte l'ordre de la file**, depuis CC-119 : elle a
      // remplacé `leitner_cards.updated_at`, qui ne bouge plus à la note. Une carte
      // notée `again` reste due le jour même et repart en fin de file **parce que** sa
      // progression vient d'être écrite. Voir `LeitnerService.dueCards`.
      table.timestamp('updated_at')

      // Une seule progression par (personne, carte). C'est aussi le rempart contre deux
      // onglets qui noteraient la même carte pour la première fois au même instant :
      // l'échec est bruyant, jamais une double ligne.
      table.unique(['user_id', 'leitner_card_id'])
      // La file est toujours interrogée par (personne, échéance).
      table.index(['user_id', 'next_review'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
