import type { HttpContext } from '@adonisjs/core/http'
import { renderMarkdown } from '#core/shared/services/markdown_renderer'
import LeitnerCourse from '#modules/leitner/models/leitner_course'
import LeitnerCourseSection from '#modules/leitner/models/leitner_course_section'
import LeitnerCourseService from '#modules/leitner/services/leitner_course_service'
import {
  applyVisibility,
  assertOwnedOrAdmin,
  assertVisibleOrAdmin,
} from '#modules/leitner/services/leitner_visibility'
import {
  courseConflictValidator,
  courseCreateValidator,
  courseReplaceValidator,
} from '#modules/leitner/validators/leitner'

/**
 * Le corpus de cours (CC-251). ⚠️ **Toute route qui porte du markdown en corps de
 * requête rend du JSON nu, jamais une redirection Inertia** — le store de session est
 * `cookie` (CC-78) : un échec de validation flasherait le texte entier du cours dedans,
 * la même faille que CC-179 a fermée sur le coffre. Seules `destroy` et `purge`, qui ne
 * portent aucun texte, restent en redirection classique.
 *
 * ⚠️ **Aucun fichier `.md` n'est téléversé au serveur.** Contrairement au PDF de
 * l'ingestion, un `.md` n'a besoin d'aucune extraction : la page le lit avec
 * `FileReader` côté client et envoie du texte, comme un collage — `source` reste
 * déclarative (`paste`/`file`), jamais interprétée.
 */
export default class LeitnerCourseController {
  private courses = new LeitnerCourseService()

  async index({ auth, inertia }: HttpContext) {
    const userId = auth.user!.id
    const isAdmin = auth.user!.isAdmin

    const query = LeitnerCourse.query().orderBy('created_at', 'desc')
    applyVisibility(query, 'leitner_courses', userId, isAdmin)
    const courses = await query

    return inertia.render('modules/leitner/cours', {
      courses: courses.map((course) => ({
        id: course.id,
        title: course.title,
        source: course.source,
        isShared: course.isShared,
        mine: course.ownerId === userId,
        createdAt: course.createdAt.toISO(),
      })),
    })
  }

  /**
   * Création : JSON nu. Rend `{ status: 'created' | 'attached', course }` ou
   * `{ status: 'conflict', existing }` — le client garde le markdown soumis en mémoire
   * et affiche le dialogue à 3 issues sans jamais le renvoyer au serveur avant que
   * l'utilisateur ait choisi.
   */
  async store({ auth, request, response }: HttpContext) {
    const payload = await request.validateUsing(courseCreateValidator)

    const result = await this.courses.createOrDetectConflict(auth.user!.id, {
      title: payload.title,
      markdown: payload.markdown,
      source: payload.source ?? 'paste',
    })

    if (result.status === 'conflict') {
      return response.json({
        status: 'conflict',
        existing: { id: result.existing.id, title: result.existing.title },
      })
    }

    return response.json({ status: result.status, course: { id: result.course.id } })
  }

  /** Résolution du dialogue à 3 issues. `cancel` ne touche rien. */
  async resolveConflict({ auth, request, response }: HttpContext) {
    const payload = await request.validateUsing(courseConflictValidator)

    if (payload.resolution === 'cancel') {
      return response.json({ status: 'cancelled' })
    }
    if (!payload.title || !payload.markdown) {
      return response.status(422).json({ error: 'Titre et markdown sont requis.' })
    }

    const course = await this.courses.resolveConflict(
      auth.user!.id,
      payload.existingId,
      payload.resolution,
      { title: payload.title, markdown: payload.markdown, source: payload.source ?? 'paste' }
    )

    return response.json({ status: 'ok', course: { id: course.id } })
  }

  async show({ auth, params, inertia }: HttpContext) {
    const course = await LeitnerCourse.findOrFail(params.id)
    assertVisibleOrAdmin(course, auth.user!.id, auth.user!.isAdmin)

    const sections = await LeitnerCourseSection.query()
      .where('course_id', course.id)
      .orderBy('id', 'asc')

    return inertia.render('modules/leitner/cours_show', {
      course: {
        id: course.id,
        title: course.title,
        markdown: course.markdown,
        source: course.source,
        isShared: course.isShared,
        mine: course.ownerId === auth.user!.id,
        createdAt: course.createdAt.toISO(),
      },
      sections: sections.map((section) => ({
        id: section.id,
        slug: section.slug,
        headingPath: section.headingPath,
        bodyHtml: renderMarkdown(section.body),
        aliases: section.aliases,
        obsoleteAt: section.obsoleteAt?.toISO() ?? null,
      })),
    })
  }

  /** Remplacement du contenu : JSON nu, même raison que `store`. */
  async update({ auth, params, request, response }: HttpContext) {
    const course = await LeitnerCourse.findOrFail(params.id)
    assertOwnedOrAdmin(course, auth.user!.id, auth.user!.isAdmin)

    const payload = await request.validateUsing(courseReplaceValidator)

    try {
      await this.courses.replaceMarkdown(course.id, payload.markdown)
    } catch (error) {
      if ((error as { code?: string }).code !== '23505') throw error
      return response
        .status(422)
        .json({ error: 'Un autre de tes cours porte déjà ce contenu mot pour mot.' })
    }

    return response.json({ status: 'ok' })
  }

  async destroy({ auth, params, response }: HttpContext) {
    const course = await LeitnerCourse.findOrFail(params.id)
    assertOwnedOrAdmin(course, auth.user!.id, auth.user!.isAdmin)
    await this.courses.destroy(course.id)
    return response.redirect().toPath('/revision/cours')
  }

  /** Purge manuelle des pierres tombales — aucun texte en jeu, redirection classique. */
  async purge({ auth, params, response, session }: HttpContext) {
    const course = await LeitnerCourse.findOrFail(params.id)
    assertOwnedOrAdmin(course, auth.user!.id, auth.user!.isAdmin)
    const purged = await this.courses.purgeTombstones(course.id)
    session.flash('coursNotice', { purged })
    return response.redirect().back()
  }

  /**
   * Le contenu d'UNE section, pour la modale de mots-clés du recto (CC-254). GET, donc pas
   * de jeton CSRF ; la visibilité passe quand même par le cours parent, comme partout
   * ailleurs dans ce module — `leitner_course_sections` n'a pas de propriétaire propre.
   *
   * ⚠️ **Ne filtre pas `obsoleteAt`**, même doctrine que `show()` : une section tombée reste
   * consultable. Un terme du glossaire ne pointe jamais vers une tombe (l'index l'exclut),
   * mais un cours peut être remplacé entre le rendu de la page et le clic — le lien reste
   * valide plutôt que de lever une erreur sur une course résiduelle.
   */
  async sectionContent({ auth, params, response }: HttpContext) {
    const section = await LeitnerCourseSection.query()
      .where('id', params.id)
      .preload('course')
      .firstOrFail()
    assertVisibleOrAdmin(section.course, auth.user!.id, auth.user!.isAdmin)

    return response.json({
      id: section.id,
      courseId: section.courseId,
      courseTitle: section.course.title,
      headingPath: section.headingPath,
      bodyHtml: renderMarkdown(section.body),
      aliases: section.aliases,
    })
  }
}
