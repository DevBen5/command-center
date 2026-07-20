import { DateTime } from 'luxon'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import veilleConfig from '#config/veille'
import VeilleItem from '#modules/veille/models/veille_item'
import { parseTimeOfDay, type ScheduleMode } from '#modules/veille/shared/interval'

/** Provenance du flux. Le lot 1 ne connaît que `rss` — qui couvre RSS 2.0 *et* Atom. */
export type SourceKind = 'rss'

export default class VeilleSource extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare kind: SourceKind

  @column()
  declare url: string

  @column()
  declare title: string

  @column()
  declare fetchIntervalMinutes: number

  /**
   * Le discriminant d'ordonnancement (CC-59). `interval` = la cadence historique, `daily` = une
   * heure murale qui se réancre chaque jour.
   *
   * ⚠️ Le défaut `'interval'` est **en base**, pas sur le modèle : une instance créée sans ce
   * champ le laisse `undefined` en mémoire. `isDue()` teste donc `=== 'daily'`, jamais
   * `=== 'interval'` — tout ce qui n'est pas explicitement horaire suit l'ancienne branche.
   */
  @column()
  declare scheduleMode: ScheduleMode

  /**
   * L'heure du jour en mode `daily`, `null` en mode `interval` — la contrainte
   * `veille_sources_schedule_check` interdit toute autre combinaison.
   *
   * Postgres rend un `time` sous la forme `'07:00:00'` : `normalizeTimeOfDay` ramène à `'HH:MM'`
   * avant l'affichage.
   */
  @column()
  declare dailyAt: string | null

  @column()
  declare etag: string | null

  @column()
  declare lastModified: string | null

  @column.dateTime()
  declare lastFetchedAt: DateTime | null

  /** Message d'échec, affichable tel quel. `null` tant que rien n'a échoué. */
  @column()
  declare lastError: string | null

  @column.dateTime()
  declare lastErrorAt: DateTime | null

  /** Entrées reconnues à la dernière collecte réussie. `0` est une anomalie, pas une erreur. */
  @column()
  declare lastItemCount: number | null

  @column()
  declare active: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @hasMany(() => VeilleItem)
  declare items: HasMany<typeof VeilleItem>

  /**
   * La source est-elle due ? Jamais collectée = due immédiatement, dans les **deux** modes :
   * c'est ce qui permet de vérifier qu'un flux qu'on vient d'ajouter fonctionne. Sans ça, une
   * source ajoutée à 14h en mode horaire resterait muette jusqu'au lendemain 7h, et on ne
   * saurait pas si l'URL est bonne.
   */
  isDue(now: DateTime = DateTime.now()): boolean {
    if (!this.active) return false

    if (this.scheduleMode === 'daily') {
      const at = parseTimeOfDay(this.dailyAt)

      // ⚠️ Une heure absente ou illisible **ne fige pas la source** : on retombe sur la branche
      // intervalle. La contrainte `veille_sources_schedule_check` rend ce cas inatteignable,
      // mais si l'invariant tombait, un `return false` la rendrait muette pour toujours — sans
      // erreur ni log, dans une boucle de fond que personne ne regarde. Une source qui collecte
      // à la mauvaise cadence se voit ; une source qui ne collecte plus, non. Le repli va donc
      // vers le comportement visible.
      if (at !== null) {
        if (this.lastFetchedAt === null) return true

        /**
         * L'horaire mural, et pourquoi ce n'est pas un intervalle déguisé.
         *
         * L'intervalle **dérive** : chaque collecte en retard décale toutes les suivantes, et le
         * « tous les jours à 7h » devient 8h30 en une semaine. Ici la fenêtre est recalculée à
         * partir du jour courant — elle se réancre au lieu de s'accumuler.
         *
         * ⚠️ **Le fuseau est celui de l'application, pas celui du process** (`TZ`, UTC ici).
         * Sans `setZone`, « 7h » se déclencherait à 9h à Paris l'été : la collecte aurait bien
         * lieu, simplement pas quand on croit — et rien ne le signalerait.
         */
        const window = now.setZone(veilleConfig.timezone).set({ ...at, second: 0, millisecond: 0 })

        // Le second membre est ce qui remplace l'intervalle : sans lui, la source serait
        // recollectée à CHAQUE tick une fois l'heure passée. C'est un test d'appartenance à une
        // fenêtre, pas un test de durée — et c'est aussi ce qui évite qu'un redémarrage à 10h
        // rejoue la collecte de 7h déjà faite.
        return now >= window && this.lastFetchedAt < window
      }
    }

    if (this.lastFetchedAt === null) return true
    return this.lastFetchedAt.plus({ minutes: this.fetchIntervalMinutes }) <= now
  }
}
