import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Le lien optionnel entre un travail d'ingestion et le cours qu'il a fait naître
 * (CC-251, case « conserver ce cours »). Supprimer le cours ne doit pas effacer la trace
 * du travail qui l'a produit, et supprimer l'ingestion ne doit jamais emporter le cours —
 * c'est du contenu, il survit toujours.
 *
 * ⚠️ **Édité pour CC-275 : plus de `.references()/.onDelete()`.** Le corpus vit désormais
 * dans le module optionnel `corpus` ; une FK vers `leitner_courses` ferait échouer cette
 * migration au démarrage sur une installation Leitner sans corpus, faute de table cible.
 * La colonne reste, toujours présente — c'est une référence molle : le ménage (`NULL` à la
 * suppression d'un cours) vit désormais dans `LeitnerCourseService.destroy()`, côté corpus,
 * gardé par `isModuleEnabled('leitner')`. Sur la base de dev, où cette migration avait déjà
 * joué avec la FK, `1786600000012_drop_ingestion_course_fk.ts` retire la contrainte
 * existante — cette édition ne fait que garder une base neuve (`app_test`) de ne jamais la
 * recréer.
 */
export default class extends BaseSchema {
  protected tableName = 'leitner_ingestions'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.integer('leitner_course_id').unsigned().nullable().index()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('leitner_course_id')
    })
  }
}
