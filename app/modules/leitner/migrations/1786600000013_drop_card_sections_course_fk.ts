import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Retire la FK `leitner_card_sections.leitner_course_section_id → leitner_course_sections`
 * (CC-275) — même raison que `1786600000012_drop_ingestion_course_fk.ts` : la table cible
 * vit désormais dans le module optionnel `corpus`, la contrainte échouerait au démarrage
 * sur une installation Leitner sans corpus. La FK vers `leitner_cards` (même module,
 * toujours créée dans `1786600000011_...`) reste inchangée en CASCADE — c'est elle qui
 * continue de nettoyer les liens à la suppression d'une carte. Le ménage pour un cours
 * supprimé côté corpus vit dans `LeitnerCourseService.destroy()`, gardé par
 * `isModuleEnabled('leitner')`.
 *
 * ⚠️ Idempotent, même raison que la migration jumelle : `1786600000011_...` est édité dans
 * le même lot pour ne plus poser cette FK sur une base neuve.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'leitner_card_sections_leitner_course_section_id_foreign'
            AND table_name = 'leitner_card_sections'
        ) THEN
          ALTER TABLE leitner_card_sections DROP CONSTRAINT leitner_card_sections_leitner_course_section_id_foreign;
        END IF;
      END $$;
    `)
  }

  async down() {
    this.schema.raw(`
      DO $$
      BEGIN
        IF to_regclass('leitner_course_sections') IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'leitner_card_sections_leitner_course_section_id_foreign'
            AND table_name = 'leitner_card_sections'
        ) THEN
          ALTER TABLE leitner_card_sections
            ADD CONSTRAINT leitner_card_sections_leitner_course_section_id_foreign
            FOREIGN KEY (leitner_course_section_id) REFERENCES leitner_course_sections(id) ON DELETE CASCADE;
        END IF;
      END $$;
    `)
  }
}
