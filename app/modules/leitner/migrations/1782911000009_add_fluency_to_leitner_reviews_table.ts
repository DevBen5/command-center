import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * La **fluence de rappel** : combien de temps le souvenir a mis à venir. C'est ce qui
 * récupère les trois nuances que le juge ne distingue pas — `hard`, `good` et `easy`
 * sont tous « juste » pour lui.
 *
 * - `thinking_ms` — de l'affichage de la carte à la **première frappe** dans le champ
 *   de réponse. `null` quand la mesure n'est pas exploitable, et cette nullabilité est
 *   du sens : re-présentation dans la journée, interruption, plafond dépassé, ou aucune
 *   réponse écrite. **La colonne ne contient donc, par construction, que des mesures
 *   comparables** — c'est ce qui permet d'en prendre la médiane sans filtrer à la lecture.
 * - `total_ms` — de l'affichage au dévoilement du verso. Écrit **toujours**, jamais lu
 *   par une règle : c'est la donnée d'observation qui permettra de vérifier après coup
 *   que mesurer la première frappe était le bon choix.
 *
 * ⚠️ **Pourquoi la première frappe et non le temps total.** Le temps total est dominé
 * par la **longueur de la réponse**, pas par la difficulté du rappel : un verso en prose
 * prend quarante secondes à taper même parfaitement su. Le facteur parasite croît avec
 * exactement la variable qu'on veut isoler. Une fois qu'on tape, on sait.
 *
 * ⚠️ **`latency_ms` (migration …008) ne pouvait pas servir à ça** : elle mesure la durée
 * du seul appel au LLM — la vitesse de LM Studio, pas celle du souvenir. Les deux
 * colonnes coexistent et ne se remplacent pas.
 *
 * Comme `latency_ms`, ce sont des durées : `integer unsigned`, bornées côté validateur
 * (`MEASURE_MAX_MS`) bien avant la limite de la colonne.
 */
export default class extends BaseSchema {
  protected tableName = 'leitner_reviews'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.integer('thinking_ms').unsigned().nullable()
      table.integer('total_ms').unsigned().nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('thinking_ms')
      table.dropColumn('total_ms')
    })
  }
}
