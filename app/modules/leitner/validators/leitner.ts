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
