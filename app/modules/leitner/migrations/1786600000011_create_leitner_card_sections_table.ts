import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Le lien carte ↔ section du corpus (CC-253) : d'où vient une carte générée, ou la
 * section qu'on lui a posée à la main.
 *
 * ⚠️ **Ne porte PAS `owner_id`/`is_shared`** — même doctrine que `leitner_draft_cards`
 * vis-à-vis de son ingestion et `leitner_course_sections` vis-à-vis de son cours : ce
 * n'est pas du contenu à soi, c'est un lien entre deux contenus qui portent déjà leur
 * propriétaire. Sa visibilité se dérive des deux (voir `leitner_card_sections_service.ts`,
 * `provenanceSectionsFor`).
 *
 * `origin` est un `string(16)`, sans CHECK — même patron que `leitner_draft_cards.status`.
 * Deux valeurs produites par ce lot : `ingestion` (promotion d'un brouillon,
 * `LeitnerIngestionService.accept`) et `manuel` (sélecteur de `/revision/settings`).
 *
 * FK en `CASCADE` côté carte : une carte supprimée ne porte jamais de trace fantôme.
 * Une section OBSOLÈTE (pierre tombale) garde ses liens — seule sa suppression PHYSIQUE
 * (purge, ou cours entier supprimé) doit emporter le lien avec elle.
 *
 * ⚠️ **Édité pour CC-275 : plus de FK côté section.** Le corpus vit désormais dans le
 * module optionnel `corpus` ; une FK vers `leitner_course_sections` ferait échouer cette
 * migration au démarrage sur une installation Leitner sans corpus. La colonne reste,
 * référence molle : le ménage (suppression des liens à la purge d'une section ou d'un
 * cours) vit dans `LeitnerCourseService`, côté corpus, gardé par `isModuleEnabled('leitner')`.
 * Sur la base de dev, `1786600000013_drop_card_sections_course_fk.ts` retire la contrainte
 * déjà posée — cette édition ne fait que garder une base neuve de ne jamais la recréer.
 */
export default class extends BaseSchema {
  protected tableName = 'leitner_card_sections'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table
        .integer('leitner_card_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('leitner_cards')
        .onDelete('CASCADE')

      table.integer('leitner_course_section_id').unsigned().notNullable()

      table.string('origin', 16).notNullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      table.unique(['leitner_card_id', 'leitner_course_section_id'])
      table.index(['leitner_card_id'])
      table.index(['leitner_course_section_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
