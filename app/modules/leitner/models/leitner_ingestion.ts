import { DateTime } from 'luxon'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import LeitnerDraftCard from '#modules/leitner/models/leitner_draft_card'

/**
 * `pending` et `running` n'ont de sens qu'en exécution asynchrone (lot 2). En
 * synchrone, une ingestion naît `running` et meurt `done` ou `failed` dans la même
 * requête — mais la colonne existe **dès maintenant** : le lot 2 est alors un
 * changement de mode d'exécution, pas une reprise du modèle de données.
 */
export type IngestionStatus = 'pending' | 'running' | 'done' | 'failed'

/** D'où vient le texte : collé dans le formulaire, ou téléversé (.txt / .md). */
export type IngestionSource = 'paste' | 'file'

/**
 * Un travail d'ingestion : un cours découpé en morceaux, soumis à un LLM local,
 * qui produit des **brouillons** de cartes (`LeitnerDraftCard`) — jamais des cartes.
 * Rien n'entre en base sans relecture humaine.
 */
export default class LeitnerIngestion extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare status: IngestionStatus

  @column()
  declare source: IngestionSource

  /** Nom du fichier téléversé, `null` quand le cours a été collé. */
  @column()
  declare sourceName: string | null

  @column()
  declare charCount: number

  @column()
  declare chunkCount: number

  @column()
  declare chunksDone: number

  /** Nombre de brouillons produits, après fusion et déduplication entre morceaux. */
  @column()
  declare cardsProposed: number

  /** Message d'échec, affichable tel quel. `null` tant que rien n'a échoué. */
  @column()
  declare error: string | null

  @hasMany(() => LeitnerDraftCard)
  declare drafts: HasMany<typeof LeitnerDraftCard>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
