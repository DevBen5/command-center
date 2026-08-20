import LeitnerCourseSection from '#modules/leitner/models/leitner_course_section'
import { applyVisibility } from '#modules/leitner/services/leitner_visibility'

/** Un terme du glossaire, tel qu'exposé à `pages/index.vue` (CC-254). */
export interface GlossaryTerm {
  term: string
  sectionId: number
}

/**
 * L'index de glossaire — tous les alias (`> notion: X, Y`) des sections VISIBLES de
 * l'utilisateur, tombes exclues. Termes et ids seulement : le contenu se charge au clic,
 * par `LeitnerCourseController#sectionContent`.
 *
 * ⚠️ **Les sections tombées sont exclues**, même raison que `searchCourseSections` (CC-252) :
 * la révision teste le vocabulaire du cours ACTUEL, pas ce que l'auteur a retiré depuis.
 *
 * ⚠️ **Filtre par visibilité du COURS**, comme `searchCourseSections` : `applyVisibility` porte
 * sur `leitner_courses`, jamais sur la section elle-même (qui n'a pas de propriétaire propre).
 */
export async function glossaryIndex(userId: number, isAdmin: boolean): Promise<GlossaryTerm[]> {
  const query = LeitnerCourseSection.query()
    .select('leitner_course_sections.*')
    .innerJoin('leitner_courses', 'leitner_courses.id', 'leitner_course_sections.course_id')
    .whereNotNull('leitner_course_sections.aliases')
    .whereNull('leitner_course_sections.obsolete_at')
    .orderBy('leitner_course_sections.id', 'asc')

  applyVisibility(query, 'leitner_courses', userId, isAdmin)

  const sections = await query
  return sections.flatMap((section) =>
    (section.aliases ?? []).map((term) => ({ term, sectionId: section.id }))
  )
}
