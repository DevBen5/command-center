import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import LeitnerReview from '#modules/leitner/models/leitner_review'
import LeitnerTheme from '#modules/leitner/models/leitner_theme'
import type { Grade } from '#modules/leitner/services/leitner_service'

/**
 * Version du format d'échange. Un fichier qui déclare une autre version est
 * refusé à l'import : mieux vaut un refus net qu'un import « au mieux » qui
 * écrirait des données fausses en silence. Un fichier **sans** `version` est
 * un fichier écrit à la main : il est lu comme la version courante.
 */
export const BACKUP_VERSION = 1

export interface BackupReview {
  grade: Grade
  reviewedAt: string
}

export interface BackupCard {
  front: string
  back: string
  /** Absents quand la carte n'est pas classée. Le classement va toujours par paire. */
  category?: string
  theme?: string
  box: number
  /** Colonne `date` : jour calendaire, sans heure. */
  nextReview: string
  createdAt: string
  updatedAt: string
  reviews: BackupReview[]
}

export interface BackupCategory {
  name: string
  themes: string[]
}

export interface Backup {
  version: number
  exportedAt: string
  categories: BackupCategory[]
  cards: BackupCard[]
}

/*
| Le fichier importé, tel que le validateur le rend : tout est optionnel sauf le
| recto et le verso, pour qu'un fichier écrit à la main tienne en trois champs.
*/

export interface BackupCardInput {
  front: string
  back: string
  category?: string | null
  theme?: string | null
  box?: number
  nextReview?: string
  createdAt?: string
  updatedAt?: string
  reviews?: { grade: Grade; reviewedAt: string }[]
}

export interface BackupInput {
  version?: number
  categories?: { name: string; themes?: string[] }[]
  cards: BackupCardInput[]
}

/**
 * `merge` (défaut) ajoute au contenu existant et ne supprime rien : c'est la saisie
 * en masse. `replace` vide cartes et taxonomie avant de charger : c'est la
 * restauration, elle est destructive et passe par une confirmation explicite.
 */
export type ImportMode = 'merge' | 'replace'

export interface ImportReport {
  mode: ImportMode
  cardsCreated: number
  /** Cartes ignorées en fusion (recto déjà présent sous ce thème). Jamais en remplacement. */
  cardsSkipped: number
  categoriesCreated: number
  themesCreated: number
  reviewsCreated: number
}

/**
 * Fichier syntaxiquement valide mais incohérent (un thème sans sa catégorie).
 * Le message est affichable tel quel ; la transaction garantit qu'aucune ligne
 * n'a été écrite.
 */
export class BackupImportError extends Error {}

/*
| Clés d'unicité. `JSON.stringify` d'un tuple, plutôt qu'une concaténation : aucun
| séparateur à choisir, donc aucune collision entre (« DevOps », « Docker ») et
| (« DevOps Docker », « »), quel que soit le texte saisi.
*/

/** Un thème n'est unique que dans sa catégorie : « Docker » peut vivre sous DevOps *et* Cloud. */
function themeKey(category: string, theme: string): string {
  return JSON.stringify([category, theme])
}

/** Identité d'une carte pour la déduplication en fusion : son recto, *dans son thème*. */
function cardKey(front: string, themeId: number | null): string {
  return JSON.stringify([themeId, front])
}

/**
 * Export / import du contenu du module, en JSON.
 *
 * Le fichier est **autoportant** : la taxonomie y est désignée par son nom, jamais
 * par un id. Réinjecter les ids casserait les séquences Postgres
 * (`leitner_cards_id_seq` ne suit pas un insert à id explicite) et le prochain ajout
 * depuis l'UI planterait sur un doublon de clé primaire.
 *
 * Les intervalles des boîtes (`leitner_settings`) ne sont **pas** du contenu : ils ne
 * font pas partie du fichier. Les échéances, elles, sont exportées telles quelles
 * (`next_review`), donc une restauration ne dépend pas du réglage en vigueur.
 */
export default class LeitnerBackupService {
  /** Instantané complet : taxonomie, cartes (boîte, échéance, horodatage) et historique. */
  async export(): Promise<Backup> {
    const categories = await LeitnerCategory.query()
      .preload('themes', (themes) => themes.orderBy('name'))
      .orderBy('name')

    const cards = await LeitnerCard.query()
      .preload('theme', (theme) => theme.preload('category'))
      .preload('reviews', (reviews) => reviews.orderBy('reviewed_at', 'asc').orderBy('id', 'asc'))
      .orderBy('id', 'asc')

    return {
      version: BACKUP_VERSION,
      exportedAt: DateTime.now().toISO()!,
      categories: categories.map((category) => ({
        name: category.name,
        themes: category.themes.map((theme) => theme.name),
      })),
      cards: cards.map((card) => ({
        front: card.front,
        back: card.back,
        // Une carte non classée n'a ni l'un ni l'autre : on omet les deux clés
        // plutôt que d'écrire `null`, pour que le fichier reste lisible à la main.
        ...(card.theme ? { category: card.theme.category.name, theme: card.theme.name } : {}),
        box: card.box,
        nextReview: card.nextReview.toISODate()!,
        createdAt: card.createdAt.toISO()!,
        updatedAt: card.updatedAt.toISO()!,
        reviews: card.reviews.map((review) => ({
          grade: review.grade,
          reviewedAt: review.reviewedAt.toISO()!,
        })),
      })),
    }
  }

  /**
   * Charge un fichier validé. **Tout ou rien** : une seule transaction, donc un
   * fichier qui casse à la 300ᵉ carte ne laisse pas 299 cartes derrière lui. Le
   * cas le plus probable est la violation d'unicité de la taxonomie
   * (`leitner_categories.name`, et (catégorie, nom) sur `leitner_themes`).
   */
  async import(backup: BackupInput, mode: ImportMode): Promise<ImportReport> {
    const report: ImportReport = {
      mode,
      cardsCreated: 0,
      cardsSkipped: 0,
      categoriesCreated: 0,
      themesCreated: 0,
      reviewsCreated: 0,
    }

    return db.transaction(async (trx) => {
      if (mode === 'replace') {
        // Les révisions partent avec leurs cartes, les thèmes avec leurs catégories (FK CASCADE).
        await LeitnerCard.query({ client: trx }).delete()
        await LeitnerCategory.query({ client: trx }).delete()
      }

      const taxonomy = await this.loadTaxonomy(trx, report)

      // La taxonomie déclarée en tête de fichier est créée même si aucune carte ne
      // l'utilise : une catégorie vide est un classement légitime, pas un résidu.
      for (const category of backup.categories ?? []) {
        await taxonomy.ensureCategory(category.name)
        for (const theme of category.themes ?? []) {
          await taxonomy.ensureTheme(category.name, theme)
        }
      }

      // Déduplication : en FUSION seulement. Le remplacement est une restauration,
      // il recharge le fichier fidèlement — doublons compris, sinon une base qui
      // contenait deux cartes identiques n'en retrouverait qu'une.
      const seen = new Set<string>()
      if (mode === 'merge') {
        for (const card of await LeitnerCard.query({ client: trx })) {
          seen.add(cardKey(card.front, card.leitnerThemeId))
        }
      }

      for (const card of backup.cards) {
        const themeId = await this.resolveTheme(card, taxonomy)

        if (mode === 'merge') {
          const key = cardKey(card.front, themeId)
          // Le doublon peut venir de la base comme du fichier lui-même : rejouer
          // deux fois le même fichier ne duplique rien.
          if (seen.has(key)) {
            report.cardsSkipped++
            continue
          }
          seen.add(key)
        }

        const created = await LeitnerCard.create(
          {
            front: card.front,
            back: card.back,
            leitnerThemeId: themeId,
            // Défauts d'une carte créée depuis l'UI : boîte 1, due aujourd'hui.
            box: card.box ?? 1,
            nextReview: card.nextReview ? DateTime.fromISO(card.nextReview) : DateTime.now(),
            // Lucid ne pose `created_at` / `updated_at` que s'ils sont absents : les
            // horodatages du fichier sont donc conservés tels quels. Ils portent
            // l'ordre de la file de révision (`next_review` → `updated_at` → `id`).
            ...(card.createdAt ? { createdAt: DateTime.fromISO(card.createdAt) } : {}),
            ...(card.updatedAt ? { updatedAt: DateTime.fromISO(card.updatedAt) } : {}),
          },
          { client: trx }
        )
        report.cardsCreated++

        for (const review of card.reviews ?? []) {
          await LeitnerReview.create(
            {
              leitnerCardId: created.id,
              grade: review.grade,
              reviewedAt: DateTime.fromISO(review.reviewedAt),
            },
            { client: trx }
          )
          report.reviewsCreated++
        }
      }

      return report
    })
  }

  /**
   * Taxonomie déjà en base, indexée par nom, avec de quoi la compléter à la volée.
   * Une catégorie « DevOps » existante est **réutilisée**, jamais dupliquée : c'est
   * ce qu'imposent les contraintes d'unicité, et ce qui rend le fichier autoportant
   * sans le moindre id.
   */
  private async loadTaxonomy(trx: TransactionClientContract, report: ImportReport) {
    const categories = new Map<string, LeitnerCategory>()
    const themes = new Map<string, LeitnerTheme>()

    const existing = await LeitnerCategory.query({ client: trx }).preload('themes')
    for (const category of existing) {
      categories.set(category.name, category)
      for (const theme of category.themes) {
        themes.set(themeKey(category.name, theme.name), theme)
      }
    }

    const ensureCategory = async (name: string): Promise<LeitnerCategory> => {
      const found = categories.get(name)
      if (found) return found

      const created = await LeitnerCategory.create({ name }, { client: trx })
      categories.set(name, created)
      report.categoriesCreated++
      return created
    }

    const ensureTheme = async (categoryName: string, themeName: string): Promise<LeitnerTheme> => {
      const key = themeKey(categoryName, themeName)
      const found = themes.get(key)
      if (found) return found

      const category = await ensureCategory(categoryName)
      const created = await LeitnerTheme.create(
        { leitnerCategoryId: category.id, name: themeName },
        { client: trx }
      )
      themes.set(key, created)
      report.themesCreated++
      return created
    }

    return { ensureCategory, ensureTheme }
  }

  /** `null` = carte non classée. Les deux champs vont ensemble, ou pas du tout. */
  private async resolveTheme(
    card: BackupCardInput,
    taxonomy: { ensureTheme: (category: string, theme: string) => Promise<LeitnerTheme> }
  ): Promise<number | null> {
    const category = card.category ?? null
    const theme = card.theme ?? null

    if (!category && !theme) return null
    if (!category || !theme) {
      throw new BackupImportError(
        `Carte « ${card.front.slice(0, 40)} » : « category » et « theme » vont ensemble — ` +
          `un thème appartient toujours à une catégorie.`
      )
    }

    const resolved = await taxonomy.ensureTheme(category, theme)
    return resolved.id
  }
}
