import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'user_invitations'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      // ⚠️ Le jeton n'est **jamais** stocké en clair : seule son empreinte SHA-256 vit ici.
      // Une fuite de la base ne donne donc aucun lien utilisable. SHA-256 nu suffit — le
      // jeton est 32 octets aléatoires, il n'y a pas de dictionnaire à lui opposer, et un
      // hachage lent (scrypt) coûterait à chaque ouverture du lien sans rien ajouter.
      table.string('token_hash', 64).notNullable().unique()
      table.timestamp('expires_at').notNullable()
      // Usage unique : renseigné à la première utilisation réussie.
      table.timestamp('used_at').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
