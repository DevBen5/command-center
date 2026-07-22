import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * CC-59 — un second mode d'ordonnancement : « tous les jours à 7h », en plus de l'intervalle.
 *
 * ⚠️ **Les lignes existantes ne perdent rien.** Le défaut `'interval'` les bascule toutes dans le
 * mode historique, `fetch_interval_minutes` n'est pas touché : une source réglée à 2 jours reste
 * réglée à 2 jours. La base porte l'unique exemplaire des sources — cette migration ne réécrit
 * aucune donnée, elle ajoute deux colonnes.
 */
export default class extends BaseSchema {
  protected tableName = 'veille_sources'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      // Le discriminant. `interval` = la cadence historique (« N minutes après la dernière
      // collecte »), `daily` = une heure murale, qui se réancre chaque jour au lieu de dériver.
      table.string('schedule_mode', 16).notNullable().defaultTo('interval')

      // L'heure du jour, en mode `daily` uniquement. `time` (sans fuseau) : le fuseau
      // d'interprétation est celui de l'application (`APP_TIMEZONE`), jamais celui de la ligne.
      table.time('daily_at').nullable()
    })

    /**
     * ⚠️ **Une seule contrainte, qui porte deux règles.**
     *
     * L'énumération : toute valeur autre que `interval` / `daily` échoue les deux branches. Et la
     * cohérence : un mode `daily` sans heure serait une source que `isDue()` ne saurait pas
     * situer, un mode `interval` avec une heure une ligne portant deux réglages dont un seul
     * s'applique — impossible à lire correctement en base sans relire le code.
     *
     * Cette contrainte est ce qui rend inatteignable la branche de repli de `isDue()`.
     */
    this.schema.raw(`
      ALTER TABLE ${this.tableName}
      ADD CONSTRAINT veille_sources_schedule_check CHECK (
        (schedule_mode = 'interval' AND daily_at IS NULL)
        OR (schedule_mode = 'daily' AND daily_at IS NOT NULL)
      )
    `)
  }

  async down() {
    this.schema.raw(
      `ALTER TABLE ${this.tableName} DROP CONSTRAINT IF EXISTS veille_sources_schedule_check`
    )
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('schedule_mode')
      table.dropColumn('daily_at')
    })
  }
}
