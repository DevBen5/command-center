import type { HttpContext } from '@adonisjs/core/http'
import VeilleItem from '#modules/veille/models/veille_item'
import { captureValidator } from '#modules/veille/validators/veille'

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

    // Stats globales (indépendantes des filtres courants) pour la bande d'indicateurs.
    const all = await VeilleItem.all()
    const stats = {
      total: all.length,
      rss: all.filter((i) => i.type === 'rss').length,
      queue: all.filter((i) => i.readingQueue).length,
      tags: new Set(all.flatMap((i) => i.tags)).size,
    }

    return inertia.render('modules/veille/index', {
      items,
      stats,
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
