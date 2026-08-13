import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Les **marques de maîtrise** (CC-260) — le schéma qui rendra un inventaire d'acquis
 * calculable. Ce lot ne change **aucun comportement visible** : les colonnes se
 * remplissent, personne ne les lit encore.
 *
 * ⚠️ **Les cinq colonnes voyagent dans UNE seule migration, et c'est délibéré.** Elles
 * touchent deux tables, donc trois occasions de bumper `BACKUP_VERSION` — or chaque
 * montée est une occasion d'oublier le `snapshot()` de `leitner_backup.spec.ts`, et cet
 * oubli fait perdre des données **sans qu'aucun test ne rougisse** (c'est ce qui a laissé
 * passer CC-51). Une migration, un bump (→ 4), un seul passage sur `leitner_reviews` —
 * la table qui grossit.
 *
 * ⚠️ **Le défaut de `kind` EST le backfill, et il est exactement vrai** — ce n'est pas une
 * approximation. Une révision d'entretien ne peut exister qu'après que la maîtrise existe,
 * or elle n'existe pas avant ce lot : toute révision antérieure est normale, par
 * construction. Il n'y a rien à écrire.
 *
 * ⚠️ **Le backfill de `box5_entered_at`, lui, EST une approximation assumée.** On prend
 * `updated_at` des lignes en boîte 5 : c'est la meilleure information disponible (le module
 * utilise déjà cette colonne comme marqueur d'ordre de file), et elle peut **surestimer**
 * l'ancienneté si la ligne a été touchée pour autre chose. On ne peut pas faire mieux :
 * `leitner_reviews` ne portait ni `box_before` ni `box_after` avant ce lot — c'est
 * précisément le défaut que la migration corrige — et rejouer `nextBox` depuis la boîte 1
 * serait faux dès qu'un import est passé (l'import écrit `box` **directement** depuis le
 * JSON, sans que les révisions correspondantes produisent ce chemin).
 *
 * ⚠️ **Ce backfill n'est prouvable par AUCUN runner** : `app_test` est vide, donc il ne
 * s'exécute jamais sous Japa — le supprimer entièrement laisse la suite verte. Il a été
 * vérifié à la main sur des progressions **fabriquées** avec des `updated_at` distincts
 * (deux en boîte 5, un témoin hors boîte 5), rollback → run, mutation à l'appui : la
 * procédure rejouable est dans `TESTS.md`. ⚠️ Ce n'est pas l'empreinte CC-119, qui répond
 * à une autre question (« le contenu réel a-t-il survécu ? ») et ne dit rien de
 * l'arithmétique.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('leitner_card_progress', (table) => {
      // L'horloge : depuis quand cette personne tient cette carte en boîte 5. Posée à
      // l'entrée, réarmée par `again`, remise à `null` dès que la carte sort de la boîte 5.
      table.timestamp('box5_entered_at').nullable()
      // La date d'acquisition — c'est elle qui rendra l'inventaire datable. `null` = pas
      // (ou plus) maîtrisée.
      table.timestamp('mastered_at').nullable()
    })

    this.schema.alterTable('leitner_reviews', (table) => {
      // De quelle file la carte venait au moment de la note — **jamais où elle finit**.
      // Une carte maîtrisée ratée en entretien produit une révision `maintenance` alors
      // qu'elle en ressort non maîtrisée.
      table.enum('kind', ['normal', 'maintenance']).notNullable().defaultTo('normal')
      // ⚠️ **Nullables, et le `null` est du sens qui ne se rattrapera jamais** : « révision
      // antérieure à CC-260, boîte inconnue ». Tout agrégat qui les lira devra le gérer
      // pour toujours — l'historique existant ne peut pas être reconstitué.
      table.integer('box_before').nullable()
      table.integer('box_after').nullable()
    })

    this.defer(async (db) => {
      // ⚠️ **`rawQuery`, jamais `.update({ box5_entered_at: db.raw('updated_at') })`.** Le
      // `RawBuilder` de Lucid n'est pas une expression pour knex : il part en **binding**,
      // sérialisé en `{"sql":"updated_at"}`, et Postgres refuse — mesuré. La colonne est
      // une **référence**, pas une valeur : elle s'écrit dans le SQL. Le `?` reste
      // paramétré, comme partout dans ce dépôt.
      await db.rawQuery(
        'update leitner_card_progress set box5_entered_at = updated_at where box = ?',
        [5]
      )
    })
  }

  async down() {
    this.schema.alterTable('leitner_reviews', (table) => {
      // `table.enum` sans `useNative` produit un `varchar` + une contrainte `check` :
      // `dropColumn` emporte les deux, il n'y a pas de type à supprimer à part.
      table.dropColumn('box_after')
      table.dropColumn('box_before')
      table.dropColumn('kind')
    })

    this.schema.alterTable('leitner_card_progress', (table) => {
      table.dropColumn('mastered_at')
      table.dropColumn('box5_entered_at')
    })
  }
}
