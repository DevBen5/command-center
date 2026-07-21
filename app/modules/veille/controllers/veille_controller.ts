import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import immichConfig from '#config/immich'
import VeilleItem from '#modules/veille/models/veille_item'
import VeilleSource from '#modules/veille/models/veille_source'
import VeilleDeletionService from '#modules/veille/services/veille_deletion_service'
import VeilleStatsService from '#modules/veille/services/veille_stats_service'
import { assetIdFromDedupKey } from '#modules/veille/services/immich_asset'
import { captureValidator, itemIdsValidator } from '#modules/veille/validators/veille'

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
  constructor(
    private stats: VeilleStatsService,
    private deletion: VeilleDeletionService
  ) {}

  async index({ inertia, request, session }: HttpContext) {
    const type = request.input('type')
    const tag = request.input('tag')
    const search = request.input('search')
    const sourceId = Number(request.input('sourceId')) || null
    const readingQueue = asBool(request.input('readingQueue'))
    const unread = asBool(request.input('unread'))
    const page = Math.max(1, Number(request.input('page')) || 1)

    /**
     * ⚠️ **`visible()`, jamais `query()`** (CC-63) : les items supprimés portent une pierre
     * tombale et cette requête est la seule à servir la liste, la recherche, le filtrage par tag
     * et la pagination. Le filtre est donc posé **avant** tous les `if` ci-dessous — un supprimé
     * ne doit ressortir par aucun chemin, y compris en comptant dans le total d'une page.
     */
    const query = VeilleItem.visible()
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

    /**
     * ⚠️ **La page demandée est bornée à la dernière page réelle** (CC-63).
     *
     * Supprimer les derniers items d'une page laisse une page qui n'existe plus : `paginate(4)`
     * sur un résultat qui n'en compte que 3 rend une liste vide, et l'écran affiche « Aucun
     * résultat » — exactement le message qui fait croire que le filtre est en cause, ou que la
     * suppression a emporté plus que prévu. On recule au lieu de mentir.
     *
     * Côté serveur et pas dans la page : le retour d'une suppression est un `redirect().back()`,
     * donc vers l'URL qui porte encore `?page=4`. Et ça couvre du même coup les deux autres
     * causes — une collecte qui change le total, et une URL tapée à la main.
     *
     * Le filtre, lui, n'est **pas** touché : vider « Image » en plusieurs passes est le geste
     * normal de cet écran, et repartir sur « Tout » à chaque suppression le rendrait pénible.
     */
    let paginator = await query.clone().paginate(page, PER_PAGE)
    const lastPage = Math.max(1, paginator.lastPage)
    if (page > lastPage) paginator = await query.clone().paginate(lastPage, PER_PAGE)

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
       * Le retour d'une suppression — même mécanique que l'écran des sources : un flash relu ici
       * et rendu en prop. C'est le seul endroit où un échec Immich peut se lire, la suppression
       * redirigeant vers la liste.
       */
      notification: session.flashMessages.get('notification') ?? null,
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
    // `visible()` : un item supprimé n'est plus pilotable, même par une requête forgée ou un
    // onglet resté ouvert sur une liste périmée.
    const item = await VeilleItem.visible().where('id', params.id).firstOrFail()
    item.readingQueue = !item.readingQueue
    await item.save()
    return response.redirect().back()
  }

  /** Lu / non-lu. Sans cette bascule, on ne sait jamais où on s'est arrêté. */
  async toggleRead({ params, response }: HttpContext) {
    const item = await VeilleItem.visible().where('id', params.id).firstOrFail()
    item.readAt = item.readAt === null ? DateTime.now() : null
    await item.save()
    return response.redirect().back()
  }

  /**
   * La suppression, simple ou en lot (CC-63).
   *
   * ⚠️ **Le contrôleur ne décide rien** : l'ordre des opérations (Immich d'abord, la base
   * ensuite), le refus quand la corbeille est désactivée et le sort d'un échec partiel vivent
   * dans `VeilleDeletionService`. Ici on valide, on appelle, on rend le message.
   *
   * ⚠️ **Une suppression partiellement échouée n'est pas un succès silencieux.** Si des médias
   * sont restés en place, le message d'Immich remonte **tel quel** — c'est le seul moyen de
   * distinguer « Immich éteint » d'une clé sans la permission `asset.delete`.
   */
  async destroyMany({ request, response, session }: HttpContext) {
    const { ids } = await request.validateUsing(itemIdsValidator)
    const outcome = await this.deletion.deleteItems(ids)

    if (outcome.error !== null) {
      session.flash('notification', {
        type: 'error',
        message:
          outcome.deleted > 0
            ? `${outcome.deleted} élément(s) supprimé(s), ${outcome.failed} conservé(s) : ${outcome.error}`
            : outcome.error,
      })
    } else if (outcome.deleted > 0) {
      session.flash('notification', {
        type: 'success',
        message:
          outcome.trashed > 0
            ? `${outcome.deleted} élément(s) supprimé(s), dont ${outcome.trashed} envoyé(s) à la corbeille d’Immich.`
            : `${outcome.deleted} élément(s) supprimé(s).`,
      })
    } else {
      /**
       * ⚠️ **Un clic sans effet ne reste pas muet.** Le cas arrive pour de vrai : un second
       * onglet resté ouvert sur une liste périmée, ou un rejeu de requête. Sans ce message, le
       * bouton paraît cassé — et le réflexe est de recliquer, ce qui ne changera rien non plus.
       * Ni un succès (rien n'a bougé) ni une erreur (rien n'a échoué) : un simple constat.
       */
      session.flash('notification', {
        type: 'info',
        message: 'Rien à supprimer : ces éléments l’étaient déjà.',
      })
    }

    return response.redirect().back()
  }
}
