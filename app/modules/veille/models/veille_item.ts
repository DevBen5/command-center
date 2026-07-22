import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import VeilleSource from '#modules/veille/models/veille_source'

/**
 * Ce qu'est l'item, pas d'où il vient — la provenance est portée par `veille_sources.kind`.
 * `bookmark` et `note` restent les deux formes de capture manuelle ; `image` et `video` sont
 * les assets Immich (CC-55), qui ne sont pas « des items Immich » mais des médias qui se
 * trouvent venir d'Immich.
 *
 * ⚠️ Cette liste est dupliquée dans la contrainte `veille_items_type_check` (migration `…403`)
 * et dans `captureValidator` (VineJS) — mais **`captureValidator` ne porte volontairement pas
 * `image` ni `video`** : ces deux-là ne sont *créables* que par une collecte, la capture manuelle
 * n'ayant aucun moyen de téléverser un média. Les autoriser au formulaire créerait des items
 * média sans asset derrière, dont la vignette n'existerait pas.
 */
export type VeilleItemType = 'article' | 'bookmark' | 'note' | 'image' | 'video'

/** Les deux types portés par un asset Immich — ceux qui ont une vignette et un lien de lecture. */
export const MEDIA_TYPES = ['image', 'video'] as const

export default class VeilleItem extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare type: VeilleItemType

  /** Nul pour une capture manuelle. */
  @column()
  declare veilleSourceId: number | null

  /**
   * Clé de déduplication, sous index unique. Nulle pour les captures manuelles : Postgres
   * autorise plusieurs NULL dans un index unique, elles ne se bloquent donc jamais entre elles.
   */
  @column()
  declare dedupKey: string | null

  @column()
  declare url: string | null

  @column()
  declare title: string

  /** Texte brut : le HTML du flux est réduit à du texte à la collecte, jamais stocké tel quel. */
  @column()
  declare content: string | null

  @column()
  declare tags: string[]

  @column({ prepare: (value: Record<string, unknown>) => JSON.stringify(value) })
  declare metadata: Record<string, unknown>

  @column()
  declare readingQueue: boolean

  /** Date annoncée par le flux. Nulle si absent — le tri retombe alors sur `createdAt`. */
  @column.dateTime()
  declare publishedAt: DateTime | null

  /** Nul tant que l'item n'a pas été lu. Un timestamp plutôt qu'un booléen : on sait *quand*. */
  @column.dateTime()
  declare readAt: DateTime | null

  /**
   * L'asset n'est plus dans l'album de veille (CC-55), constaté par différence à la collecte.
   * Nul dans tous les autres cas — y compris pour un article, qui n'a rien à quitter.
   *
   * ⚠️ « Indisponible », pas « supprimé » : la différence ne sait pas distinguer un asset retiré
   * de l'album d'un asset effacé d'Immich, et ne le prétend pas. La colonne redevient nulle si
   * l'asset revient dans l'album.
   */
  @column.dateTime()
  declare unavailableAt: DateTime | null

  /**
   * L'utilisateur a supprimé cet item (CC-63). **La ligne reste, elle est masquée.**
   *
   * ⚠️ **Une vraie suppression ferait revenir l'item.** `dedup_key` est sous index UNIQUE et
   * c'est la seule chose qui empêche un doublon : ligne supprimée = clé libérée = réinsertion à
   * la passe suivante. La pierre tombale garde la clé occupée sans que le collecteur change.
   *
   * ⚠️ **Rien ne défait ça côté collecte**, à la différence d'`unavailableAt` qui est un constat
   * réversible. Un asset remis dans l'album ne ressuscite pas un item volontairement supprimé —
   * y compris s'il est restauré depuis la corbeille d'Immich. C'est une limite assumée : les
   * 30 jours d'Immich récupèrent les octets, pas cette ligne.
   */
  @column.dateTime()
  declare deletedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => VeilleSource)
  declare source: BelongsTo<typeof VeilleSource>

  /**
   * Les items que l'utilisateur n'a pas supprimés — **le point d'entrée de toute lecture Lucid**
   * de ce module (CC-63).
   *
   * ⚠️ **Ce n'est pas du confort : c'est ce qui rend le filtre auditable.** La pierre tombale
   * n'a de valeur que si *chaque* lecture l'honore, et un filtre oublié ne se voit nulle part
   * — l'item réapparaît simplement, dans une liste, un compteur ou une page. Un nom unique donne
   * une réponse greppable à « toutes les lectures filtrent-elles ? ».
   *
   * ⚠️ **Les lectures en SQL brut ne passent pas par ici** et portent le filtre en clair :
   * les deux agrégats de `VeilleStatsService` et les deux requêtes de `ImmichCollector.reconcile`.
   * La liste complète des endroits vit dans le `CLAUDE.md` du module — tiens-la à jour en même
   * temps que le code.
   */
  static visible() {
    return this.query().whereNull('deleted_at')
  }
}
