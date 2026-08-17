import { DateTime } from 'luxon'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import LeitnerCourseSection from '#modules/leitner/models/leitner_course_section'

/** D'où vient un cours : collé/téléversé sur `/revision/cours`, ou né d'une ingestion. */
export type CourseSource = 'paste' | 'file' | 'ingest'

/**
 * Un cours ingéré, gardé en base pour être relu — le corpus (CC-251). Content au sens
 * du module : `ownerId` en `SET NULL`, `isShared` gouverne la visibilité, voir
 * `services/leitner_visibility.ts`.
 */
export default class LeitnerCourse extends BaseModel {
  static table = 'leitner_courses'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare title: string

  /** La source Markdown — c'est elle qui compte, le rendu se dérive à la lecture. */
  @column()
  declare markdown: string

  @column()
  declare contentHash: string

  @column()
  declare source: CourseSource

  /** `null` = orphelin (propriétaire supprimé). Voir CC-139. */
  @column()
  declare ownerId: number | null

  /** Visible de tout le monde si `true` ; sinon seulement de `ownerId`. Privé par défaut. */
  @column()
  declare isShared: boolean

  @hasMany(() => LeitnerCourseSection, { foreignKey: 'courseId' })
  declare sections: HasMany<typeof LeitnerCourseSection>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
