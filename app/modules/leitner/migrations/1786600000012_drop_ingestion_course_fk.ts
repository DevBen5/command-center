import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Retire la FK `leitner_ingestions.leitner_course_id → leitner_courses` (CC-275) : une fois
 * le corpus détaché en module optionnel, cette référence traverserait une frontière de
 * module — la migration qui la posait échouerait au démarrage sur une installation Leitner
 * sans corpus, faute de table cible. La colonne reste (référence molle, toujours présente),
 * seule la contrainte disparaît ; le ménage applicatif (`NULL` à la suppression d'un cours)
 * vit désormais côté corpus, gardé par `isModuleEnabled('leitner')`.
 *
 * ⚠️ Idempotent à dessein : `1786600000008_...` est édité dans le même lot pour ne plus
 * poser cette FK sur une base neuve (`app_test`) — sur une telle base, cette migration ne
 * trouverait rien à supprimer. Un `dropForeign` nu y échouerait.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.raw(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'leitner_ingestions_leitner_course_id_foreign'
            AND table_name = 'leitner_ingestions'
        ) THEN
          ALTER TABLE leitner_ingestions DROP CONSTRAINT leitner_ingestions_leitner_course_id_foreign;
        END IF;
      END $$;
    `)
  }

  async down() {
    this.schema.raw(`
      DO $$
      BEGIN
        IF to_regclass('leitner_courses') IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_name = 'leitner_ingestions_leitner_course_id_foreign'
            AND table_name = 'leitner_ingestions'
        ) THEN
          ALTER TABLE leitner_ingestions
            ADD CONSTRAINT leitner_ingestions_leitner_course_id_foreign
            FOREIGN KEY (leitner_course_id) REFERENCES leitner_courses(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `)
  }
}
