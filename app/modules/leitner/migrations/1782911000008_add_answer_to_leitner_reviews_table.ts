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
 * ⚠️ **`latency_ms` n'est lu par personne, et ne l'a jamais été.** Il a été posé ici en
 * pensant que le lot suivant — la fluence de rappel — s'en servirait : c'était une
 * erreur, et elle vaut d'être écrite. Il mesure la vitesse de **LM Studio**, pas celle
 * du souvenir ; la fluence a donc dû introduire ses propres colonnes (`thinking_ms`,
 * `total_ms`, migration …009). Les deux ne se remplacent pas. Ce qui reste vrai du
 * raisonnement d'origine : un historique ne se reconstitue pas après coup.
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
