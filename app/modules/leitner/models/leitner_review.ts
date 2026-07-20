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
   * réseau) comme sur repli.
   *
   * ⚠️ **Ce n'est pas une mesure de l'utilisateur** : c'est la vitesse de LM Studio.
   * La fluence de rappel se lit dans `thinkingMs`, et les deux ne se remplacent pas.
   */
  @column()
  declare latencyMs: number | null

  /**
   * De l'affichage de la carte à la **première frappe** — la fluence de rappel, celle
   * qui distingue `easy` de `good` de `hard` là où le juge dit « juste » aux trois.
   *
   * ⚠️ **`null` veut dire « mesure inexploitable », jamais « instantané »** : carte
   * re-présentée dans la journée, interruption avant la première frappe, plafond
   * dépassé, ou aucune réponse écrite. La colonne ne porte donc, par construction, que
   * des mesures comparables entre elles — c'est ce qui autorise à en prendre la médiane
   * sans rien filtrer à la lecture. Ne t'en sers pas comme d'un « temps de réponse »
   * général : ce n'en est pas un.
   */
  @column()
  declare thinkingMs: number | null

  /**
   * De l'affichage au dévoilement du verso. Écrit **toujours**, lu par **aucune règle** :
   * c'est la donnée d'observation qui permettra de vérifier après coup que mesurer la
   * première frappe était le bon choix. Il est dominé par la longueur de la réponse à
   * taper, pas par la difficulté du rappel — d'où le fait qu'il ne serve à rien décider.
   */
  @column()
  declare totalMs: number | null

  @column.dateTime()
  declare reviewedAt: DateTime

  @belongsTo(() => LeitnerCard)
  declare leitnerCard: BelongsTo<typeof LeitnerCard>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
