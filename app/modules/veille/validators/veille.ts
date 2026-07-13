import vine from '@vinejs/vine'

export const captureValidator = vine.compile(
  vine.object({
    type: vine.enum(['rss', 'bookmark', 'note'] as const),
    title: vine.string().trim().minLength(1),
    url: vine.string().trim().url().optional(),
    content: vine.string().trim().optional(),
  })
)
