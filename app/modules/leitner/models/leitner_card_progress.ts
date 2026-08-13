import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#core/auth/models/user'
import LeitnerCard from '#modules/leitner/models/leitner_card'

/**
 * Où en est **une personne** sur **une carte** : sa boîte, sa prochaine échéance.
 *
 * ⚠️ **L'absence de ligne n'est pas un trou, c'est une valeur** : elle vaut « boîte 1,
 * due aujourd'hui ». C'est ce qui donne à un compte neuf une file pleine sans rien semer,
 * et à une carte créée aujourd'hui d'être due pour tout le monde sans re-semis. Toute
 * lecture doit donc passer par une jointure **externe** avec un `coalesce`, jamais par un
 * `where` sur cette table seule — qui rendrait invisibles toutes les cartes jamais notées.
 *
 * ⚠️ **`updatedAt` porte l'ordre de la file.** Une carte notée `again` reste due le jour
 * même ; ce qui la renvoie en fin de file, c'est que sa progression vient d'être écrite.
 * Avant CC-119 ce rôle était tenu par `leitner_cards.updated_at`, qui ne bouge plus à la
 * note — s'y fier laisserait la carte ratée se re-présenter en boucle.
 */
export default class LeitnerCardProgress extends BaseModel {
  static table = 'leitner_card_progress'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare leitnerCardId: number

  @column()
  declare box: number

  @column.date()
  declare nextReview: DateTime

  /**
   * **Depuis quand cette personne tient cette carte en boîte 5** (CC-260) — l'horloge du
   * critère de maîtrise, et l'information que rien ne portait avant ce lot :
   * `leitner_reviews` n'avait ni `box_before` ni `box_after`, et rejouer les notes depuis
   * la boîte 1 aurait été faux dès qu'un import est passé.
   *
   * Posée à l'**entrée** en boîte 5, **réarmée** par `again`, remise à `null` dès que la
   * carte en sort (2ᵉ `hard` d'affilée). ⚠️ **`hard` ne la réarme pas** — décision
   * explicite : `hard` est une réussite, et réarmer serait une punition.
   *
   * ⚠️ `null` veut dire « pas en boîte 5 », jamais « en boîte 5 depuis toujours ». Une
   * carte importée directement en boîte 5 arrive donc sans horloge : c'est
   * `nextMasteryState` qui la lui pose à sa première note, faute de mieux — voir
   * `services/leitner_mastery.ts`.
   *
   * ⚠️ **`columnName` explicite, exactement comme `leitner_settings.box5Days`** : la
   * conversion automatique rend `box_5_entered_at`, pas `box5_entered_at`. Sans ce
   * mappage, l'insertion échoue sur une colonne inexistante — mesuré, et c'est le même
   * piège que le module documente déjà pour un identifiant qui mêle lettres et chiffres.
   */
  @column.dateTime({ columnName: 'box5_entered_at' })
  declare box5EnteredAt: DateTime | null

  /**
   * **La date d'acquisition** (CC-260) : quand cette personne a satisfait le critère de
   * maîtrise sur cette carte. `null` = pas (ou plus) maîtrisée.
   *
   * ⚠️ **Elle ne dérive pas.** Posée une fois, elle est conservée telle quelle par les
   * réussites suivantes — une date d'acquisition qui avancerait à chaque `good` ne
   * daterait plus rien. Seul ce qui réarme l'horloge l'efface : `again`, ou la sortie de
   * la boîte 5.
   *
   * ⚠️ **Personne ne la lit encore** (CC-260 pose les marques, rien d'autre) : ni file, ni
   * compteur, ni écran. CC-261 puis CC-262 la consommeront.
   */
  @column.dateTime()
  declare masteredAt: DateTime | null

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  @belongsTo(() => LeitnerCard)
  declare leitnerCard: BelongsTo<typeof LeitnerCard>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
