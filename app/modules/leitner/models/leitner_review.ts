import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import LeitnerCard from '#modules/leitner/models/leitner_card'

export default class LeitnerReview extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare leitnerCardId: number

  @column()
  declare grade: 'again' | 'hard' | 'good' | 'easy'

  /**
   * La réponse écrite avant le dévoilement du verso. `null` pour les révisions
   * d'avant ce lot, et pour un dévoilement sans rien écrire.
   */
  @column()
  declare answer: string | null

  /**
   * Ce que le juge a dit — **jamais ce qui a été appliqué**. `grade` reste la seule
   * chose qui pilote Leitner : le verdict ne fait que présélectionner un bouton, que
   * l'utilisateur garde la liberté de changer. Une ligne `verdict: 'faux'` avec
   * `grade: 'easy'` est donc parfaitement normale.
   *
   * ⚠️ `null` = **aucun juge n'a tranché** (LLM éteint, sortie illisible, réponse
   * vide) et ne se confond pas avec `faux`.
   */
  @column()
  declare verdict: 'juste' | 'partiel' | 'faux' | null

  /**
   * Durée du **seul appel au LLM**. `null` sur court-circuit (réponse exacte, aucun
   * réseau) comme sur repli. Inutilisé dans ce lot — c'est le suivant qui en dépend,
   * et un historique ne se reconstitue pas après coup.
   */
  @column()
  declare latencyMs: number | null

  @column.dateTime()
  declare reviewedAt: DateTime

  @belongsTo(() => LeitnerCard)
  declare leitnerCard: BelongsTo<typeof LeitnerCard>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
