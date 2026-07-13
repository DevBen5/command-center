import { readFile } from 'node:fs/promises'
import type { MultipartFile } from '@adonisjs/core/bodyparser'
import type { HttpContext } from '@adonisjs/core/http'
import { errors as vineErrors } from '@vinejs/vine'
import { DateTime } from 'luxon'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'
import LeitnerBackupService, {
  BACKUP_VERSION,
  BackupImportError,
} from '#modules/leitner/services/leitner_backup_service'
import type { ImportMode } from '#modules/leitner/services/leitner_backup_service'
import LeitnerCatalogService from '#modules/leitner/services/leitner_catalog_service'
import LeitnerService from '#modules/leitner/services/leitner_service'
import {
  backupImportValidator,
  backupValidator,
  boxIntervalsValidator,
  cardIdsValidator,
  cardValidator,
  cardsThemeValidator,
  categoryValidator,
  themeValidator,
} from '#modules/leitner/validators/leitner'

/** Au-delà, la liste d'erreurs devient illisible : on dit ce qui est masqué. */
const MAX_REPORTED_ERRORS = 10

/** `null` dès que la valeur est absente ou non numérique (query string). */
function toId(value: unknown): number | undefined {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : undefined
}

export default class LeitnerSettingsController {
  private service = new LeitnerCatalogService()
  private leitner = new LeitnerService()
  private backup = new LeitnerBackupService()

  async index({ inertia, request, session }: HttpContext) {
    const filters = {
      search: (request.input('search') as string | undefined)?.trim() || undefined,
      categoryId: toId(request.input('categoryId')),
      themeId: toId(request.input('themeId')),
      box: toId(request.input('box')),
      unclassified: request.input('unclassified') === '1',
    }

    const cards = await this.service.cards(filters)
    const { categories, unclassifiedCount } = await this.service.categoryTree()
    const total = await LeitnerCard.query().count('* as total')
    const boxIntervals = await this.leitner.boxIntervals()

    return inertia.render('modules/leitner/settings', {
      cards,
      categories,
      unclassifiedCount,
      totalCards: Number(total[0].$extras.total),
      boxIntervals,
      // Retour du dernier import, flashé par `importBackup` juste avant sa redirection.
      importReport: session.flashMessages.get('importReport') ?? null,
      importErrors: session.flashMessages.get('importErrors') ?? null,
      filters: {
        search: filters.search ?? '',
        categoryId: filters.categoryId ?? null,
        themeId: filters.themeId ?? null,
        box: filters.box ?? null,
        unclassified: filters.unclassified,
      },
    })
  }

  /*
  |----------------------------------------------------------------------------
  | Sauvegarde — export JSON
  |----------------------------------------------------------------------------
  */

  /**
   * Réponse HTTP **nue**, hors Inertia : c'est un téléchargement de fichier.
   * Côté Vue, le lien doit être un `<a href>` natif — un `<Link>` ou un
   * `router.get()` attendrait une réponse Inertia et casserait sur ce JSON.
   */
  async exportBackup({ response }: HttpContext) {
    const backup = await this.backup.export()

    response.header('content-type', 'application/json; charset=utf-8')
    response.header(
      'content-disposition',
      `attachment; filename="leitner-${DateTime.now().toFormat('yyyy-LL-dd')}.json"`
    )
    // Indenté : le fichier se relit et se retouche à la main (saisie en masse).
    return response.send(JSON.stringify(backup, null, 2))
  }

  /*
  |----------------------------------------------------------------------------
  | Sauvegarde — import JSON
  |----------------------------------------------------------------------------
  */

  /**
   * Le fichier vient de l'utilisateur : rien n'y est fiable. Il passe donc par
   * `backupValidator` (contenu, pas extension) avant d'atteindre la base, et
   * l'écriture est transactionnelle — un fichier invalide n'écrit **rien**.
   *
   * Le retour part en flash et revient en props sur `index` : ni le rapport ni
   * les erreurs ne se perdent dans la redirection.
   */
  async importBackup({ request, response, session }: HttpContext) {
    const fail = (messages: string[]) => {
      const shown = messages.slice(0, MAX_REPORTED_ERRORS)
      if (messages.length > MAX_REPORTED_ERRORS) {
        shown.push(`… et ${messages.length - MAX_REPORTED_ERRORS} autre(s) erreur(s).`)
      }
      session.flash('importErrors', shown)
      return response.redirect().back()
    }

    let upload: { file: MultipartFile; mode?: ImportMode }
    try {
      upload = await request.validateUsing(backupImportValidator)
    } catch (error) {
      if (error instanceof vineErrors.E_VALIDATION_ERROR) {
        return fail(error.messages.map((message: { message: string }) => message.message))
      }
      throw error
    }

    const mode = upload.mode ?? 'merge'

    let content: unknown
    try {
      content = JSON.parse(await readFile(upload.file.tmpPath!, 'utf-8'))
    } catch {
      return fail(["Fichier illisible : ce n'est pas du JSON valide."])
    }

    let backup
    try {
      backup = await backupValidator.validate(content)
    } catch (error) {
      if (error instanceof vineErrors.E_VALIDATION_ERROR) {
        return fail(
          error.messages.map(
            (message: { field: string; message: string }) => `${message.field} : ${message.message}`
          )
        )
      }
      throw error
    }

    // Une version inconnue est refusée, jamais importée « au mieux » : on ne comprend
    // pas le format, donc on ne devine pas. Un fichier sans version est un fichier
    // écrit à la main, lu comme la version courante.
    if (backup.version !== undefined && backup.version !== BACKUP_VERSION) {
      return fail([
        `Version de fichier inconnue (${backup.version}). Cette application lit la version ${BACKUP_VERSION}.`,
      ])
    }

    try {
      session.flash('importReport', await this.backup.import(backup, mode))
    } catch (error) {
      // Rien n'a été écrit : l'import vit dans une transaction.
      if (error instanceof BackupImportError) return fail([error.message])
      throw error
    }

    return response.redirect().back()
  }

  /*
  |----------------------------------------------------------------------------
  | Intervalles des boîtes
  |----------------------------------------------------------------------------
  */

  /**
   * Les cartes déjà notées gardent l'échéance calculée avec l'ancien intervalle :
   * le nouveau réglage ne vaut que pour les révisions à venir.
   */
  async updateIntervals({ request, response }: HttpContext) {
    const payload = await request.validateUsing(boxIntervalsValidator)
    await this.leitner.updateBoxIntervals({
      1: payload.box1Days,
      2: payload.box2Days,
      3: payload.box3Days,
      4: payload.box4Days,
      5: payload.box5Days,
    })
    return response.redirect().back()
  }

  /*
  |----------------------------------------------------------------------------
  | Cartes
  |----------------------------------------------------------------------------
  */

  async store({ request, response }: HttpContext) {
    const payload = await request.validateUsing(cardValidator)
    await this.service.createCard(payload)
    return response.redirect().back()
  }

  async update({ params, request, response }: HttpContext) {
    const payload = await request.validateUsing(cardValidator)
    const card = await LeitnerCard.findOrFail(params.id)
    await this.service.updateCard(card, payload)
    return response.redirect().back()
  }

  async destroy({ params, response }: HttpContext) {
    const card = await LeitnerCard.findOrFail(params.id)
    await this.service.deleteCards([card.id])
    return response.redirect().back()
  }

  async destroyMany({ request, response }: HttpContext) {
    const { ids } = await request.validateUsing(cardIdsValidator)
    await this.service.deleteCards(ids)
    return response.redirect().back()
  }

  async assignTheme({ request, response }: HttpContext) {
    const { ids, leitnerThemeId } = await request.validateUsing(cardsThemeValidator)
    await this.service.assignTheme(ids, leitnerThemeId)
    return response.redirect().back()
  }

  /*
  |----------------------------------------------------------------------------
  | Catégories
  |----------------------------------------------------------------------------
  */

  async storeCategory({ request, response, session }: HttpContext) {
    const { name } = await request.validateUsing(categoryValidator)
    const created = await this.service.createCategory(name)
    if (!created) session.flash('errors', { name: 'Cette catégorie existe déjà.' })
    return response.redirect().back()
  }

  async updateCategory({ params, request, response, session }: HttpContext) {
    const { name } = await request.validateUsing(categoryValidator)
    const category = await LeitnerCategory.findOrFail(params.id)
    const updated = await this.service.renameCategory(category, name)
    if (!updated) session.flash('errors', { name: 'Cette catégorie existe déjà.' })
    return response.redirect().back()
  }

  async destroyCategory({ params, response }: HttpContext) {
    const category = await LeitnerCategory.findOrFail(params.id)
    await this.service.deleteCategory(category)
    return response.redirect().back()
  }

  /*
  |----------------------------------------------------------------------------
  | Thèmes
  |----------------------------------------------------------------------------
  */

  async storeTheme({ request, response, session }: HttpContext) {
    const { name, leitnerCategoryId } = await request.validateUsing(themeValidator)
    const created = await this.service.createTheme(leitnerCategoryId, name)
    if (!created) session.flash('errors', { name: 'Ce thème existe déjà dans cette catégorie.' })
    return response.redirect().back()
  }

  async updateTheme({ params, request, response, session }: HttpContext) {
    const payload = await request.validateUsing(themeValidator)
    const theme = await LeitnerTheme.findOrFail(params.id)
    const updated = await this.service.updateTheme(theme, payload)
    if (!updated) session.flash('errors', { name: 'Ce thème existe déjà dans cette catégorie.' })
    return response.redirect().back()
  }

  async destroyTheme({ params, response }: HttpContext) {
    const theme = await LeitnerTheme.findOrFail(params.id)
    await this.service.deleteTheme(theme)
    return response.redirect().back()
  }
}
