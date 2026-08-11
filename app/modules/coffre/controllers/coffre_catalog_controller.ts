import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'
import type { Request } from '@adonisjs/core/http'
import ForbiddenException from '#core/shared/exceptions/forbidden_exception'
import vault from '#modules/coffre/services/vault_service'
import catalogBrowseThrottle from '#modules/coffre/services/catalog_browse_throttle_service'
import CatalogLinkService from '#modules/coffre/services/catalog_link_service'
import type { CatalogItemNature, CatalogSourceKey } from '#modules/coffre/services/catalog_source'
import CoffreCatalogItem from '#modules/coffre/models/coffre_catalog_item'
import {
  catalogItemsQuery,
  CATALOG_SORT_COLUMNS,
  type CatalogSortKey,
} from '#modules/coffre/services/catalog_item_query'

const CATALOG_PAGE_SIZE = 30
const MAX_QUERY_LENGTH = 200
const SOURCES: readonly CatalogSourceKey[] = ['nas', 'immich_locked']
const NATURES: readonly CatalogItemNature[] = ['photo', 'video', 'other']
const SORT_KEYS = Object.keys(CATALOG_SORT_COLUMNS) as CatalogSortKey[]
const ORDERS = ['asc', 'desc'] as const

type SortOrder = (typeof ORDERS)[number]

interface ListingParams {
  page: number
  source: CatalogSourceKey | null
  nature: CatalogItemNature | null
  capturedFrom: string | null
  capturedTo: string | null
  q: string | null
  includeMissing: boolean
  sort: CatalogSortKey
  order: SortOrder
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * La grille du catalogue (CC-227, lot 3 de l'épique CC-224) — consultation et recherche, en
 * lecture seule. **Toutes ces routes sont derrière l'élévation** (`vault_unlocked_middleware`), en
 * plus de leur capacité, même doctrine que `CoffreController`.
 *
 * ⚠️ **`index` ne rend AUCUNE donnée de catalogue en prop Inertia.** Les props de page vivent dans
 * `history.state`, donc sur le disque du navigateur (CC-179) : un inventaire du catalogue y
 * resterait après verrouillage. La page va chercher ses résultats par `fetch`, comme
 * `/coffre/:id/secret` et `/coffre/immich/dossier`.
 */
@inject()
export default class CoffreCatalogController {
  constructor(private links: CatalogLinkService) {}

  async index({ inertia }: HttpContext) {
    return inertia.render('modules/coffre/catalog')
  }

  /**
   * `GET /coffre/catalog/items` — JSON nu, pagination serveur.
   *
   * ⚠️ **Le throttle se lit AVANT la requête SQL**, jamais après : c'est elle qu'on rationne.
   * ⚠️ **`sort`/`order` sont validés contre un allow-list strict ICI, avant d'atteindre
   * `orderByRaw`** — c'est cette validation, et elle seule, qui rend l'interpolation du nom de
   * colonne sûre plus bas. Ne la retire jamais en croyant simplifier.
   */
  async items({ auth, request, response, session }: HttpContext) {
    const user = auth.user!
    const key = vault.keyFor(user, session)
    if (key === null) {
      throw new ForbiddenException('Le coffre est verrouillé.')
    }

    const wait = await catalogBrowseThrottle.secondsBeforeRetry(user.id)
    if (wait > 0) {
      response.header('cache-control', 'no-store')
      return response.tooManyRequests({ error: 'Trop de requêtes. Réessayez dans un instant.' })
    }

    const params = this.#parseListingParams(request)
    if (params === null) {
      return response.badRequest({ error: 'Paramètres de recherche invalides.' })
    }

    await catalogBrowseThrottle.recordRequest(user.id)

    const query = catalogItemsQuery(user.id, {
      source: params.source,
      nature: params.nature,
      capturedFrom: params.capturedFrom,
      capturedTo: params.capturedTo,
      q: params.q,
      includeMissing: params.includeMissing,
    })

    const column = CATALOG_SORT_COLUMNS[params.sort]
    query.orderByRaw(`${column} ${params.order} NULLS LAST`).orderBy('id', params.order)

    let paginator = await query.clone().paginate(params.page, CATALOG_PAGE_SIZE)
    const lastPage = Math.max(1, paginator.lastPage)
    if (params.page > lastPage) {
      paginator = await query.clone().paginate(lastPage, CATALOG_PAGE_SIZE)
    }

    const linkedEntries = await this.links.linkedEntriesFor(user, key)

    response.header('cache-control', 'no-store')
    response.header('pragma', 'no-cache')

    return response.ok({
      items: paginator.all().map((item) => this.#serialize(item, linkedEntries)),
      page: paginator.currentPage,
      perPage: CATALOG_PAGE_SIZE,
      total: paginator.total,
      totalPages: Math.max(1, paginator.lastPage),
    })
  }

  /**
   * La vignette d'une ligne, choisie PAR SOURCE — le point le plus facile à rater de cet écran.
   *
   * - `nas` + `photo` → le proxy dédié (CC-228), seule combinaison qu'il sait servir.
   * - `immich_locked` (toute nature) → le proxy du dossier verrouillé (CC-205), qui délègue à
   *   Immich — `reference` porte l'UUID en clair, même doctrine que sa phase de sélection (voir le
   *   `CLAUDE.md` du module, « L'UUID en sélection n'est pas l'UUID en liste »).
   * - `nas` + `video`/`other` → `null` : aucune tentative, une pastille de nature à la place
   *   (CC-228, périmètre photos seulement).
   */
  #thumbnailUrlFor(item: CoffreCatalogItem): string | null {
    if (item.source === 'nas') {
      return item.nature === 'photo' ? `/coffre/catalog/nas/${item.id}/thumbnail` : null
    }

    return `/coffre/immich/dossier/${encodeURIComponent(item.reference)}/thumbnail`
  }

  #serialize(
    item: CoffreCatalogItem,
    linkedEntries: Awaited<ReturnType<CatalogLinkService['linkedEntriesFor']>>
  ) {
    const linked = linkedEntries.get(`${item.source}:${item.reference}`) ?? null

    return {
      id: item.id,
      source: item.source,
      nature: item.nature,
      displayName: item.displayName,
      capturedAt: item.capturedAt?.toISO() ?? null,
      sizeBytes: item.sizeBytes,
      missingSince: item.missingSince?.toISO() ?? null,
      thumbnailUrl: this.#thumbnailUrlFor(item),
      linkedEntry:
        linked === null ? null : { id: linked.entryId, type: linked.type, title: linked.title },
    }
  }

  /** `null` sur toute forme invalide — la route répond alors 400, jamais un plantage. */
  #parseListingParams(request: Request): ListingParams | null {
    // ⚠️ `Number('Infinity')` est fini pour `Number.isFinite`? NON — Infinity n'est PAS fini :
    // sans ce garde, `?page=Infinity` (ou une décimale) passerait un OFFSET non entier à
    // Postgres, qui répondrait par une erreur non rattrapée (500) plutôt qu'un repli propre.
    // Une page hors bornes mais FINIE (ex. 99) reste acceptée telle quelle — c'est le second
    // `.paginate()` de `items()` qui la borne à la dernière page réelle, comme côté veille.
    const pageRaw = Number(request.input('page'))
    const page =
      Number.isFinite(pageRaw) && Number.isInteger(pageRaw) && pageRaw >= 1
        ? Math.min(pageRaw, 1_000_000)
        : 1

    const sourceRaw = request.input('source')
    const source = sourceRaw === undefined || sourceRaw === '' ? null : sourceRaw
    if (source !== null && !SOURCES.includes(source)) return null

    const natureRaw = request.input('nature')
    const nature = natureRaw === undefined || natureRaw === '' ? null : natureRaw
    if (nature !== null && !NATURES.includes(nature)) return null

    const capturedFrom = this.#parseIsoDate(request.input('capturedFrom'))
    if (capturedFrom === undefined) return null
    const capturedTo = this.#parseIsoDate(request.input('capturedTo'))
    if (capturedTo === undefined) return null

    const qRaw = request.input('q')
    const q = qRaw === undefined || qRaw === '' ? null : String(qRaw)
    if (q !== null && q.length > MAX_QUERY_LENGTH) return null

    const includeMissingRaw = request.input('includeMissing')
    const includeMissing = includeMissingRaw === 'true' || includeMissingRaw === '1'

    const sortRaw = request.input('sort') ?? 'capturedAt'
    if (!SORT_KEYS.includes(sortRaw)) return null

    const orderRaw = request.input('order') ?? 'desc'
    if (!ORDERS.includes(orderRaw)) return null

    return {
      page,
      source: source as CatalogSourceKey | null,
      nature: nature as CatalogItemNature | null,
      capturedFrom: capturedFrom ?? null,
      capturedTo: capturedTo ?? null,
      q,
      includeMissing,
      sort: sortRaw as CatalogSortKey,
      order: orderRaw as SortOrder,
    }
  }

  /**
   * `undefined` = forme invalide (400), `null` = absent, sinon la date ISO telle quelle.
   *
   * ⚠️ **La regex ne vérifie que la FORME (`\d{4}-\d{2}-\d{2}`), pas le calendrier** — `2026-99-99`
   * la passe. Sans `DateTime.fromISO(…).isValid`, cette chaîne rejoindrait telle quelle un
   * `.where('captured_at', '>=', …)` et Postgres refuserait de la caster en timestamp — une
   * erreur non rattrapée (500), là où une saisie hostile doit rendre un refus propre (400).
   */
  #parseIsoDate(value: unknown): string | null | undefined {
    if (value === undefined || value === '') return null
    if (typeof value !== 'string' || !ISO_DATE.test(value)) return undefined
    if (!DateTime.fromISO(value).isValid) return undefined

    return value
  }
}
