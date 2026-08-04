import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Le rôle « Lecteur » devient une donnée de référence portée par une migration (CC-138).
 *
 * Il vivait dans `user_seeder.ts`, supprimé avec les deux seeders de démo : c'était la seule
 * chose du seeder à *déplacer* plutôt qu'à perdre — un rôle de départ, pour que l'écran
 * d'administration ne s'ouvre pas sur une liste vide. Il ne donne que de la lecture : en
 * accorder plus par défaut irait contre le principe même de l'écran qui distribue les droits.
 *
 * ⚠️ **Idempotente, et c'est requis** : la base de dev et la production portent déjà ce rôle,
 * posé par le seeder du temps où il existait. `on conflict … do nothing` sur les contraintes
 * d'unicité (`roles.name`, `role_capabilities (role_id, capability)`) — jamais un insert nu,
 * qui casserait la migration précisément là où le rôle existe déjà. En SQL paramétré :
 * l'InsertQueryBuilder de Lucid n'expose pas `onConflict`.
 *
 * ⚠️ **Les capacités sont écrites même si leur module est désactivé** (`MODULES`, CC-137) —
 * même comportement que le seeder : une chaîne `leitner.view` en base est inerte tant que le
 * module ne l'enregistre pas au registre, et le rôle est prêt le jour où on l'allume.
 */
export default class extends BaseSchema {
  async up() {
    this.defer(async (db) => {
      await db.rawQuery(
        `insert into roles (name, created_at, updated_at) values (?, now(), now())
         on conflict (name) do nothing`,
        ['Lecteur']
      )

      const lecteur = await db.from('roles').where('name', 'Lecteur').select('id').first()

      for (const capability of ['dashboard.view', 'leitner.view', 'veille.view']) {
        await db.rawQuery(
          `insert into role_capabilities (role_id, capability, created_at) values (?, ?, now())
           on conflict (role_id, capability) do nothing`,
          [lecteur.id, capability]
        )
      }
    })
  }

  /**
   * ⚠️ Le `down` ne supprime RIEN, délibérément. Sur une base réelle, le rôle peut avoir été
   * renommé, enrichi depuis `/admin/roles`, ou porter des comptes : le détruire au rollback
   * emporterait un état que l'utilisateur a construit. Un rollback de cette migration laisse
   * donc le rôle en place — c'est une donnée, pas du schéma.
   */
  async down() {}
}
