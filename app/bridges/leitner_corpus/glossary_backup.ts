import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import GlossaryTerm from '#modules/corpus/models/glossary_term'
import LeitnerCourseSection from '#modules/corpus/models/leitner_course_section'
import { applyVisibility, isVisible } from '#core/shared/services/visibility'

export interface BackupGlossaryTerm {
  term: string
  aliases?: string[]
  definition: string
  shared?: boolean
  createdAt?: string
  updatedAt?: string
  section?: { courseTitle: string; slug: string; courseHash?: string } | null
}

export async function exportTerms(userId: number, isAdmin: boolean): Promise<BackupGlossaryTerm[]> {
  const query = GlossaryTerm.query()
    .preload('courseSection', (section) => section.preload('course'))
    .orderBy('id')
  applyVisibility(query, 'glossary_terms', userId, isAdmin)
  const terms = await query
  return terms.map((term) => ({
    term: term.term,
    aliases: term.aliases,
    definition: term.definition,
    shared: term.isShared,
    createdAt: term.createdAt.toISO()!,
    updatedAt: term.updatedAt.toISO()!,
    section:
      term.courseSection && isVisible(term.courseSection.course, userId, isAdmin)
        ? {
            courseTitle: term.courseSection.course.title,
            slug: term.courseSection.slug,
            courseHash: term.courseSection.course.contentHash,
          }
        : null,
  }))
}

export async function importTerms(
  terms: BackupGlossaryTerm[],
  userId: number,
  trx: TransactionClientContract
) {
  const report = { termsCreated: 0, termsSkipped: 0, termLinksLost: 0 }
  for (const term of terms) {
    let sectionId: number | null = null
    if (term.section) {
      const section = await LeitnerCourseSection.query({ client: trx })
        .where('slug', term.section.slug)
        .whereHas('course', (course) => {
          course.where('owner_id', userId).where('title', term.section!.courseTitle)
          if (term.section!.courseHash) course.where('content_hash', term.section!.courseHash)
        })
        .first()
      sectionId = section?.id ?? null
      if (!section) report.termLinksLost++
    }
    const aliases = term.aliases ?? []
    const existing = await GlossaryTerm.query({ client: trx })
      .where('owner_id', userId)
      .where('term', term.term)
      .where('definition', term.definition)
      .where('is_shared', term.shared ?? false)
      .whereRaw('aliases = ?::jsonb', [JSON.stringify(aliases)])
      .where((query) =>
        sectionId === null
          ? query.whereNull('leitner_course_section_id')
          : query.where('leitner_course_section_id', sectionId)
      )
      .first()
    if (existing) {
      report.termsSkipped++
      continue
    }
    await GlossaryTerm.create(
      {
        term: term.term,
        aliases,
        definition: term.definition,
        isShared: term.shared ?? false,
        ownerId: userId,
        leitnerCourseSectionId: sectionId,
        ...(term.createdAt ? { createdAt: DateTime.fromISO(term.createdAt) } : {}),
        ...(term.updatedAt ? { updatedAt: DateTime.fromISO(term.updatedAt) } : {}),
      },
      { client: trx }
    )
    report.termsCreated++
  }
  return report
}
