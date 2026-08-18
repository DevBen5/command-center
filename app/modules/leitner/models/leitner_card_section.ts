import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCourseSection from '#modules/leitner/models/leitner_course_section'

/** D'où vient le lien : la promotion d'un brouillon d'ingestion, ou un geste manuel. */
export type CardSectionOrigin = 'ingestion' | 'manuel'

/**
 * Le lien carte ↔ section du corpus (CC-253). Ni contenu ni brouillon : un lien entre
 * deux contenus qui portent déjà leur propriétaire — voir la migration et
 * `services/leitner_card_sections_service.ts`.
 */
export default class LeitnerCardSection extends BaseModel {
  static table = 'leitner_card_sections'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare leitnerCardId: number

  @column()
  declare leitnerCourseSectionId: number

  @column()
  declare origin: CardSectionOrigin

  @belongsTo(() => LeitnerCard, { foreignKey: 'leitnerCardId' })
  declare card: BelongsTo<typeof LeitnerCard>

  @belongsTo(() => LeitnerCourseSection, { foreignKey: 'leitnerCourseSectionId' })
  declare courseSection: BelongsTo<typeof LeitnerCourseSection>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
