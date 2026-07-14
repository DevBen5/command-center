import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerIngestion from '#modules/leitner/models/leitner_ingestion'

/** `pending` = en attente de relecture. Un brouillon relu ne redevient jamais `pending`. */
export type DraftStatus = 'pending' | 'accepted' | 'rejected'

/**
 * Une carte **proposée** par le LLM, rattachée à son ingestion. Ce n'est pas une carte :
 * elle n'a ni boîte ni échéance, et n'entre dans `leitner_cards` qu'après validation
 * humaine explicite (`LeitnerIngestionService.accept`).
 *
 * ⚠️ La taxonomie y est désignée **par son nom** (texte libre), jamais par un id : ce
 * que sort le modèle n'est pas fiable, et un id venu de l'extérieur casserait les
 * séquences Postgres. Les noms sont résolus — ou créés — à la promotion.
 */
export default class LeitnerDraftCard extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare leitnerIngestionId: number

  @column()
  declare front: string

  @column()
  declare back: string

  /** Nom de catégorie proposé par le modèle. `null` = carte non classée. */
  @column()
  declare category: string | null

  /** Nom de thème proposé par le modèle. Va toujours de pair avec `category`. */
  @column()
  declare theme: string | null

  @column()
  declare status: DraftStatus

  /** La carte née de ce brouillon (ou la carte existante, si c'était un doublon). */
  @column()
  declare leitnerCardId: number | null

  @belongsTo(() => LeitnerIngestion)
  declare ingestion: BelongsTo<typeof LeitnerIngestion>

  @belongsTo(() => LeitnerCard)
  declare card: BelongsTo<typeof LeitnerCard>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
