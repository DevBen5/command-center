import vine from '@vinejs/vine'
import type { FieldContext } from '@vinejs/vine/types'
import { DateTime } from 'luxon'

/**
 * Création / édition d'une carte. `leitnerThemeId` est optionnel : une carte
 * peut rester non classée.
 */
export const cardValidator = vine.compile(
  vine.object({
    front: vine.string().trim().minLength(1),
    back: vine.string().trim().minLength(1),
    leitnerThemeId: vine.number().positive().nullable().optional(),
  })
)

export const reviewValidator = vine.compile(
  vine.object({
    grade: vine.enum(['again', 'hard', 'good', 'easy'] as const),
  })
)

/** Suppression multiple depuis l'écran de gestion. */
export const cardIdsValidator = vine.compile(
  vine.object({
    ids: vine.array(vine.number().positive()).minLength(1),
  })
)

/** Reclassement multiple : `null` remet les cartes en « non classé ». */
export const cardsThemeValidator = vine.compile(
  vine.object({
    ids: vine.array(vine.number().positive()).minLength(1),
    leitnerThemeId: vine.number().positive().nullable(),
  })
)

/**
 * Intervalles des cinq boîtes, en jours. Minimum **1** : un intervalle à 0
 * laisserait la carte due le jour de sa réussite, donc éternellement en session
 * — le comportement réservé à la note `again`.
 */
const boxInterval = () => vine.number().withoutDecimals().min(1).max(365)

export const boxIntervalsValidator = vine.compile(
  vine.object({
    box1Days: boxInterval(),
    box2Days: boxInterval(),
    box3Days: boxInterval(),
    box4Days: boxInterval(),
    box5Days: boxInterval(),
  })
)

export const categoryValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(60),
  })
)

export const themeValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(60),
    leitnerCategoryId: vine.number().positive(),
  })
)

/*
|------------------------------------------------------------------------------
| Import d'une sauvegarde JSON
|------------------------------------------------------------------------------
| Le fichier vient de l'utilisateur : rien n'y est fiable. Une date bidon produit
| un DateTime invalide que Lucid écrirait sans broncher — on valide donc la
| validité réelle des dates, pas seulement leur forme.
*/

/** Jour calendaire (colonne `date`). `2026-02-31` a la bonne forme et n'existe pas. */
const calendarDate = vine.createRule((value: unknown, _options: undefined, field: FieldContext) => {
  if (typeof value !== 'string') return
  if (!DateTime.fromFormat(value, 'yyyy-MM-dd').isValid) {
    field.report(
      'Le champ {{ field }} doit être une date réelle au format AAAA-MM-JJ.',
      'calendarDate',
      field
    )
  }
})

/** Horodatage ISO 8601 complet (colonnes `timestamp`). */
const timestamp = vine.createRule((value: unknown, _options: undefined, field: FieldContext) => {
  if (typeof value !== 'string') return
  if (!DateTime.fromISO(value).isValid) {
    field.report('Le champ {{ field }} doit être un horodatage ISO 8601.', 'timestamp', field)
  }
})

const taxonomyName = () => vine.string().trim().minLength(1).maxLength(60)

/**
 * Contenu du fichier importé. Seuls `front` et `back` sont obligatoires : un fichier
 * écrit à la main se réduit au recto, au verso et au thème, le reste prenant les
 * valeurs d'une carte créée depuis l'UI (boîte 1, due aujourd'hui).
 *
 * ⚠️ **`box` est bornée à 1..5, et c'est le seul rempart** : la colonne n'a aucune
 * contrainte en base. Une carte importée en boîte 12 puis notée `hard` y resterait,
 * `boxIntervals()[12]` vaudrait `undefined`, Luxon ferait `plus({ days: undefined })`
 * = +0 jour et rendrait une date valide — la carte serait éternellement due, sans
 * la moindre exception ni le moindre log.
 */
export const backupValidator = vine.compile(
  vine.object({
    version: vine.number().withoutDecimals().optional(),
    exportedAt: vine.string().optional(),
    categories: vine
      .array(
        vine.object({
          name: taxonomyName(),
          themes: vine.array(taxonomyName()).optional(),
        })
      )
      .optional(),
    cards: vine.array(
      vine.object({
        front: vine.string().trim().minLength(1),
        back: vine.string().trim().minLength(1),
        // Une carte non classée n'a ni l'un ni l'autre ; les deux vont ensemble
        // (un thème appartient toujours à une catégorie) — vérifié à l'import.
        category: taxonomyName().nullable().optional(),
        theme: taxonomyName().nullable().optional(),
        box: vine.number().withoutDecimals().min(1).max(5).optional(),
        nextReview: vine.string().use(calendarDate()).optional(),
        createdAt: vine.string().use(timestamp()).optional(),
        updatedAt: vine.string().use(timestamp()).optional(),
        reviews: vine
          .array(
            vine.object({
              grade: vine.enum(['again', 'hard', 'good', 'easy'] as const),
              reviewedAt: vine.string().use(timestamp()),
            })
          )
          .optional(),
      })
    ),
  })
)

/** Le fichier lui-même. Aucune contrainte d'extension : c'est le contenu qui fait foi. */
export const backupImportValidator = vine.compile(
  vine.object({
    file: vine.file({ size: '20mb' }),
  })
)
