import { DateTime } from 'luxon'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'

export interface CardFilters {
  search?: string
  categoryId?: number
  themeId?: number
  box?: number
  unclassified?: boolean
}

export interface ThemeNode {
  id: number
  name: string
  cardCount: number
}

export interface CategoryNode {
  id: number
  name: string
  cardCount: number
  themes: ThemeNode[]
}

/**
 * Gestion du catalogue : cartes (liste, édition, suppression, reclassement) et
 * taxonomie catégorie → thème. La règle de répétition espacée reste dans
 * `LeitnerService`, qui n'est pas concerné par ce fichier.
 */
export default class LeitnerCatalogService {
  /**
   * Cartes de l'écran de gestion. Volumétrie personnelle : pas de pagination,
   * on renvoie tout ce qui passe les filtres.
   */
  async cards(filters: CardFilters = {}): Promise<LeitnerCard[]> {
    const query = LeitnerCard.query()
      .preload('theme', (theme) => theme.preload('category'))
      .orderBy('id', 'desc')

    if (filters.search) {
      const needle = `%${filters.search}%`
      query.where((builder) => builder.whereILike('front', needle).orWhereILike('back', needle))
    }

    if (filters.unclassified) {
      query.whereNull('leitner_theme_id')
    } else if (filters.themeId) {
      query.where('leitner_theme_id', filters.themeId)
    } else if (filters.categoryId) {
      query.whereIn('leitner_theme_id', (sub) =>
        sub.from('leitner_themes').select('id').where('leitner_category_id', filters.categoryId!)
      )
    }

    if (filters.box) query.where('box', filters.box)

    return query
  }

  /** Arbre catégories → thèmes, avec le nombre de cartes de chaque nœud. */
  async categoryTree(): Promise<{ categories: CategoryNode[]; unclassifiedCount: number }> {
    const categories = await LeitnerCategory.query()
      .preload('themes', (themes) => themes.withCount('cards').orderBy('name'))
      .orderBy('name')

    const unclassified = await LeitnerCard.query().whereNull('leitner_theme_id').count('* as total')

    return {
      categories: categories.map((category) => {
        const themes = category.themes.map((theme) => ({
          id: theme.id,
          name: theme.name,
          cardCount: Number(theme.$extras.cards_count),
        }))

        return {
          id: category.id,
          name: category.name,
          cardCount: themes.reduce((total, theme) => total + theme.cardCount, 0),
          themes,
        }
      }),
      unclassifiedCount: Number(unclassified[0].$extras.total),
    }
  }

  /** Le thème doit exister : sinon la FK sauterait à l'écriture. */
  private async assertTheme(themeId: number | null | undefined): Promise<number | null> {
    if (themeId === null || themeId === undefined) return null
    await LeitnerTheme.findOrFail(themeId)
    return themeId
  }

  async createCard(payload: {
    front: string
    back: string
    leitnerThemeId?: number | null
  }): Promise<LeitnerCard> {
    return LeitnerCard.create({
      front: payload.front,
      back: payload.back,
      leitnerThemeId: await this.assertTheme(payload.leitnerThemeId),
      box: 1,
      nextReview: DateTime.now(),
    })
  }

  async updateCard(
    card: LeitnerCard,
    payload: { front: string; back: string; leitnerThemeId?: number | null }
  ): Promise<LeitnerCard> {
    card.front = payload.front
    card.back = payload.back
    card.leitnerThemeId = await this.assertTheme(payload.leitnerThemeId)
    await card.save()
    return card
  }

  /** Suppression unitaire ou multiple. Les révisions partent en cascade (FK). */
  async deleteCards(ids: number[]): Promise<number> {
    if (ids.length === 0) return 0
    await LeitnerCard.query().whereIn('id', ids).delete()
    return ids.length
  }

  /** Reclassement multiple. `null` remet les cartes en « non classé ». */
  async assignTheme(ids: number[], themeId: number | null): Promise<number> {
    if (ids.length === 0) return 0
    await this.assertTheme(themeId)
    await LeitnerCard.query()
      .whereIn('id', ids)
      .update({ leitner_theme_id: themeId, updated_at: DateTime.now().toSQL() })
    return ids.length
  }

  /** `null` si le nom est déjà pris (l'appelant en fait une erreur de formulaire). */
  async createCategory(name: string): Promise<LeitnerCategory | null> {
    if (await LeitnerCategory.findBy('name', name)) return null
    return LeitnerCategory.create({ name })
  }

  async renameCategory(category: LeitnerCategory, name: string): Promise<LeitnerCategory | null> {
    const clash = await LeitnerCategory.query()
      .where('name', name)
      .whereNot('id', category.id)
      .first()
    if (clash) return null

    category.name = name
    await category.save()
    return category
  }

  /** Supprime la catégorie, ses thèmes (cascade) ; ses cartes deviennent non classées. */
  async deleteCategory(category: LeitnerCategory): Promise<void> {
    await category.delete()
  }

  async createTheme(categoryId: number, name: string): Promise<LeitnerTheme | null> {
    await LeitnerCategory.findOrFail(categoryId)

    const clash = await LeitnerTheme.query()
      .where('leitner_category_id', categoryId)
      .where('name', name)
      .first()
    if (clash) return null

    return LeitnerTheme.create({ leitnerCategoryId: categoryId, name })
  }

  /** Renommer et/ou déplacer un thème dans une autre catégorie. */
  async updateTheme(
    theme: LeitnerTheme,
    payload: { name: string; leitnerCategoryId: number }
  ): Promise<LeitnerTheme | null> {
    await LeitnerCategory.findOrFail(payload.leitnerCategoryId)

    const clash = await LeitnerTheme.query()
      .where('leitner_category_id', payload.leitnerCategoryId)
      .where('name', payload.name)
      .whereNot('id', theme.id)
      .first()
    if (clash) return null

    theme.name = payload.name
    theme.leitnerCategoryId = payload.leitnerCategoryId
    await theme.save()
    return theme
  }

  /** Supprime le thème ; ses cartes deviennent non classées (FK ON DELETE SET NULL). */
  async deleteTheme(theme: LeitnerTheme): Promise<void> {
    await theme.delete()
  }
}
