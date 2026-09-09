import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import LeitnerCourseSection from '#modules/corpus/models/leitner_course_section'

export default class GlossaryTerm extends BaseModel {
  static table = 'glossary_terms'

  @column({ isPrimary: true }) declare id: number
  @column() declare term: string
  @column({ prepare: (value: string[]) => JSON.stringify(value) }) declare aliases: string[]
  @column() declare definition: string
  @column() declare leitnerCourseSectionId: number | null
  @column() declare ownerId: number | null
  @column() declare isShared: boolean
  @belongsTo(() => LeitnerCourseSection, { foreignKey: 'leitnerCourseSectionId' })
  declare courseSection: BelongsTo<typeof LeitnerCourseSection>
  @column.dateTime({ autoCreate: true }) declare createdAt: DateTime
  @column.dateTime({ autoCreate: true, autoUpdate: true }) declare updatedAt: DateTime
}
