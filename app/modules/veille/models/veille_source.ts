import { DateTime } from 'luxon'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import veilleConfig from '#config/veille'
import VeilleItem from '#modules/veille/models/veille_item'
import { parseTimeOfDay, type ScheduleMode } from '#modules/veille/shared/interval'

/**
 * Provenance. `rss` couvre RSS 2.0 *et* Atom (même collecteur, même parseur) ; `immich` est
 * l'album de veille d'une instance Immich (CC-55) ; `youtube` la playlist « Veille » dédiée
 * (CC-87).
 *
 * ⚠️ **Aucune contrainte en base** : `kind` est un `string(16)` avec un défaut `'rss'`
 * (migration `…191400`). Ajouter une provenance ne demande donc pas de migration — mais
 * `VeilleCollectorService` doit savoir l'aiguiller, faute de quoi la source partirait au
 * collecteur RSS et échouerait à chaque passe.
 */
export type SourceKind = 'rss' | 'immich' | 'youtube'

/**
 * La source Immich est **auto-provisionnée depuis l'environnement**, jamais créée par un
 * formulaire : `sourceValidator` impose `isPublicFeedUrl`, qui refuse cette forme d'`url`.
 * Voir `ImmichCollector.ensureSource()`.
 */
export const IMMICH_SOURCE_URL_PREFIX = 'immich:album:'

/**
 * Idem pour la playlist YouTube : `youtube:playlist:<id>` n'est pas une URL http, donc
 * `isPublicFeedUrl` la refuse et aucun formulaire ne peut créer cette source.
 * Voir `YoutubeCollector.ensureSource()`.
 *
 * ⚠️ **Cette valeur n'est jamais une cible réseau.** Le collecteur ne lit pas l'`url` de la
 * source : il lit `config/youtube.ts`. La colonne ne sert qu'à identifier la playlist configurée
 * et à détecter qu'elle a changé.
 */
export const YOUTUBE_SOURCE_URL_PREFIX = 'youtube:playlist:'

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

  /**
   * Dernière collecte — **`null` tant qu'il n'y en a pas eu**, et le défaut est **en base**, pas
   * sur le modèle (migration `…191400`, colonne `nullable()`).
   *
   * ⚠️ Même piège que `scheduleMode` juste au-dessus : une instance rendue par `create()` sans ce
   * champ le porte à `undefined` en mémoire, pas à `null`. Un test strict `=== null` le manquerait,
   * et `.plus()` lèverait sur `undefined` (CC-102). `isDue()` normalise donc les deux formes en
   * entrée plutôt que de comparer à `null` en trois endroits.
   */
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
   *
   * ⚠️ **Deux champs voisins gardent l'exposition que CC-102 a retirée à `lastFetchedAt`, et elle
   * est pire.** `active` et `fetchIntervalMinutes` ont eux aussi leur défaut en base : sur une
   * instance non hydratée, `!undefined` fait rendre `false` — la source n'est **jamais** due, sans
   * la moindre erreur. Un plantage se voit ; ça, non. C'est inatteignable aujourd'hui parce que
   * les **trois** sites de création passent ces deux champs explicitement
   * (`veille_sources_controller.ts`, `immich_collector.ts`, `youtube_collector.ts`) — une omission
   * suffirait. Leur poser un repli en dur ici dupliquerait les défauts de la migration dans le
   * modèle : deux sources de vérité pour une même valeur, qui divergeraient au premier changement.
   */
  isDue(now: DateTime = DateTime.now()): boolean {
    if (!this.active) return false

    /**
     * ⚠️ **`undefined` et `null` disent la même chose ici — « jamais collectée » — et il faut les
     * traiter ensemble** (CC-102). Le défaut de `last_fetched_at` est en base : `create()` laisse
     * le champ `undefined` en mémoire. Comparer à `null` en trois endroits le manquait, avec deux
     * conséquences de gravité inégale : `.plus()` **levait** dans la branche intervalle, tandis que
     * la branche horaire répondait simplement `false` — `undefined < window` est faux — donc une
     * source neuve n'y collectait jamais, en silence.
     *
     * ⚠️ **`??`, pas `== null` ni `!lastFetchedAt`.** Le premier est refusé par `eqeqeq`, réglé en
     * `always` sans exception pour `null`. Le second marcherait — aucune valeur falsy n'est valide
     * pour un `DateTime` — mais poser un test de truthiness dans un modèle après ce que CC-101 a
     * coûté serait une invitation à recommencer ailleurs, là où une valeur falsy est légitime.
     */
    const lastFetchedAt = this.lastFetchedAt ?? null

    if (this.scheduleMode === 'daily') {
      const at = parseTimeOfDay(this.dailyAt)

      // ⚠️ Une heure absente ou illisible **ne fige pas la source** : on retombe sur la branche
      // intervalle. La contrainte `veille_sources_schedule_check` rend ce cas inatteignable,
      // mais si l'invariant tombait, un `return false` la rendrait muette pour toujours — sans
      // erreur ni log, dans une boucle de fond que personne ne regarde. Une source qui collecte
      // à la mauvaise cadence se voit ; une source qui ne collecte plus, non. Le repli va donc
      // vers le comportement visible.
      if (at !== null) {
        if (lastFetchedAt === null) return true

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
        return now >= window && lastFetchedAt < window
      }
    }

    if (lastFetchedAt === null) return true
    return lastFetchedAt.plus({ minutes: this.fetchIntervalMinutes }) <= now
  }
}
