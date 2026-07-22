import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // ⚠️ `is_admin` est un booléen, jamais une capacité « * ». Une liste qui contiendrait
      // tout devrait être tenue à jour à chaque ajout de capacité — et c'est exactement
      // l'oubli qu'on cherche à rendre impossible.
      table.boolean('is_admin').notNullable().defaultTo(false)
      // Désactiver, jamais supprimer : aucune table métier n'a de `user_id` aujourd'hui,
      // une suppression poserait une question de données rattachées qui n'existe pas encore.
      table.boolean('is_active').notNullable().defaultTo(true)
      table.integer('role_id').nullable().references('id').inTable('roles').onDelete('SET NULL')
    })

    // ⚠️ **Sans cette ligne, la migration enferme le propriétaire dehors — en silence.**
    // Le défaut `false` s'appliquerait aux comptes déjà en base : au prochain
    // `migration:run`, le compte existant perdrait Services, Agents et l'écran
    // d'administration, sans erreur et **sans moyen de se réaccorder le droit depuis
    // l'application** — la réparation ne se ferait qu'en SQL.
    //
    // Ça n'élargit rien : avant ce lot, tout compte authentifié pouvait déjà tout faire.
    // La migration préserve l'état existant ; le défaut `false` ne vaut que pour la suite.
    this.defer(async (db) => {
      await db.from(this.tableName).update({ is_admin: true })
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('role_id')
      table.dropColumn('is_active')
      table.dropColumn('is_admin')
    })
  }
}
