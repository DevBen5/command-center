import { readFile } from 'node:fs/promises'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import LeitnerDraftCard from '#modules/leitner/models/leitner_draft_card'
import LeitnerIngestion from '#modules/leitner/models/leitner_ingestion'
import LeitnerCatalogService from '#modules/leitner/services/leitner_catalog_service'
import LeitnerIngestionService, {
  MAX_COURSE_CHARS,
} from '#modules/leitner/services/leitner_ingestion_service'
import {
  courseIngestionValidator,
  draftCardValidator,
  draftIdsValidator,
} from '#modules/leitner/validators/leitner'

/** Un cours plus court n'a aucun principe à en tirer : c'est une phrase, pas un cours. */
const MIN_COURSE_CHARS = 100

/** Les dernières ingestions listées dans la colonne de droite. */
const RECENT_INGESTIONS = 10

/**
 * Ingestion d'un cours par un LLM local : une **voie d'entrée de cartes**, pas une
 * écriture de cartes. Le modèle propose, l'utilisateur relit, corrige et valide —
 * et c'est seulement là que `LeitnerCatalogService` crée les cartes.
 *
 * ⚠️ `LeitnerIngestionService` est **injecté** (conteneur AdonisJS) : c'est ce qui
 * permet aux tests de le résoudre avec un faux client LLM, sans réseau.
 */
@inject()
export default class LeitnerIngestionController {
  constructor(
    private ingestion: LeitnerIngestionService,
    private catalog: LeitnerCatalogService
  ) {}

  async index({ inertia, request, session }: HttpContext) {
    const ingestions = await LeitnerIngestion.query().orderBy('id', 'desc').limit(RECENT_INGESTIONS)

    // Par défaut, la dernière ingestion : c'est celle qu'on vient de lancer.
    const requested = Number(request.input('id'))
    const current = Number.isInteger(requested)
      ? await LeitnerIngestion.find(requested)
      : (ingestions[0] ?? null)

    const drafts = current
      ? await LeitnerDraftCard.query()
          .where('leitner_ingestion_id', current.id)
          .orderBy('id', 'asc')
      : []

    const { categories } = await this.catalog.categoryTree()

    return inertia.render('modules/leitner/ingest', {
      ingestions,
      current,
      drafts,
      categories,
      maxChars: MAX_COURSE_CHARS,
      // Retours de la dernière action, flashés avant la redirection : Inertia ne
      // partage automatiquement que les erreurs de validation.
      promotionReport: session.flashMessages.get('promotionReport') ?? null,
      ingestErrors: session.flashMessages.get('ingestErrors') ?? null,
    })
  }

  /**
   * Synchrone (lot 1) : la requête attend le LLM, morceau par morceau. D'où le plafond
   * de taille — c'est lui, et le timeout du client, qui bornent l'attente.
   *
   * Un échec du LLM ne lève pas : il laisse une ingestion `failed` porteuse de son
   * message, et **aucun brouillon**. La page l'affiche.
   */
  async store({ request, response, session }: HttpContext) {
    const payload = await request.validateUsing(courseIngestionValidator)

    const fail = (message: string) => {
      session.flash('ingestErrors', [message])
      return response.redirect().back()
    }

    let text = payload.text ?? ''
    let source: 'paste' | 'file' = 'paste'
    let sourceName: string | null = null

    if (payload.file) {
      const content = await readFile(payload.file.tmpPath!, 'utf-8')
      text = content.trim()
      source = 'file'
      sourceName = payload.file.clientName
    }

    if (text.length < MIN_COURSE_CHARS) {
      return fail(`Le cours est trop court (${MIN_COURSE_CHARS} caractères minimum).`)
    }

    // Le plafond vaut pour le texte collé comme pour le fichier : c'est la taille de
    // l'entrée qui borne le nombre d'appels au LLM, donc l'attente de la requête HTTP.
    if (text.length > MAX_COURSE_CHARS) {
      return fail(
        `Le cours dépasse le plafond de ${MAX_COURSE_CHARS.toLocaleString('fr-FR')} caractères ` +
          `(${text.length.toLocaleString('fr-FR')}). Découpe-le, ou soumets-le en plusieurs fois.`
      )
    }

    const ingestion = await this.ingestion.ingest({ text, source, sourceName })
    return response.redirect().toPath(`/revision/ingest?id=${ingestion.id}`)
  }

  /** Relecture : le brouillon corrigé remplace ce que le modèle avait proposé. */
  async updateDraft({ params, request, response }: HttpContext) {
    const payload = await request.validateUsing(draftCardValidator)
    const draft = await LeitnerDraftCard.findOrFail(params.id)

    draft.front = payload.front
    draft.back = payload.back
    draft.category = payload.category ?? null
    draft.theme = payload.theme ?? null
    await draft.save()

    return response.redirect().back()
  }

  /** Validation : les brouillons deviennent des cartes, par le catalogue et lui seul. */
  async accept({ request, response, session }: HttpContext) {
    const { ids } = await request.validateUsing(draftIdsValidator)
    const report = await this.ingestion.accept(ids)

    if (report.errors.length > 0) session.flash('ingestErrors', report.errors)
    session.flash('promotionReport', {
      cardsCreated: report.cardsCreated,
      cardsSkipped: report.cardsSkipped,
    })

    return response.redirect().back()
  }

  async reject({ request, response }: HttpContext) {
    const { ids } = await request.validateUsing(draftIdsValidator)
    await this.ingestion.reject(ids)
    return response.redirect().back()
  }

  /** Supprime l'ingestion et ses brouillons (cascade). Les cartes déjà validées restent. */
  async destroy({ params, response }: HttpContext) {
    const ingestion = await LeitnerIngestion.findOrFail(params.id)
    await ingestion.delete()
    return response.redirect().toPath('/revision/ingest')
  }
}
