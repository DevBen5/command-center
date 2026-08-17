import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import LeitnerCourse from '#modules/leitner/models/leitner_course'

/**
 * Une section d'un cours, découpée par titres (CC-251) — sans recouvrement, contrairement
 * à `chunkCourse`. `slug` est le chemin de titres, stable à la ré-édition : c'est lui que
 * pointera une carte de provenance (ticket suivant).
 *
 * ⚠️ Ne porte PAS `ownerId`/`isShared` : sa visibilité se dérive de son cours par
 * jointure, jamais dupliquée — même doctrine que `LeitnerDraftCard`.
 */
export default class LeitnerCourseSection extends BaseModel {
  static table = 'leitner_course_sections'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare courseId: number

  @column()
  declare slug: string

  /**
   * Le chemin de titres affiché, ex. `['Réseaux', 'TLS', 'Handshake']`.
   *
   * ⚠️ `prepare: JSON.stringify` — sans lui, le driver `pg` sérialise un tableau JS en
   * littéral de tableau POSTGRES (`{"TLS"}`), pas en JSON, et la colonne `jsonb` refuse
   * l'insertion (`22P02`). Ne pas confondre avec les `text[]` de veille (`tags`), qui
   * n'en veulent PAS — voir le `CLAUDE.md` du module Agents.
   */
  @column({ prepare: (value: string[]) => JSON.stringify(value) })
  declare headingPath: string[]

  @column()
  declare body: string

  /**
   * Les alias déclarés par `> notion: X, Y` sous le titre. `null` = la section n'entre
   * pas au glossaire — elle reste consultable, simplement pas indexée.
   */
  @column({ prepare: (value: string[] | null) => (value === null ? null : JSON.stringify(value)) })
  declare aliases: string[] | null

  /**
   * Pierre tombale : posée quand le slug a disparu au remplacement du markdown. Le
   * texte survit toujours — jamais de suppression physique d'une section vivante.
   * Purge = geste manuel, depuis `/revision/cours`.
   */
  @column.dateTime()
  declare obsoleteAt: DateTime | null

  @belongsTo(() => LeitnerCourse, { foreignKey: 'courseId' })
  declare course: BelongsTo<typeof LeitnerCourse>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
