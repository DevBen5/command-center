import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Le catalogue des sources — lot 1 de l'épique CC-224 (CC-225). Une ligne par élément découvert
 * dans une source externe (dossier verrouillé Immich, demain le NAS), indépendamment de toute
 * entrée du coffre.
 *
 * ⚠️ **Table EN CLAIR, décision de l'épique — mais elle ne porte AUCUN secret pour autant.**
 * `reference` est un UUID Immich ou un chemin RELATIF à une racine configurée en `.env`, jamais un
 * chemin absolu du système hôte (voir `NasRootsService`, CC-181) et jamais un jeton de session.
 * Contrairement à `coffre_entries.title_cipher`, rien ici ne demande à être déchiffré : c'est un
 * jeu de données différent (ce que les sources contiennent), pas ce que l'utilisateur a écrit.
 *
 * ⚠️ **`owner_id` NOT NULL — le catalogue est PAR COMPTE, pas partagé**, décision explicite du
 * cadrage de CC-225 malgré des sources installation-wide (un seul compte Immich, des racines NAS
 * communes à `.env`) : chaque compte porte sa propre copie indexée du même contenu physique.
 * Duplication assumée en base, jamais de requête réseau dupliquée — la synchronisation énumère
 * une source une seule fois et applique le résultat à chaque owner.
 *
 * ⚠️ **`entry_id` nullable, posé dès ce lot mais non exploité.** Anticipe le rattachement d'une
 * entrée du coffre à un élément du catalogue (lot 3, écran de consultation) sans figer la logique
 * de rattachement maintenant. `SET NULL` à la suppression d'une entrée : l'élément du catalogue
 * survit à la suppression de l'entrée qui le référençait, il continue d'exister dans sa source.
 *
 * ⚠️ **`source`/`nature` en CHECK, pas un enum natif** — même doctrine que `coffre_entries.type`
 * et `coffre_entry_nas_file.kind` : ajouter une valeur future (une nouvelle source, CC-224 lot 2)
 * est un `DROP`/`ADD CONSTRAINT`, jamais un `ALTER TYPE`.
 *
 * ⚠️ **`missing_since` porte l'absence, la ligne n'est jamais supprimée.** Un élément disparu de
 * sa source ne se supprime pas en silence (NAS démonté, session Immich expirée rendraient un
 * listing vide) — voir `catalog_sync_service.ts` pour la règle : le marquage n'a lieu que sur une
 * énumération qui a réellement réussi, jamais sur un échec ni une énumération tronquée.
 */
export default class extends BaseSchema {
  protected tableName = 'coffre_catalog_items'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table
        .integer('owner_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      table
        .integer('entry_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('coffre_entries')
        .onDelete('SET NULL')

      table.enum('source', ['immich_locked', 'nas']).notNullable()
      table.text('reference').notNullable()
      table.enum('nature', ['photo', 'video', 'other']).notNullable()

      table.text('display_name').nullable()
      table.timestamp('captured_at').nullable()
      table.bigInteger('size_bytes').nullable()

      table.timestamp('discovered_at').notNullable()
      table.timestamp('last_seen_at').notNullable()
      table.timestamp('missing_since').nullable()

      table.unique(['owner_id', 'source', 'reference'])
      table.index(['owner_id'])
      table.index(['entry_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
