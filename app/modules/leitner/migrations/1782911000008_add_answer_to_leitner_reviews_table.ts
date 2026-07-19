import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * La **réponse écrite** et ce que le juge en a dit. Trois colonnes, toutes nullables —
 * et cette nullabilité est du sens, pas de la commodité :
 *
 * - `answer` — la réponse saisie. `null` pour les révisions d'avant ce lot, et pour
 *   celles où l'utilisateur dévoile sans rien écrire (aucun juge n'est alors appelé).
 * - `verdict` — `juste` · `partiel` · `faux`, ou **`null` quand aucun juge n'a tranché**
 *   (LLM éteint, sortie illisible, réponse vide). ⚠️ `null` et `faux` ne sont pas la même
 *   chose : « jamais jugé » n'est pas « jugé faux ». C'est ce qui permettra de rejuger a
 *   posteriori les réponses écrites pendant une panne.
 * - `latency_ms` — la durée du **seul appel au LLM**, `null` sur court-circuit (réponse
 *   exacte, aucun réseau) comme sur repli. Mesurer tout le cycle mélangerait deux
 *   populations dans une même colonne et rendrait toute moyenne trompeuse.
 *
 * ⚠️ **`latency_ms` n'est lu par personne dans ce lot, et c'est délibéré** : le lot
 * suivant en dépend, et un historique ne se reconstitue pas après coup — il faudrait
 * attendre des semaines de révisions pour retrouver une référence.
 *
 * `verdict` est un `text`, pas un `enum` : contrairement à `grade`, il ne pilote aucune
 * règle métier (la note reste le seul moteur de Leitner). Le figer en base coûterait une
 * migration à chaque nuance ajoutée au juge, sans rien protéger.
 */
export default class extends BaseSchema {
  protected tableName = 'leitner_reviews'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.text('answer').nullable()
      table.text('verdict').nullable()
      table.integer('latency_ms').unsigned().nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('answer')
      table.dropColumn('verdict')
      table.dropColumn('latency_ms')
    })
  }
}
