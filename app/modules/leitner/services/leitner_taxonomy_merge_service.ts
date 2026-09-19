import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'
import { assertOwnedOrAdmin } from '#core/shared/services/visibility'
import { normalizeTaxonomyName } from '#modules/leitner/services/leitner_catalog_service'

export type TaxonomyMergeKind = 'category' | 'theme'

export interface TaxonomyMergeInput {
  kind: TaxonomyMergeKind
  sourceId: number
  targetId: number
}

export interface TaxonomyMergePreview {
  kind: TaxonomyMergeKind
  sourceId: number
  targetId: number
  sourceName: string
  targetName: string
  sourceChildren: number
  collisionCount: number
  cardsToMove: number
}

interface MergePlan {
  preview: TaxonomyMergePreview
  source: LeitnerCategory | LeitnerTheme
  target: LeitnerCategory | LeitnerTheme
  sourceThemes: LeitnerTheme[]
  targetThemes: LeitnerTheme[]
  sourceCards: LeitnerCard[]
}

/** Fusion manuelle de taxonomie : le seul point d'écriture massive du module. */
export default class LeitnerTaxonomyMergeService {
  async preview(
    input: TaxonomyMergeInput,
    userId: number,
    isAdmin: boolean = false
  ): Promise<TaxonomyMergePreview> {
    return db.transaction((trx) =>
      this.loadPlan(trx, input, userId, isAdmin).then((plan) => plan.preview)
    )
  }

  async merge(
    input: TaxonomyMergeInput,
    userId: number,
    isAdmin: boolean = false
  ): Promise<TaxonomyMergePreview> {
    return db.transaction(async (trx) => {
      const plan = await this.loadPlan(trx, input, userId, isAdmin)

      if (input.kind === 'theme') {
        await this.moveCards(trx, plan.sourceCards, plan.target.id)
        await LeitnerTheme.query({ client: trx }).where('id', plan.source.id).delete()
        return plan.preview
      }

      const targetCategory = plan.target as LeitnerCategory
      const sourceCategory = plan.source as LeitnerCategory
      const targetByName = new Map(
        plan.targetThemes.map((theme) => [normalizeTaxonomyName(theme.name), theme])
      )

      for (const sourceTheme of plan.sourceThemes) {
        const collision = targetByName.get(normalizeTaxonomyName(sourceTheme.name))
        const cards = await this.cardsForTheme(trx, sourceTheme.id, userId, isAdmin)
        for (const card of cards) assertOwnedOrAdmin(card, userId, isAdmin)

        if (collision) {
          await this.moveCards(trx, cards, collision.id)
          await LeitnerTheme.query({ client: trx }).where('id', sourceTheme.id).delete()
          continue
        }

        await LeitnerTheme.query({ client: trx })
          .where('id', sourceTheme.id)
          .update({ leitner_category_id: targetCategory.id })
      }

      await LeitnerCategory.query({ client: trx }).where('id', sourceCategory.id).delete()
      return plan.preview
    })
  }

  private async loadPlan(
    trx: TransactionClientContract,
    input: TaxonomyMergeInput,
    userId: number,
    isAdmin: boolean
  ): Promise<MergePlan> {
    if (input.sourceId === input.targetId) {
      throw new Error('La source et la cible doivent être différentes.')
    }

    if (input.kind === 'theme') {
      const themes = await LeitnerTheme.query({ client: trx })
        .whereIn('id', [input.sourceId, input.targetId])
        .orderBy('id')
        .forUpdate()
      const source = themes.find((theme) => theme.id === input.sourceId)
      const target = themes.find((theme) => theme.id === input.targetId)
      if (!source || !target) throw new Error('Thème introuvable.')
      assertOwnedOrAdmin(source, userId, isAdmin)
      assertOwnedOrAdmin(target, userId, isAdmin)
      const sourceCards = await this.cardsForTheme(trx, source.id, userId, isAdmin)
      for (const card of sourceCards) assertOwnedOrAdmin(card, userId, isAdmin)

      return {
        source,
        target,
        sourceThemes: [],
        targetThemes: [],
        sourceCards,
        preview: {
          kind: input.kind,
          sourceId: source.id,
          targetId: target.id,
          sourceName: source.name,
          targetName: target.name,
          sourceChildren: sourceCards.length,
          collisionCount: 0,
          cardsToMove: sourceCards.length,
        },
      }
    }

    const categories = await LeitnerCategory.query({ client: trx })
      .whereIn('id', [input.sourceId, input.targetId])
      .orderBy('id')
      .forUpdate()
    const source = categories.find((category) => category.id === input.sourceId)
    const target = categories.find((category) => category.id === input.targetId)
    if (!source || !target) throw new Error('Catégorie introuvable.')
    assertOwnedOrAdmin(source, userId, isAdmin)
    assertOwnedOrAdmin(target, userId, isAdmin)

    const themes = await LeitnerTheme.query({ client: trx })
      .whereIn('leitner_category_id', [source.id, target.id])
      .orderBy('id')
      .forUpdate()
    const sourceThemes = themes.filter((theme) => theme.leitnerCategoryId === source.id)
    const targetThemes = themes.filter((theme) => theme.leitnerCategoryId === target.id)
    for (const theme of sourceThemes) assertOwnedOrAdmin(theme, userId, isAdmin)

    const targetNames = new Set(targetThemes.map((theme) => normalizeTaxonomyName(theme.name)))
    const collisionCount = sourceThemes.filter((theme) =>
      targetNames.has(normalizeTaxonomyName(theme.name))
    ).length
    const sourceCards = [] as LeitnerCard[]
    for (const theme of sourceThemes) {
      sourceCards.push(...(await this.cardsForTheme(trx, theme.id, userId, isAdmin)))
    }
    for (const card of sourceCards) assertOwnedOrAdmin(card, userId, isAdmin)

    return {
      source,
      target,
      sourceThemes,
      targetThemes,
      sourceCards,
      preview: {
        kind: input.kind,
        sourceId: source.id,
        targetId: target.id,
        sourceName: source.name,
        targetName: target.name,
        sourceChildren: sourceThemes.length,
        collisionCount,
        cardsToMove: sourceCards.length,
      },
    }
  }

  private async cardsForTheme(
    trx: TransactionClientContract,
    themeId: number,
    _userId: number,
    _isAdmin: boolean
  ): Promise<LeitnerCard[]> {
    return LeitnerCard.query({ client: trx }).where('leitner_theme_id', themeId).forUpdate()
  }

  private async moveCards(
    trx: TransactionClientContract,
    cards: LeitnerCard[],
    targetThemeId: number
  ): Promise<void> {
    if (cards.length === 0) return
    await LeitnerCard.query({ client: trx })
      .whereIn(
        'id',
        cards.map((card) => card.id)
      )
      .update({ leitner_theme_id: targetThemeId })
  }
}
