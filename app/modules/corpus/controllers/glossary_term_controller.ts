import type { HttpContext } from '@adonisjs/core/http'
import { renderMarkdown } from '#core/shared/services/markdown_renderer'
import capabilityService from '#core/auth/services/capability_service'
import { isVisible } from '#core/shared/services/visibility'
import { courseSectionHref } from '#core/shared/services/course_section_link'
import GlossaryTerm from '#modules/corpus/models/glossary_term'
import {
  applyVisibility,
  assertOwnedOrAdmin,
  assertVisibleOrAdmin,
} from '#core/shared/services/visibility'
import LeitnerCourseSection from '#modules/corpus/models/leitner_course_section'
import {
  glossaryTermCreateValidator,
  glossaryTermUpdateValidator,
} from '#modules/corpus/validators/corpus'

export default class GlossaryTermController {
  async index({ auth, inertia, request }: HttpContext) {
    const query = GlossaryTerm.query().orderBy('term', 'asc')
    applyVisibility(query, 'glossary_terms', auth.user!.id, auth.user!.isAdmin)
    const terms = await query
    const sections = await LeitnerCourseSection.query()
      .whereHas('course', (course) =>
        applyVisibility(course, 'leitner_courses', auth.user!.id, auth.user!.isAdmin)
      )
      .preload('course')
      .orderBy('id')
    const visibleIds = new Set(sections.map((section) => section.id))
    const selectedSection = sections.find(
      (section) => section.id === Number(request.input('sectionId'))
    )
    return inertia.render('modules/corpus/glossary', {
      canWrite: await capabilityService.allows(auth.user!, 'corpus.write'),
      prefill: selectedSection
        ? {
            term: String(request.input('term', selectedSection.headingPath.at(-1) ?? '')).slice(
              0,
              200
            ),
            definition: selectedSection.body,
            sectionId: selectedSection.id,
          }
        : null,
      terms: terms.map((term) => ({
        id: term.id,
        term: term.term,
        aliases: term.aliases,
        definition: term.definition,
        definitionHtml: renderMarkdown(term.definition),
        isShared: term.isShared,
        mine: term.ownerId === auth.user!.id || auth.user!.isAdmin,
        sectionId: visibleIds.has(term.leitnerCourseSectionId!)
          ? term.leitnerCourseSectionId
          : null,
      })),
      sections: sections.map((section) => ({
        id: section.id,
        label: [section.course.title, ...section.headingPath].join(' › '),
      })),
    })
  }

  async store({ auth, request, response }: HttpContext) {
    const payload = await request.validateUsing(glossaryTermCreateValidator)
    if (payload.sectionId) {
      const section = await LeitnerCourseSection.query()
        .where('id', payload.sectionId)
        .preload('course')
        .firstOrFail()
      assertVisibleOrAdmin(section.course, auth.user!.id, auth.user!.isAdmin)
    }

    const term = await GlossaryTerm.create({
      term: payload.term,
      aliases: payload.aliases ?? [],
      definition: payload.definition,
      leitnerCourseSectionId: payload.sectionId ?? null,
      ownerId: auth.user!.id,
      isShared: payload.isShared ?? false,
    })
    return response.status(201).json({ term: { id: term.id } })
  }
  async show({ auth, params, response }: HttpContext) {
    const term = await GlossaryTerm.findOrFail(params.id)
    assertVisibleOrAdmin(term, auth.user!.id, auth.user!.isAdmin)
    await term.load('courseSection', (section) => section.preload('course'))
    const section = term.courseSection
    const visibleSection = section && isVisible(section.course, auth.user!.id, auth.user!.isAdmin)
    return response.json({
      id: term.id,
      term: term.term,
      aliases: term.aliases,
      definition: term.definition,
      definitionHtml: renderMarkdown(term.definition),
      sectionId: visibleSection ? section.id : null,
      sectionHref: visibleSection ? courseSectionHref(section.courseId, section.id) : null,
      isShared: term.isShared,
      mine: term.ownerId === auth.user!.id || auth.user!.isAdmin,
      canDelete:
        (term.ownerId === auth.user!.id || auth.user!.isAdmin) &&
        (await capabilityService.allows(auth.user!, 'corpus.write')),
    })
  }

  async update({ auth, params, request, response }: HttpContext) {
    const term = await GlossaryTerm.findOrFail(params.id)
    assertOwnedOrAdmin(term, auth.user!.id, auth.user!.isAdmin)
    const payload = await request.validateUsing(glossaryTermUpdateValidator)
    if (payload.sectionId) {
      const section = await LeitnerCourseSection.query()
        .where('id', payload.sectionId)
        .preload('course')
        .firstOrFail()
      assertVisibleOrAdmin(section.course, auth.user!.id, auth.user!.isAdmin)
    }
    term.merge({
      term: payload.term,
      aliases: payload.aliases ?? [],
      definition: payload.definition,
      leitnerCourseSectionId: payload.sectionId ?? null,
      isShared: payload.isShared ?? term.isShared,
    })
    await term.save()
    return response.json({ status: 'ok' })
  }
  async destroy({ auth, params, response }: HttpContext) {
    const term = await GlossaryTerm.findOrFail(params.id)
    assertOwnedOrAdmin(term, auth.user!.id, auth.user!.isAdmin)
    await term.delete()
    return response.status(204).send('')
  }
}
