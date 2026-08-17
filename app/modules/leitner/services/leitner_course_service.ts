import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import LeitnerCourse, { type CourseSource } from '#modules/leitner/models/leitner_course'
import LeitnerCourseSection from '#modules/leitner/models/leitner_course_section'
import {
  hashCourseMarkdown,
  splitCourseIntoSections,
} from '#modules/leitner/services/leitner_course_sections'

/**
 * Le corpus de cours (CC-251) : dédup à deux détections, remplacement avec pierres
 * tombales, suppression, purge. La partie **DB** — le découpage et l'empreinte, purs,
 * vivent dans `leitner_course_sections.ts`.
 */

export type CreateConflict =
  | { status: 'attached'; course: LeitnerCourse }
  | { status: 'created'; course: LeitnerCourse }
  | { status: 'conflict'; existing: LeitnerCourse }

/** 23505 = violation d'unicité Postgres — voir `coffre_door_controller.ts` pour le patron. */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string }).code === '23505'
}

export default class LeitnerCourseService {
  /**
   * Insère les sections d'un cours **fraîchement créé** — aucune pierre tombale possible
   * ici, il n'y a rien à remplacer.
   */
  async #insertSections(courseId: number, markdown: string): Promise<void> {
    const sections = splitCourseIntoSections(markdown)
    for (const section of sections) {
      await LeitnerCourseSection.create({
        courseId,
        slug: section.slug,
        headingPath: section.headingPath,
        body: section.body,
        aliases: section.aliases,
        obsoleteAt: null,
      })
    }
  }

  /**
   * Crée un cours si aucun conflit, ou signale lequel : **même empreinte** → `attached`
   * (rattachement à l'existant, rien de créé) ; **même titre, texte différent** →
   * `conflict` (c'est une mise à jour potentielle, pas un doublon — voir
   * `resolveConflict`). Les deux détections sont scopées au propriétaire, jamais
   * globales.
   */
  async createOrDetectConflict(
    userId: number,
    input: { title: string; markdown: string; source: CourseSource; isShared?: boolean }
  ): Promise<CreateConflict> {
    const contentHash = hashCourseMarkdown(input.markdown)

    const byHash = await LeitnerCourse.query()
      .where('owner_id', userId)
      .where('content_hash', contentHash)
      .first()
    if (byHash) return { status: 'attached', course: byHash }

    const byTitle = await LeitnerCourse.query()
      .where('owner_id', userId)
      .where('title', input.title)
      .first()
    if (byTitle) return { status: 'conflict', existing: byTitle }

    try {
      const course = await db.transaction(async (trx) => {
        const created = await LeitnerCourse.create(
          {
            title: input.title,
            markdown: input.markdown,
            contentHash,
            source: input.source,
            ownerId: userId,
            isShared: input.isShared ?? false,
          },
          { client: trx }
        )
        await this.#insertSections(created.id, input.markdown)
        return created
      })
      return { status: 'created', course }
    } catch (error) {
      // Course posé entre notre lecture et notre écriture : l'état visé est atteint,
      // pas par nous. On relit plutôt que de laisser filer une 500 sur un cas normal.
      if (!isUniqueViolation(error)) throw error
      const raced = await LeitnerCourse.query()
        .where('owner_id', userId)
        .where('content_hash', contentHash)
        .firstOrFail()
      return { status: 'attached', course: raced }
    }
  }

  /**
   * Résout un conflit de titre affiché par le dialogue à 3 issues. `replace` réutilise
   * `replaceMarkdown` (donc la doctrine des pierres tombales) ; `createSecond` crée un
   * cours distinct sous un titre suffixé — le titre d'origine reste pris par l'existant.
   */
  async resolveConflict(
    userId: number,
    existingId: number,
    resolution: 'replace' | 'createSecond',
    input: { title: string; markdown: string; source: CourseSource }
  ): Promise<LeitnerCourse> {
    if (resolution === 'replace') {
      return this.replaceMarkdown(existingId, input.markdown)
    }

    const title = await this.#uniqueTitle(userId, input.title)
    const result = await this.createOrDetectConflict(userId, {
      title,
      markdown: input.markdown,
      source: input.source,
    })
    // `title` vient d'être garanti libre à l'instant : un `conflict` ici serait une
    // course avec un autre appelant, couverte par `isUniqueViolation` plus haut.
    if (result.status === 'conflict') {
      throw new Error('Le titre suffixé est resté indisponible — réessaie.')
    }
    return result.course
  }

  /**
   * Trouve un titre libre pour `userId` en suffixant `" (2)"`, `" (3)"`… — utilisé par
   * `resolveConflict` (« Créer un second cours ») et par la création silencieuse depuis
   * une ingestion, où aucun dialogue n'est possible (flux asynchrone).
   */
  async #uniqueTitle(userId: number, base: string): Promise<string> {
    let candidate = base
    let attempt = 2
    // Quelques itérations suffisent en pratique ; pas de plafond dur, le titre reste
    // borné en longueur par TITLE_MAX_CHARS côté validateur.
    while (
      await LeitnerCourse.query().where('owner_id', userId).where('title', candidate).first()
    ) {
      candidate = `${base} (${attempt})`
      attempt++
    }
    return candidate
  }

  /**
   * Le chemin de l'ingestion (case « conserver ce cours ») : **aucun dialogue possible**,
   * le POST redirige aussitôt vers la page de suivi. Même empreinte → rattaché
   * silencieusement (reprise après un `failed`, exactement le cas 1 de la dédup). Même
   * titre, texte différent → suffixé automatiquement, jamais bloqué.
   */
  async createOrAttachSilently(
    userId: number,
    input: { title: string; markdown: string }
  ): Promise<LeitnerCourse> {
    const result = await this.createOrDetectConflict(userId, {
      title: input.title,
      markdown: input.markdown,
      source: 'ingest',
    })
    if (result.status !== 'conflict') return result.course

    const title = await this.#uniqueTitle(userId, input.title)
    const created = await this.createOrDetectConflict(userId, {
      title,
      markdown: input.markdown,
      source: 'ingest',
    })
    if (created.status === 'conflict') {
      throw new Error('Le titre suffixé est resté indisponible — réessaie.')
    }
    return created.course
  }

  /**
   * Remplace le markdown d'un cours et applique la doctrine des pierres tombales :
   * slug retrouvé (vivant ou tombé) → section mise à jour, ressuscitée si besoin ; slug
   * neuf → créé ; slug d'une section vivante disparue → `obsolete_at` posé, texte
   * **conservé**, jamais supprimé.
   */
  async replaceMarkdown(courseId: number, markdown: string): Promise<LeitnerCourse> {
    return db.transaction(async (trx) => {
      const course = await LeitnerCourse.findOrFail(courseId, { client: trx })
      const nextSections = splitCourseIntoSections(markdown)
      const existingSections = await LeitnerCourseSection.query({ client: trx }).where(
        'course_id',
        courseId
      )
      const existingBySlug = new Map(existingSections.map((section) => [section.slug, section]))
      const nextSlugs = new Set(nextSections.map((section) => section.slug))

      for (const section of nextSections) {
        const existing = existingBySlug.get(section.slug)
        if (existing) {
          existing.headingPath = section.headingPath
          existing.body = section.body
          existing.aliases = section.aliases
          existing.obsoleteAt = null
          await existing.useTransaction(trx).save()
        } else {
          await LeitnerCourseSection.create(
            {
              courseId,
              slug: section.slug,
              headingPath: section.headingPath,
              body: section.body,
              aliases: section.aliases,
              obsoleteAt: null,
            },
            { client: trx }
          )
        }
      }

      // Une section vivante dont le slug n'apparaît plus devient une pierre tombale —
      // jamais supprimée. Une section déjà tombée qui n'apparaît toujours pas n'a rien
      // à changer.
      for (const existing of existingSections) {
        if (!nextSlugs.has(existing.slug) && existing.obsoleteAt === null) {
          existing.obsoleteAt = DateTime.now()
          await existing.useTransaction(trx).save()
        }
      }

      course.markdown = markdown
      course.contentHash = hashCourseMarkdown(markdown)
      await course.useTransaction(trx).save()

      return course
    })
  }

  /** Cascade réelle sur les sections — aucune carte de provenance n'existe encore. */
  async destroy(courseId: number): Promise<void> {
    const course = await LeitnerCourse.findOrFail(courseId)
    await course.delete()
  }

  /** Geste manuel : supprime physiquement les pierres tombales d'un cours. */
  async purgeTombstones(courseId: number): Promise<number> {
    return LeitnerCourseSection.query()
      .where('course_id', courseId)
      .whereNotNull('obsolete_at')
      .delete()
      .then((result) => Number(result[0] ?? 0))
  }
}
