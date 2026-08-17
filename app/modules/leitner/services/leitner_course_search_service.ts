import LeitnerCourseSection from '#modules/leitner/models/leitner_course_section'
import { applyVisibility } from '#modules/leitner/services/leitner_visibility'

/**
 * La recherche plein texte du corpus de cours (CC-252) — un seul endroit, un seul
 * appelant (`LeitnerController#courseSearch`), sur le patron de
 * `veille_item_query.ts` : `whereRaw` paramétré, jamais concaténé.
 *
 * ⚠️ **`.select('leitner_course_sections.*')` n'est pas décoratif.** Les deux tables
 * jointes portent chacune un `id` : sans ce select explicite, l'un écrase l'autre à
 * l'hydratation — le piège documenté ailleurs dans le module pour la jointure de
 * progression (`joinProgress`/`whereDue`).
 *
 * ⚠️ **Les sections tombées (`obsolete_at` non nul) sont EXCLUES** — décision tranchée du
 * ticket : la révision teste la mémoire sur le cours ACTUEL de l'auteur, pas sur ce qu'il
 * a retiré. Elles restent consultables depuis `/revision/cours/:id`.
 */
export async function searchCourseSections(query: string, userId: number, isAdmin: boolean) {
  const sections = LeitnerCourseSection.query()
    .select('leitner_course_sections.*')
    .innerJoin('leitner_courses', 'leitner_courses.id', 'leitner_course_sections.course_id')
    .whereNull('leitner_course_sections.obsolete_at')
    .whereRaw("leitner_course_sections.search_vector @@ plainto_tsquery('french', ?)", [query])
    .orderByRaw(
      "ts_rank(leitner_course_sections.search_vector, plainto_tsquery('french', ?)) desc",
      [query]
    )
    .limit(3)
    .preload('course')

  applyVisibility(sections, 'leitner_courses', userId, isAdmin)

  return sections
}
