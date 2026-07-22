import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * CC-63 — la pierre tombale : supprimer un item, c'est le masquer, jamais retirer sa ligne.
 *
 * ⚠️ **Supprimer la ligne ne supprimerait rien — l'item reviendrait tout seul.** La collecte
 * écrit avec `ON CONFLICT (dedup_key) DO NOTHING` (`veille_item_writer.ts`), et c'est cette clé,
 * elle seule, qui empêche un doublon. Ligne supprimée = clé libérée = **la passe suivante
 * réinsère l'item**. Un flux publie ses 10 à 50 dernières entrées en permanence : un article
 * supprimé reviendrait dans l'heure, et un asset tant qu'il est dans l'album. Le bouton
 * *paraîtrait* marcher — l'item disparaît, puis réapparaît plus tard sans que rien ne relie les
 * deux. La ligne reste donc, et `deleted_at` la masque : le collecteur ne change pas d'une ligne.
 *
 * ⚠️ **Le prix de ce choix se paie partout à la fois** : *toute* lecture doit filtrer
 * `deleted_at IS NULL`. Un seul filtre oublié et les items supprimés remontent. Les endroits
 * sont énumérés dans le `CLAUDE.md` du module — liste · compteurs · tags · recherche ·
 * pagination · réconciliation · proxy de vignette. C'est le risque n° 1 du lot, et il a un test
 * par endroit.
 *
 * L'alternative — une table de pierres tombales et une vraie suppression de ligne — éviterait le
 * filtre partout mais imposerait une anti-jointure à l'insertion, dans le seul endroit du module
 * où la déduplication est tranchée. **Le filtre est plus sûr que la jointure** : un filtre oublié
 * se voit à l'écran, une anti-jointure ratée fait revenir les items en silence.
 *
 * ⚠️ **Aucune donnée n'est réécrite** : la colonne naît nulle, donc tout ce qui existe reste
 * visible. La base porte l'unique exemplaire du contenu (voir le `CLAUDE.md` racine).
 */
export default class extends BaseSchema {
  protected tableName = 'veille_items'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      /**
       * Un horodatage plutôt qu'un booléen, pour la même raison que `read_at` et
       * `unavailable_at` : même coût, et on sait *quand*.
       *
       * ⚠️ **`deleted_at` n'est pas `unavailable_at`, et les deux coexistent sur la même ligne.**
       * `unavailable_at` est un **constat** de la collecte (« cet asset n'est plus dans l'album »),
       * réversible tout seul si l'asset y revient. `deleted_at` est une **décision de
       * l'utilisateur**, que rien dans la collecte ne défait. Les fusionner ferait qu'un asset
       * remis dans l'album ressusciterait un item volontairement supprimé.
       */
      table.timestamp('deleted_at').nullable()
    })

    /**
     * L'index de tri **remplace** celui de la migration `…401` : même expression, plus la
     * clause partielle.
     *
     * ⚠️ **Les pierres tombales ne sont jamais nettoyées, par conception.** Elles s'accumulent
     * indéfiniment, et un index qui les porterait enflerait sans fin pour des lignes qu'aucun
     * écran ne montre. Le partiel les exclut à la source.
     *
     * ⚠️ **L'ancien est supprimé, pas laissé à côté.** Après ce lot, plus aucune lecture de la
     * liste ne se fait sans `deleted_at IS NULL` : le garder ferait payer deux écritures d'index
     * à chaque insertion de collecte pour un index que rien ne lit. Deux index sur la même
     * expression, c'est aussi deux réponses possibles à « lequel sert ? » — et six mois plus
     * tard, personne ne sait.
     */
    this.schema.raw(`
      CREATE INDEX veille_items_visible_published_idx
      ON ${this.tableName} (coalesce(published_at, created_at) DESC, id DESC)
      WHERE deleted_at IS NULL
    `)
    this.schema.raw('DROP INDEX IF EXISTS veille_items_published_idx')
  }

  /**
   * ⚠️ **Ce retour arrière ne détruit rien**, contrairement à celui de la migration `…403`. Les
   * items supprimés redeviennent simplement visibles : leur ligne n'avait jamais quitté la table,
   * c'est tout l'intérêt de la pierre tombale. Le seul dégât est la perte de la décision de
   * l'utilisateur — récupérable en resupprimant, et jamais du contenu perdu.
   */
  async down() {
    /**
     * ⚠️ **L'index de `…401` est rétabli avant que le partiel ne parte** : sans lui, revenir en
     * arrière laisserait la liste sans index de tri du tout, et la panne serait silencieuse —
     * la page continuerait de répondre, en `seq scan`. Même piège que la colonne générée et son
     * index GIN, documenté depuis le lot 1.
     *
     * Le `down()` de `…401` le resupprime ensuite avec `IF EXISTS` : les deux retours en arrière
     * s'enchaînent sans se marcher dessus.
     */
    this.schema.raw(`
      CREATE INDEX IF NOT EXISTS veille_items_published_idx
      ON ${this.tableName} (coalesce(published_at, created_at) DESC, id DESC)
    `)
    this.schema.raw('DROP INDEX IF EXISTS veille_items_visible_published_idx')

    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('deleted_at')
    })
  }
}
