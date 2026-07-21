import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import immichConfig from '#config/immich'
import VeilleItem from '#modules/veille/models/veille_item'
import VeilleSource from '#modules/veille/models/veille_source'
import VeilleStatsService from '#modules/veille/services/veille_stats_service'
import { assetIdFromDedupKey } from '#modules/veille/services/immich_asset'
import { captureValidator } from '#modules/veille/validators/veille'

/** Combien d'items par page. Au-delà, la page devient lourde à afficher autant qu'à parcourir. */
const PER_PAGE = 50

/**
 * Un paramètre d'URL est **toujours** une chaîne : `?readingQueue=false` arrive en `"false"`,
 * qui est truthy. C'est ce qui faisait que le filtre « file de lecture » s'activait à la première
 * navigation et ne se désactivait plus — aucun bouton ne le pilotait, il s'allumait tout seul.
 */
function asBool(value: unknown): boolean {
  return value === true || value === 'true' || value === '1'
}

@inject()
export default class VeilleController {
  constructor(private stats: VeilleStatsService) {}

  async index({ inertia, request }: HttpContext) {
    const type = request.input('type')
    const tag = request.input('tag')
    const search = request.input('search')
    const sourceId = Number(request.input('sourceId')) || null
    const readingQueue = asBool(request.input('readingQueue'))
    const unread = asBool(request.input('unread'))
    const page = Math.max(1, Number(request.input('page')) || 1)

    const query = VeilleItem.query()
      // `id` en second critère rend l'ordre **total**. Sans lui, deux items publiés à la même
      // seconde peuvent s'échanger entre deux requêtes : la pagination sauterait ou répéterait
      // une ligne pendant qu'une collecte tourne.
      .orderByRaw('coalesce(published_at, created_at) DESC, id DESC')

    if (type) query.where('type', type)
    // `tags` est un `text[]` Postgres : le binding `?` reste paramétré, jamais concaténé.
    if (tag) query.whereRaw('? = ANY(tags)', [tag])
    if (search) query.whereRaw("search_vector @@ plainto_tsquery('french', ?)", [search])
    if (sourceId) query.where('veille_source_id', sourceId)
    if (readingQueue) query.where('reading_queue', true)
    if (unread) query.whereNull('read_at')

    const paginator = await query.paginate(page, PER_PAGE)

    const [stats, tags, sources] = await Promise.all([
      this.stats.fetchStats(),
      this.stats.fetchTags(),
      VeilleSource.query().orderBy('title', 'asc'),
    ])

    return inertia.render('modules/veille/index', {
      items: paginator.all().map((item) => this.serialize(item)),
      pagination: paginator.getMeta(),
      stats,
      tags,
      sources,
      filters: { type, tag, readingQueue, unread, search, sourceId },
      /**
       * ⚠️ **`webBaseUrl` part au client, `IMMICH_API_KEY` jamais** — même doctrine que
       * `hasApiKey` sur l'écran LLM. L'URL de base est indispensable au navigateur : c'est lui
       * qui suivra le lien vers l'asset. La clé, elle, ne sort que du serveur vers Immich.
       */
      immich: {
        configured: immichConfig.enabled,
        webBaseUrl: immichConfig.enabled ? immichConfig.baseUrl : null,
      },
    })
  }

  /**
   * L'item tel que la page le voit, plus l'identifiant de son asset Immich.
   *
   * ⚠️ **Le lien vers Immich se construit à l'affichage, il n'est pas stocké.** `veille_items.url`
   * reste nul pour un média : une URL figée en base pointerait sur l'ancien domaine le jour d'un
   * déménagement d'instance, et **tous** les liens casseraient en silence. Ici, changer
   * `IMMICH_BASE_URL` suffit.
   *
   * L'identifiant est dérivé de `dedup_key` côté serveur plutôt que laissé à la page : c'est la
   * seule copie, et le préfixe est un détail d'implémentation qui n'a rien à faire dans un
   * template.
   */
  private serialize(item: VeilleItem) {
    return { ...item.serialize(), immichAssetId: assetIdFromDedupKey(item.dedupKey) }
  }

  async store({ request, response }: HttpContext) {
    const payload = await request.validateUsing(captureValidator)
    // Pas de `dedup_key` : une capture manuelle n'est jamais dédoublonnée. L'index unique
    // accepte autant de NULL qu'on veut, elle ne peut donc pas se heurter à un item collecté.
    await VeilleItem.create(payload)
    return response.redirect().back()
  }

  async toggleQueue({ params, response }: HttpContext) {
    const item = await VeilleItem.findOrFail(params.id)
    item.readingQueue = !item.readingQueue
    await item.save()
    return response.redirect().back()
  }

  /** Lu / non-lu. Sans cette bascule, on ne sait jamais où on s'est arrêté. */
  async toggleRead({ params, response }: HttpContext) {
    const item = await VeilleItem.findOrFail(params.id)
    item.readAt = item.readAt === null ? DateTime.now() : null
    await item.save()
    return response.redirect().back()
  }
}
