import type { HttpContext } from '@adonisjs/core/http'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'
import LeitnerCatalogService from '#modules/leitner/services/leitner_catalog_service'
import {
  cardIdsValidator,
  cardValidator,
  cardsThemeValidator,
  categoryValidator,
  themeValidator,
} from '#modules/leitner/validators/leitner'

/** `null` dès que la valeur est absente ou non numérique (query string). */
function toId(value: unknown): number | undefined {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : undefined
}

export default class LeitnerSettingsController {
  private service = new LeitnerCatalogService()

  async index({ inertia, request }: HttpContext) {
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

    return inertia.render('modules/leitner/settings', {
      cards,
      categories,
      unclassifiedCount,
      totalCards: Number(total[0].$extras.total),
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
  | Cartes
  |----------------------------------------------------------------------------
  */

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
