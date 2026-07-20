import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'veille_sources'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      // `kind` porte la provenance — c'est ici qu'elle vit, pas dans `veille_items.type`.
      // Le lot 1 ne connaît que `rss` (qui couvre aussi l'Atom : même collecteur, même parseur).
      table.string('kind', 16).notNullable().defaultTo('rss')

      // `text` et non `varchar(255)` : les URL de flux dépassent régulièrement 255 caractères
      // (paramètres de campagne, identifiants de chaîne YouTube). Une troncature ici, c'est un
      // 500 en pleine collecte.
      table.text('url').notNullable().unique()
      table.text('title').notNullable()

      // Cadence en minutes. Le planificateur ne réveille une source que si
      // `last_fetched_at + fetch_interval_minutes` est dépassé.
      table.integer('fetch_interval_minutes').notNullable().defaultTo(60)

      // Cache HTTP : renvoyés tels quels au serveur pour obtenir un 304 et éviter un re-parse.
      // ⚠️ Ils ne sont écrits qu'APRÈS insertion réussie des items — voir le service de collecte.
      table.text('etag').nullable()
      table.text('last_modified').nullable()

      table.timestamp('last_fetched_at').nullable()

      // Message d'échec, affiché tel quel sur la source. Un flux mort qui échoue en silence
      // est le mode de panne le plus courant d'un agrégateur : au bout d'un mois on croit
      // que le sujet est calme.
      table.text('last_error').nullable()
      table.timestamp('last_error_at').nullable()

      // Nombre d'entrées reconnues à la dernière collecte réussie. Un flux qui répond 200 avec
      // un XML valide mais 0 entrée n'est pas une erreur : sans ce compteur, il paraît sain.
      table.integer('last_item_count').nullable()

      table.boolean('active').notNullable().defaultTo(true)

      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
