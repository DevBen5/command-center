import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import LeitnerDraftCard from '#modules/leitner/models/leitner_draft_card'
import LeitnerIngestion from '#modules/leitner/models/leitner_ingestion'
import LeitnerCatalogService from '#modules/leitner/services/leitner_catalog_service'
import LeitnerIngestionService, {
  MAX_COURSE_CHARS,
} from '#modules/leitner/services/leitner_ingestion_service'
import LeitnerPdfService, {
  PdfExtractionError,
} from '#modules/leitner/services/leitner_pdf_service'
import {
  courseIngestionValidator,
  documentExtractValidator,
  draftCardValidator,
  draftIdsValidator,
  draftPromotionValidator,
  ingestionTitleValidator,
  TITLE_MAX_CHARS,
} from '#modules/leitner/validators/leitner'

/** Un cours plus court n'a aucun principe à en tirer : c'est une phrase, pas un cours. */
const MIN_COURSE_CHARS = 100

/** L'historique de la page d'accueil du module. */
const RECENT_INGESTIONS = 20

/**
 * Ingestion d'un cours par un LLM local : une **voie d'entrée de cartes**, pas une
 * écriture de cartes. Le modèle propose, l'utilisateur relit, corrige et valide —
 * et c'est seulement là que `LeitnerCatalogService` crée les cartes.
 *
 * Deux écrans, et c'est ce qui fait tenir l'asynchrone : `/revision/ingest` (le
 * formulaire, vierge, et l'historique) puis `/revision/ingest/:id` (la page de suivi
 * d'**un** travail — une URL par travail, qu'on peut quitter et retrouver).
 *
 * ⚠️ `LeitnerIngestionService` est **injecté** (conteneur AdonisJS) : c'est ce qui
 * permet aux tests de le résoudre avec un faux client LLM, sans réseau.
 */
@inject()
export default class LeitnerIngestionController {
  constructor(
    private ingestion: LeitnerIngestionService,
    private catalog: LeitnerCatalogService,
    private pdf: LeitnerPdfService
  ) {}

  /**
   * Le formulaire — vierge, toujours — et l'historique des travaux.
   *
   * Chaque ligne dit ce que ses brouillons sont devenus : combien restent à relire,
   * combien sont devenus des cartes, combien ont été écartés. Un travail « terminé »
   * dont tout a été rejeté et un travail dont tout attend encore ne se ressemblent pas.
   */
  async index({ inertia, session }: HttpContext) {
    const ingestions = await LeitnerIngestion.query().orderBy('id', 'desc').limit(RECENT_INGESTIONS)

    // Volumétrie personnelle : on charge et on compte en JS, comme le reste du module.
    const drafts = ingestions.length
      ? await LeitnerDraftCard.query().whereIn(
          'leitner_ingestion_id',
          ingestions.map((ingestion) => ingestion.id)
        )
      : []

    const rows = ingestions.map((ingestion) => {
      const own = drafts.filter((draft) => draft.leitnerIngestionId === ingestion.id)

      return {
        ...ingestion.serialize(),
        drafts: {
          pending: own.filter((draft) => draft.status === 'pending').length,
          accepted: own.filter((draft) => draft.status === 'accepted').length,
          rejected: own.filter((draft) => draft.status === 'rejected').length,
        },
      }
    })

    return inertia.render('modules/leitner/ingest', {
      ingestions: rows,
      maxChars: MAX_COURSE_CHARS,
      titleMaxChars: TITLE_MAX_CHARS,
      // Retours de la dernière action, flashés avant la redirection : Inertia ne
      // partage automatiquement que les erreurs de validation.
      ingestErrors: session.flashMessages.get('ingestErrors') ?? null,
    })
  }

  /**
   * Un fichier → son texte, **et rien d'autre** : ni ingestion, ni brouillon, ni la
   * moindre écriture. C'est l'équivalent ici des routes de diagnostic de `/revision/llm`.
   *
   * Le champ fichier a cessé d'être une voie de soumission pour devenir un **chargeur de
   * texte** : prévisualiser, c'est faire exister le texte **avant** le travail. Les trois
   * formats passent par ici — un PDF qu'on relit pendant qu'un `.md` part à l'aveugle
   * serait une incohérence gratuite — et `store()` ne touche plus aucun fichier.
   *
   * ⚠️ **Du JSON nu, pas de l'Inertia** (comme les routes de `/revision/llm`, et pour la
   * même raison) : la page l'appelle en `fetch`, donc avec l'en-tête `x-xsrf-token` — sans
   * lui, Shield rejette le POST. Elle envoie aussi `accept: application/json`, sans quoi un
   * refus du validateur se changerait en redirection avec erreurs flashées au lieu d'un 422.
   */
  async extract({ request, response }: HttpContext) {
    const { file } = await request.validateUsing(documentExtractValidator)

    try {
      const document = await this.pdf.extractDocument(file)
      return response.json({ ok: true, ...document, error: null })
    } catch (error) {
      // Le message d'échec est celui du service, tel quel : « scan », « protégé par mot
      // de passe » et « illisible » ne se confondent pas. Un « fichier invalide »
      // générique rendrait l'écran inutile — et l'échec n'est pas une 500 : c'est une
      // réponse, à l'endroit où l'utilisateur regarde.
      if (error instanceof PdfExtractionError) {
        return response.json({ ok: false, text: '', error: error.message })
      }
      throw error
    }
  }

  /**
   * Crée le travail en `pending`, le **lance en tâche de fond**, et redirige aussitôt
   * vers sa page de suivi. La réponse HTTP n'attend pas le LLM — c'est tout l'objet du
   * changement : un `await` sur le travail referait du synchrone avec des étapes en plus.
   *
   * Le formulaire n'a plus besoin d'être « vidé » après coup : on a changé de page.
   *
   * ⚠️ **Cette méthode ne lit plus aucun fichier** : elle ne reçoit que du texte, déjà
   * extrait et déjà relu (voir `extract()`). `source` et `sourceName` sont donc
   * **déclaratifs** — bornés par le validateur, stockés, affichés, jamais interprétés.
   */
  async store({ request, response, session }: HttpContext) {
    const payload = await request.validateUsing(courseIngestionValidator)

    const fail = (message: string) => {
      session.flash('ingestErrors', [message])
      return response.redirect().back()
    }

    const text = payload.text ?? ''
    const source = payload.source ?? 'paste'
    // Un nom de fichier n'a de sens qu'avec une origine qui en est un.
    const sourceName = source === 'paste' ? null : (payload.sourceName ?? null)

    if (text.length < MIN_COURSE_CHARS) {
      return fail(`Le cours est trop court (${MIN_COURSE_CHARS} caractères minimum).`)
    }

    // Le plafond ne borne plus une attente (plus personne n'attend) mais le travail :
    // au-delà, ce n'est plus un cours, et il se soumet chapitre par chapitre.
    if (text.length > MAX_COURSE_CHARS) {
      return fail(
        `Le cours dépasse le plafond de ${MAX_COURSE_CHARS.toLocaleString('fr-FR')} caractères ` +
          `(${text.length.toLocaleString('fr-FR')}). Découpe-le, ou soumets-le en plusieurs fois.`
      )
    }

    const ingestion = await this.ingestion.start({
      text,
      source,
      sourceName,
      title: payload.title ?? null,
    })

    return response.redirect().toPath(`/revision/ingest/${ingestion.id}`)
  }

  /**
   * La page de suivi d'un travail : la barre de progression tant qu'il tourne, les
   * brouillons à relire quand il aboutit, l'erreur brute quand il échoue.
   *
   * C'est aussi la cible de l'interrogation périodique — un **rechargement partiel**
   * d'Inertia (`router.reload({ only: [...] })`), donc cette méthode et rien d'autre :
   * pas de route JSON nue, pas de CSRF ni de sérialisation à gérer à la main.
   */
  async show({ params, inertia, session }: HttpContext) {
    const ingestion = await LeitnerIngestion.findOrFail(params.id)

    const drafts = await LeitnerDraftCard.query()
      .where('leitner_ingestion_id', ingestion.id)
      .orderBy('id', 'asc')

    const { categories } = await this.catalog.categoryTree()

    return inertia.render('modules/leitner/ingest_show', {
      ingestion,
      drafts,
      categories,
      titleMaxChars: TITLE_MAX_CHARS,
      promotionReport: session.flashMessages.get('promotionReport') ?? null,
      ingestErrors: session.flashMessages.get('ingestErrors') ?? null,
    })
  }

  /** Renommer un travail — depuis l'historique comme depuis sa page de suivi. */
  async rename({ params, request, response }: HttpContext) {
    const { title } = await request.validateUsing(ingestionTitleValidator)
    const ingestion = await LeitnerIngestion.findOrFail(params.id)

    ingestion.title = title
    await ingestion.save()

    return response.redirect().back()
  }

  /**
   * Relecture : le brouillon corrigé remplace ce que le modèle avait proposé — sans le
   * promouvoir. C'est « Enregistrer les modifications » : on met de côté, on y reviendra.
   */
  async updateDraft({ params, request, response }: HttpContext) {
    const payload = await request.validateUsing(draftCardValidator)
    await this.ingestion.saveDrafts([{ id: Number(params.id), ...payload }])

    return response.redirect().back()
  }

  /**
   * Validation : les brouillons deviennent des cartes, par le catalogue et lui seul.
   *
   * ⚠️ La requête **porte le contenu**, et il est enregistré avant la promotion : valider,
   * c'est valider ce qu'on a sous les yeux. Un `accept` sur de simples ids créerait la
   * carte avec le texte du modèle et jetterait la correction en cours — sans rien dire,
   * et sans plus rien à rattraper (le brouillon serait `accepted`).
   */
  async accept({ request, response, session }: HttpContext) {
    const { drafts } = await request.validateUsing(draftPromotionValidator)

    await this.ingestion.saveDrafts(drafts)
    const report = await this.ingestion.accept(drafts.map((draft) => draft.id))

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
