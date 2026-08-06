import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Les références de médias Immich (CC-180, lot 3 de l'épique CC-177) — une table dédiée, jamais
 * un préfixe de plus sur `dedup_key`.
 *
 * ⚠️ **`app/modules/veille/CLAUDE.md` l'annonçait déjà** : « un second module référençant les
 * mêmes médias demanderait une colonne dédiée, pas un troisième préfixe ». Le coffre est ce
 * second module — `dedup_key` reste un mécanisme interne à la veille, jamais réutilisé ici.
 *
 * ⚠️ **`asset_id_cipher` est chiffré, comme `title_cipher`** : l'UUID Immich est du contenu du
 * coffre au même titre qu'un titre de note. Il n'est déchiffré qu'à la demande, par le proxy de
 * vignette, avec la clé de session élevée — jamais chargé pour une simple liste.
 *
 * ⚠️ **`owner_id` est dénormalisé sur cette table, comme sur `coffre_entries`.** Une jointure vers
 * `coffre_entries` pour retrouver le propriétaire aurait marché, mais chaque route du module
 * autorise déjà par une clause `where('owner_id', ...)` plate — la même doctrine partout est ce
 * qui rend chaque requête inspectable isolément.
 *
 * ⚠️ **`CASCADE` sur les deux FK, comme le reste du coffre.** Une entrée supprimée ou un compte
 * supprimé laisserait sinon des `asset_id_cipher` que plus personne au monde ne peut déchiffrer —
 * pas des données, seulement des octets.
 */
export default class extends BaseSchema {
  protected tableName = 'coffre_entry_media'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('entry_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('coffre_entries')
        .onDelete('CASCADE')
      table
        .integer('owner_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      table.text('asset_id_cipher').notNullable()

      table.timestamp('created_at').notNullable()

      table.index(['entry_id'])
      table.index(['owner_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
