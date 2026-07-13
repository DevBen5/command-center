import vine from '@vinejs/vine'

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
