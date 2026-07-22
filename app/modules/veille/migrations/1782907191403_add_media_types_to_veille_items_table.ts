import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * CC-55 — les assets Immich rejoignent la liste : deux valeurs de `type`, et la marque des
 * assets qui ont quitté l'album.
 *
 * ⚠️ **`type` n'est pas un enum Postgres natif**, malgré le `table.enum()` de la migration
 * d'origine : sans `useNative: true`, knex produit une colonne `text` plus une contrainte `CHECK`
 * nommée `veille_items_type_check`. Ajouter une valeur est donc un `DROP` / `ADD CONSTRAINT`,
 * **jamais** un `ALTER TYPE … ADD VALUE`. C'est écrit dans le `CLAUDE.md` du module depuis le
 * lot 1, et c'est exactement le cas de figure prévu.
 *
 * ⚠️ **Aucune donnée n'est réécrite ici** : les items existants gardent leur type, la nouvelle
 * colonne naît nulle. La base porte l'unique exemplaire du contenu.
 *
 * ⚠️ **`kind` n'a besoin d'aucune migration** : `veille_sources.kind` est un `string(16)` sans
 * contrainte (migration `…191400`), la valeur `immich` y entre telle quelle.
 */
export default class extends BaseSchema {
  protected tableName = 'veille_items'

  async up() {
    // `image` et `video` disent, comme `article`, **ce qu'est** l'item — jamais d'où il vient
    // (c'est le rôle de `veille_sources.kind`). Un asset Immich n'est pas « un item Immich » :
    // c'est une image ou une vidéo, qui se trouve venir d'Immich.
    this.schema.raw(
      `ALTER TABLE ${this.tableName} DROP CONSTRAINT IF EXISTS veille_items_type_check`
    )
    this.schema.raw(`
      ALTER TABLE ${this.tableName}
      ADD CONSTRAINT veille_items_type_check
      CHECK (type IN ('article', 'bookmark', 'note', 'image', 'video'))
    `)

    this.schema.alterTable(this.tableName, (table) => {
      /**
       * L'asset n'est plus dans l'album de veille — constaté par différence à la collecte.
       *
       * Un horodatage plutôt qu'un booléen, pour la même raison que `read_at` : on sait *quand*,
       * et la colonne redevient nulle si l'asset revient dans l'album.
       *
       * ⚠️ **Le nom dit « indisponible », pas « supprimé », et c'est délibéré.** La différence ne
       * distingue pas un asset retiré de l'album d'un asset effacé d'Immich, et elle ne le
       * prétendra pas : les distinguer demanderait un appel par disparu, dont le 400 signifie
       * aussi « pas d'accès ». Une devinette de plus, pour une nuance que l'écran n'exploiterait
       * pas.
       */
      table.timestamp('unavailable_at').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('unavailable_at')
    })

    /**
     * ⚠️ **Ce retour arrière DÉTRUIT les items média**, et il n'y a pas d'alternative : la
     * contrainte d'origine n'admet pas `image` ni `video`, donc ces lignes ne peuvent pas exister
     * sous l'ancien schéma. Les convertir en `article` serait pire — on garderait des items dont
     * l'URL et le titre ne veulent plus rien dire, avec des clés de dédup `immich:` que plus rien
     * ne relit.
     *
     * Le dégât est **borné par la décision qui porte le lot** : Command Center ne stocke qu'une
     * **référence**, Immich possède les octets. Une collecte suffit à tout reconstruire. Ce qui
     * est réellement perdu est ce que le module a produit lui-même : l'état lu/non-lu, la file de
     * lecture et les tags de ces items.
     */
    this.schema.raw(`DELETE FROM ${this.tableName} WHERE type IN ('image', 'video')`)
    this.schema.raw(
      `ALTER TABLE ${this.tableName} DROP CONSTRAINT IF EXISTS veille_items_type_check`
    )
    this.schema.raw(`
      ALTER TABLE ${this.tableName}
      ADD CONSTRAINT veille_items_type_check
      CHECK (type IN ('article', 'bookmark', 'note'))
    `)
  }
}
