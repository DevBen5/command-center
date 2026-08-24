import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * La recherche plein texte du corpus de cours (CC-252) — patron exact de la veille
 * (`veille_items.search_vector`) : colonne générée par Postgres, tenue à jour seule à
 * chaque écriture, jamais renseignée par l'application et absente du modèle Lucid.
 *
 * ⚠️ **Sur le seul `body`** — pas `heading_path` ni `aliases` : c'est ce que le ticket
 * demande, et un besoin de plus n'est écrit que sur mesure d'usage réelle.
 * ⚠️ **Oublier l'index GIN ne casse rien de visible** : la recherche répond toujours, en
 * `seq scan` — panne silencieuse, même piège que documenté pour la veille.
 */
export default class extends BaseSchema {
  protected tableName = 'leitner_course_sections'

  async up() {
    this.schema.raw(`
      ALTER TABLE ${this.tableName}
      ADD COLUMN search_vector tsvector
      GENERATED ALWAYS AS (to_tsvector('french', coalesce(body, ''))) STORED
    `)
    this.schema.raw(
      `CREATE INDEX leitner_course_sections_search_vector_idx ON ${this.tableName} USING GIN (search_vector)`
    )
  }

  async down() {
    this.schema.raw(`DROP INDEX IF EXISTS leitner_course_sections_search_vector_idx`)
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('search_vector')
    })
  }
}
