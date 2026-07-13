import vine from '@vinejs/vine'

export const cardValidator = vine.compile(
  vine.object({
    front: vine.string().trim().minLength(1),
    back: vine.string().trim().minLength(1),
    tags: vine.array(vine.string().trim()).optional(),
  })
)

export const reviewValidator = vine.compile(
  vine.object({
    grade: vine.enum(['again', 'hard', 'good', 'easy'] as const),
  })
)
