import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import LeitnerCardProgress from '#modules/leitner/models/leitner_card_progress'
import LeitnerCardSection from '#modules/leitner/models/leitner_card_section'
import LeitnerReview from '#modules/leitner/models/leitner_review'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'

/**
 * Une carte porte un propriétaire depuis CC-139 (`ownerId` + `isShared`, privé par
 * défaut) : voir `app/modules/leitner/CLAUDE.md`. Sa boîte et son échéance restent hors
 * d'ici — elles vivent dans `LeitnerCardProgress`, une par personne, inchangé depuis
 * CC-77/CC-119.
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

  /** `null` = orpheline (propriétaire supprimé). Voir CC-139. */
  @column()
  declare ownerId: number | null

  /** Visible de tout le monde si `true` ; sinon seulement de `ownerId`. Privé par défaut. */
  @column()
  declare isShared: boolean

  @belongsTo(() => LeitnerTheme)
  declare theme: BelongsTo<typeof LeitnerTheme>

  @hasMany(() => LeitnerReview)
  declare reviews: HasMany<typeof LeitnerReview>

  /** Une ligne par personne l'ayant déjà notée — jamais une par carte. */
  @hasMany(() => LeitnerCardProgress)
  declare progress: HasMany<typeof LeitnerCardProgress>

  /** Ses sections de provenance (CC-253) — voir `leitner_card_sections_service.ts`. */
  @hasMany(() => LeitnerCardSection, { foreignKey: 'leitnerCardId' })
  declare cardSections: HasMany<typeof LeitnerCardSection>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
