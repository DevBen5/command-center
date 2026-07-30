import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import LeitnerCardProgress from '#modules/leitner/models/leitner_card_progress'
import LeitnerReview from '#modules/leitner/models/leitner_review'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'

/**
 * Une carte est du **contenu communal** : elle ne porte aucun `user_id`, et supprimer un
 * compte ne la touche pas (CC-77). Sa boîte et son échéance ne sont donc plus des
 * colonnes d'ici — elles vivent dans `LeitnerCardProgress`, une par personne.
 *
 * ⚠️ **`updatedAt` ne dit plus « dernière révision », il dit « dernière modification du
 * contenu »** : éditer un recto le bouge, noter la carte non. L'ordre de la file lit
 * l'`updatedAt` de la **progression** — voir `LeitnerService.dueCards`.
 */
export default class LeitnerCard extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare front: string

  @column()
  declare back: string

  // Classement de la carte : un thème, lui-même rattaché à une catégorie.
  // `null` = carte non classée.
  @column()
  declare leitnerThemeId: number | null

  @belongsTo(() => LeitnerTheme)
  declare theme: BelongsTo<typeof LeitnerTheme>

  @hasMany(() => LeitnerReview)
  declare reviews: HasMany<typeof LeitnerReview>

  /** Une ligne par personne l'ayant déjà notée — jamais une par carte. */
  @hasMany(() => LeitnerCardProgress)
  declare progress: HasMany<typeof LeitnerCardProgress>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
