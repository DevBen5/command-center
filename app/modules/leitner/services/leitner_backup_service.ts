import { DateTime } from 'luxon'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import LeitnerCategory from '#modules/leitner/models/leitner_category'
import type { Grade } from '#modules/leitner/services/leitner_service'

/**
 * Version du format d'échange. Un fichier qui déclare une autre version est
 * refusé à l'import : mieux vaut un refus net qu'un import « au mieux » qui
 * écrirait des données fausses en silence.
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
}
