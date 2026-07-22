import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Rattache `veille_items` aux sources et lui donne de quoi être trié et dédoublonné.
 *
 * ⚠️ La base porte l'unique exemplaire du contenu (voir le `CLAUDE.md` racine) : **aucun
 * `dropTable` ici**, les items existants sont conservés et convertis sur place.
 *
 * L'ordre des instructions n'est pas cosmétique :
 *
 * 1. `search_vector` est une colonne `GENERATED ALWAYS` bâtie sur `title` — Postgres refuse
 *    d'élargir une colonne dont dépend une colonne générée. Il faut donc la supprimer (avec
 *    son index GIN) **avant** l'`ALTER TYPE`, puis la recréer à l'identique.
 *    ⚠️ Recréer la colonne sans recréer l'index GIN ne casse rien de visible : la recherche
 *    continue de répondre, en `seq scan`. C'est une panne silencieuse — les deux vont ensemble.
 * 2. La contrainte CHECK est supprimée **avant** l'`UPDATE` qui renomme `rss` en `article` :
 *    dans l'autre sens, l'update violerait la contrainte encore en place.
 *
 * `type` n'est pas un enum Postgres natif malgré le `table.enum()` de la migration d'origine :
 * sans `useNative: true`, knex produit une colonne `text` plus une contrainte `CHECK` nommée
 * `veille_items_type_check`. C'est elle qu'on remplace, pas un type.
 */
export default class extends BaseSchema {
  protected tableName = 'veille_items'

  async up() {
    // --- 1. Libérer `title` de la colonne générée -----------------------------------------
    this.schema.raw('DROP INDEX IF EXISTS veille_items_search_vector_idx')
    this.schema.raw(`ALTER TABLE ${this.tableName} DROP COLUMN IF EXISTS search_vector`)

    // `text` plutôt que `varchar(255)` : les titres d'articles et surtout les URL collectées
    // dépassent couramment 255 caractères. Tronquer là, c'est un 500 en pleine collecte.
    this.schema.raw(`ALTER TABLE ${this.tableName} ALTER COLUMN title TYPE text`)
    this.schema.raw(`ALTER TABLE ${this.tableName} ALTER COLUMN url TYPE text`)

    this.schema.raw(`
      ALTER TABLE ${this.tableName}
      ADD COLUMN search_vector tsvector
      GENERATED ALWAYS AS (to_tsvector('french', coalesce(title, '') || ' ' || coalesce(content, ''))) STORED
    `)
    this.schema.raw(
      `CREATE INDEX veille_items_search_vector_idx ON ${this.tableName} USING GIN (search_vector)`
    )

    // --- 2. `rss` devient `article` -------------------------------------------------------
    // `type` ne désigne plus une provenance (c'est le rôle de `veille_sources.kind`) mais ce
    // qu'est l'item. `bookmark` et `note` ne bougent pas : la capture manuelle continue.
    this.schema.raw(
      `ALTER TABLE ${this.tableName} DROP CONSTRAINT IF EXISTS veille_items_type_check`
    )
    this.schema.raw(`UPDATE ${this.tableName} SET type = 'article' WHERE type = 'rss'`)
    this.schema.raw(`
      ALTER TABLE ${this.tableName}
      ADD CONSTRAINT veille_items_type_check
      CHECK (type IN ('article', 'bookmark', 'note'))
    `)

    // --- 3. Les nouvelles colonnes --------------------------------------------------------
    this.schema.alterTable(this.tableName, (table) => {
      // Nullable : une capture manuelle n'a pas de source. Une source supprimée ne doit pas
      // emporter l'historique déjà lu, d'où `SET NULL` plutôt que `CASCADE`.
      table
        .integer('veille_source_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('veille_sources')
        .onDelete('SET NULL')

      // Clé de déduplication. Nulle pour les items saisis à la main : Postgres autorise
      // plusieurs NULL dans un index unique, la capture manuelle n'est donc jamais bloquée.
      table.text('dedup_key').nullable()

      // Date de publication annoncée par le flux. Sans elle, un article publié il y a trois
      // jours mais collecté aujourd'hui remonterait en tête de liste.
      table.timestamp('published_at').nullable()

      // Lu / non-lu. Un timestamp plutôt qu'un booléen : même coût, et on sait *quand*.
      table.timestamp('read_at').nullable()
    })

    // La contrainte d'unicité est le cœur de la déduplication : deux collectes concurrentes
    // passeraient à travers un simple `if` applicatif (les deux lisent avant que l'une écrive).
    this.schema.raw(
      `CREATE UNIQUE INDEX veille_items_dedup_key_unique ON ${this.tableName} (dedup_key)`
    )

    // Le tri de la liste. `id` en second critère rend l'ordre total : sans lui, deux items
    // publiés à la même seconde peuvent s'échanger entre deux pages, et la pagination saute
    // ou répète une ligne pendant qu'une collecte tourne.
    this.schema.raw(`
      CREATE INDEX veille_items_published_idx
      ON ${this.tableName} (coalesce(published_at, created_at) DESC, id DESC)
    `)
    this.schema.raw(`CREATE INDEX veille_items_source_idx ON ${this.tableName} (veille_source_id)`)
  }

  /**
   * ⚠️ Ce `down()` est **destructeur par nature** : l'ancien schéma ne sait pas représenter un
   * titre ou une URL de plus de 255 caractères. Les valeurs trop longues sont tronquées
   * (`left(...)`) plutôt que de faire échouer le rollback. Outil de développement uniquement.
   */
  async down() {
    this.schema.raw('DROP INDEX IF EXISTS veille_items_source_idx')
    this.schema.raw('DROP INDEX IF EXISTS veille_items_published_idx')
    this.schema.raw('DROP INDEX IF EXISTS veille_items_dedup_key_unique')

    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('read_at')
      table.dropColumn('published_at')
      table.dropColumn('dedup_key')
      table.dropForeign(['veille_source_id'])
      table.dropColumn('veille_source_id')
    })

    this.schema.raw(
      `ALTER TABLE ${this.tableName} DROP CONSTRAINT IF EXISTS veille_items_type_check`
    )
    this.schema.raw(`UPDATE ${this.tableName} SET type = 'rss' WHERE type = 'article'`)
    this.schema.raw(`
      ALTER TABLE ${this.tableName}
      ADD CONSTRAINT veille_items_type_check
      CHECK (type IN ('rss', 'bookmark', 'note'))
    `)

    this.schema.raw('DROP INDEX IF EXISTS veille_items_search_vector_idx')
    this.schema.raw(`ALTER TABLE ${this.tableName} DROP COLUMN IF EXISTS search_vector`)
    this.schema.raw(
      `ALTER TABLE ${this.tableName} ALTER COLUMN title TYPE varchar(255) USING left(title, 255)`
    )
    this.schema.raw(
      `ALTER TABLE ${this.tableName} ALTER COLUMN url TYPE varchar(255) USING left(url, 255)`
    )
    this.schema.raw(`
      ALTER TABLE ${this.tableName}
      ADD COLUMN search_vector tsvector
      GENERATED ALWAYS AS (to_tsvector('french', coalesce(title, '') || ' ' || coalesce(content, ''))) STORED
    `)
    this.schema.raw(
      `CREATE INDEX veille_items_search_vector_idx ON ${this.tableName} USING GIN (search_vector)`
    )
  }
}
