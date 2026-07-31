import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Les codes de secours : la porte qui reste quand le téléphone est perdu (CC-114).
 *
 * ⚠️ **Ils ne sont pas chiffrés avec APP_KEY, ils sont hachés — et c'est délibéré.** Une
 * APP_KEY changée ou perdue rend tous les `totp_secret` illisibles d'un coup ; si les codes
 * de secours dépendaient de la même clé, ils tomberaient avec ce qu'ils sont censés
 * rattraper. Hachés, ils survivent à ce qu'ils secourent.
 */
export default class extends BaseSchema {
  protected tableName = 'user_recovery_codes'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      // `CASCADE`, comme `user_capabilities` et `user_invitations` : ces lignes n'existent
      // que pour ce compte, et rien de partagé n'y pend. C'est ce qui garde vraie la
      // conclusion de CC-80 — un compte reste supprimable sans emporter de contenu.
      table.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')

      // Empreinte SHA-256 nue, exactement comme les jetons d'invitation et pour la même
      // raison : le code est tiré par la machine (40 bits d'aléa), il n'existe aucun
      // dictionnaire à lui opposer. Un hachage lent coûterait à chaque vérification sans
      // rien ajouter. Indexée : la vérification cherche par empreinte, jamais en comparant.
      table.string('code_hash', 64).notNullable().index()

      // Usage unique. La consommation est un UPDATE conditionnel sur cette colonne : c'est
      // la base qui rend l'opération atomique, pas un lire-puis-écrire côté application.
      table.timestamp('used_at').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
