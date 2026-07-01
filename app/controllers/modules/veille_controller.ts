import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import VeilleItem from '#models/veille_item'

const captureValidator = vine.compile(
  vine.object({
    type: vine.enum(['rss', 'bookmark', 'note'] as const),
    title: vine.string().trim().minLength(1),
    url: vine.string().trim().url().optional(),
    content: vine.string().trim().optional(),
  })
)

export default class VeilleController {
  async index({ inertia, request }: HttpContext) {
    const type = request.input('type')
    const tag = request.input('tag')
    const readingQueue = request.input('readingQueue')
    const search = request.input('search')

    const query = VeilleItem.query().orderBy('created_at', 'desc')

    if (type) query.where('type', type)
    if (tag) query.whereRaw('? = ANY(tags)', [tag])
    if (readingQueue) query.where('reading_queue', true)
    if (search) query.whereRaw("search_vector @@ plainto_tsquery('french', ?)", [search])

    const items = await query

    return inertia.render('veille/index', {
      items,
      filters: { type, tag, readingQueue: !!readingQueue, search },
    })
  }

  async store({ request, response }: HttpContext) {
    const payload = await request.validateUsing(captureValidator)
    await VeilleItem.create(payload)
    return response.redirect().back()
  }

  async toggleQueue({ params, response }: HttpContext) {
    const item = await VeilleItem.findOrFail(params.id)
    item.readingQueue = !item.readingQueue
    await item.save()
    return response.redirect().back()
  }
}
