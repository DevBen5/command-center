import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import immichConfig from '#config/immich'
import VeilleItem from '#modules/veille/models/veille_item'
import VeilleSource from '#modules/veille/models/veille_source'
import VeilleDeletionService, {
  type DeletionOutcome,
} from '#modules/veille/services/veille_deletion_service'
import VeilleStatsService from '#modules/veille/services/veille_stats_service'
import { assetIdFromDedupKey, IMMICH_DEDUP_LIKE } from '#modules/veille/services/immich_asset'
import {
  FEED_ORDER,
  filteredItems,
  type ItemFilters,
} from '#modules/veille/services/veille_item_query'
import { itemProvenance } from '#modules/veille/shared/item_provenance'
import { isFilterEmpty } from '#modules/veille/shared/filter_selection'
import { parseSourceFilter } from '#modules/veille/shared/source_filter'
import {
  captureValidator,
  itemFilterValidator,
  itemIdsValidator,
} from '#modules/veille/validators/veille'

/**
 * ⚠️ **Le refus qui remplace le plafond de 200 identifiants** (CC-108). Il est ici et non dans le
 * validateur parce que la page a besoin de la même règle : elle n'offre pas le bouton, le serveur
 * refuse quand même. Les deux, jamais l'un sans l'autre.
 */
const EMPTY_FILTER_REFUSAL =
  'Aucun filtre posé : ce geste emporterait toute la veille. Pose au moins un filtre — ' +
  'un type, une source, un tag, une recherche — avant de supprimer.'

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
    const filters = this.readFilters(request)
    const page = Math.max(1, Number(request.input('page')) || 1)

    /**
     * ⚠️ **La requête filtrée vit dans `filteredItems`, plus ici** (CC-108). Elle a trois
     * appelants désormais — cette liste, le décompte qu'annonce la confirmation, et la
     * suppression par filtre. Dupliquée, elle ferait annoncer 317 puis en emporter 340, sans
     * qu'une erreur soit levée nulle part. C'est aussi elle qui porte le `visible()` : un
     * supprimé ne ressort par aucun des trois chemins.
     */
    const query = filteredItems(filters).orderByRaw(FEED_ORDER)

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
      items: paginator.all().map((item) => this.serialize(item, sources)),
      pagination: paginator.getMeta(),
      stats,
      tags,
      sources,
      filters,
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
   *
   * ⚠️ **`provenance` suit exactement la même règle** (CC-104), et c'est pour ça qu'elle est ici
   * et pas dans le `<script setup>`. « D'où vient cet item » se déduit de `veille_source_id`, de
   * la nullité de `dedup_key` et de `metadata.sourceTitle` : tout est déjà dans la charge utile,
   * la page *pourrait* trancher seule. Mais elle ne lit `dedupKey` nulle part aujourd'hui, et l'y
   * faire descendre pour ça défairait la décision du paragraphe ci-dessus. Le mode d'échec évité
   * est silencieux : poser un jour `serializeAs: null` sur `dedupKey` — geste raisonnable, c'est
   * une clé interne — ferait basculer **tous** les orphelins en « Saisi à la main » sans qu'aucun
   * test ne rougisse. Ici, la dépendance est un argument nommé.
   *
   * `sources` est la liste **entière** chargée par `index`, sans filtre sur `active` : une source
   * désactivée nomme toujours les items qu'elle a collectés.
   */
  /**
   * Les six filtres du flux, lus depuis la requête et **normalisés**.
   *
   * ⚠️ **`?? null` n'est pas cosmétique, et le mode d'échec est visible à l'écran** (CC-108).
   * `request.input('type')` rend `undefined` quand le paramètre est absent, et `JSON.stringify`
   * **supprime les clés `undefined`** : la prop `filters` arrivait donc à la page sans le champ
   * du tout. Tout test `!== null` côté page y répond vrai — le rappel des filtres actifs (CC-65)
   * affichait une pastille pour un filtre que personne n'avait posé. Invisible à toute fixture
   * construite avec des `null` explicites, visible au premier chargement.
   */
  private readFilters(request: HttpContext['request']): ItemFilters {
    return {
      type: request.input('type') ?? null,
      tag: request.input('tag') ?? null,
      search: request.input('search') ?? null,
      // ⚠️ Trois états (CC-105), d'où un parse nommé : `Number(…) || null` ne peut pas en porter
      // un troisième, et faisait retomber `?sourceId=none` sur « aucun filtre » — en silence.
      sourceId: parseSourceFilter(request.input('sourceId')),
      readingQueue: asBool(request.input('readingQueue')),
      unread: asBool(request.input('unread')),
    }
  }

  private serialize(item: VeilleItem, sources: VeilleSource[]) {
    return {
      ...item.serialize(),
      immichAssetId: assetIdFromDedupKey(item.dedupKey),
      provenance: itemProvenance(item, sources),
    }
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
  /**
   * Combien d'items ce filtre désigne, **et combien d'entre eux partiraient chez Immich** — le
   * décompte qu'annonce la confirmation avant une suppression par filtre (CC-108).
   *
   * ⚠️ **Ce compte est fait au moment du geste, pas au rendu de la page.** Une collecte tourne
   * toutes les minutes : le total affiché peut avoir dérivé depuis. Ce que la confirmation
   * annonce doit venir d'ici — c'est toute la raison d'être de cette route.
   *
   * ⚠️ **Réponse HTTP nue, pas de l'Inertia** — comme le proxy de vignette. La page l'appelle en
   * `fetch` **avant** d'afficher son dialogue ; une réponse Inertia y provoquerait une
   * navigation, donc effacerait le dialogue au moment de le montrer.
   *
   * ⚠️ **En `GET`, et pas par confort** : la query string est le seul transport qu'un `fetch` peut
   * porter sans jeton CSRF, et un décompte n'écrit rien. Le corps de la suppression, lui, part en
   * `POST` par Inertia, qui pose le jeton.
   *
   * ⚠️ **Le nombre de médias est la seule chose que l'utilisateur ne peut pas déduire de
   * l'écran** : le total, il le lit dans « N éléments » ; combien d'assets Immich vont réellement
   * à la corbeille, personne ne peut le compter à l'œil sur trois pages.
   */
  async countFiltered({ request, response }: HttpContext) {
    const filters = await this.validatedFilters(request)

    if (isFilterEmpty(filters)) {
      return response.unprocessableEntity({ error: EMPTY_FILTER_REFUSAL })
    }

    const [total, media] = await Promise.all([
      filteredItems(filters).count('* as total'),
      filteredItems(filters).whereLike('dedup_key', IMMICH_DEDUP_LIKE).count('* as total'),
    ])

    // ⚠️ Postgres rend `count()` en `bigint`, donc en **chaîne** : sans `Number()`, le dialogue
    // afficherait une concaténation au lieu d'une addition.
    return response.ok({
      total: Number(total[0].$extras.total ?? 0),
      media: Number(media[0].$extras.total ?? 0),
    })
  }

  /**
   * Supprime **tout ce que le filtre désigne**, au-delà de la page courante (CC-108).
   *
   * ⚠️ **La page n'envoie aucun identifiant, elle envoie le critère.** C'est ce qui remplace le
   * plafond de 200 ids de CC-63 : ce n'est plus la page qui décide de ce qui part, et un client
   * forgé ne peut pas désigner autre chose que ce qu'un filtre désigne.
   *
   * ⚠️ **Un filtre vide est refusé, et ce refus est la garantie principale du lot.** Sans lui, le
   * bouton devient « vider la veille » derrière un `confirm()` d'une ligne. La page ne l'offre
   * pas — la barre de rappel n'existe pas sans filtre — mais une route est un contrat public :
   * `curl` muni d'un cookie valide n'a que faire du rendu Vue. **Les deux, jamais l'un sans
   * l'autre.**
   *
   * ⚠️ **La suppression elle-même passe par `deleteItems`, inchangée.** Immich d'abord et la base
   * ensuite, rien de marqué si Immich échoue, le partiel assumé, `trashDays()` relu avant chaque
   * lot, l'idempotence par `deleted_at IS NULL`. Écrire un second chemin de suppression serait la
   * façon la plus sûre d'en perdre un.
   */
  async destroyFiltered({ request, response, session }: HttpContext) {
    const filters = await this.validatedFilters(request)

    if (isFilterEmpty(filters)) {
      session.flash('notification', { type: 'error', message: EMPTY_FILTER_REFUSAL })
      return response.redirect().back()
    }

    const ids = await filteredItems(filters).select('id')
    const outcome = await this.deletion.deleteItems(ids.map((item) => item.id))

    this.flashOutcome(session, outcome)
    return response.redirect().back()
  }

  /** Le filtre posté ou passé en query string, validé puis ramené aux six champs du flux. */
  private async validatedFilters(request: HttpContext['request']): Promise<ItemFilters> {
    const payload = await request.validateUsing(itemFilterValidator)

    return {
      type: payload.type ?? null,
      tag: payload.tag ?? null,
      search: payload.search ?? null,
      // ⚠️ **Le validateur ne connaît pas la sentinelle, et ne doit pas la connaître** : elle a
      // trois états qu'un schéma Vine n'exprime pas sans se dédoubler, et deux définitions d'un
      // même `'none'` sont la panne muette que CC-105 vient de corriger.
      sourceId: parseSourceFilter(payload.sourceId),
      readingQueue: payload.readingQueue ?? false,
      unread: payload.unread ?? false,
    }
  }

  async destroyMany({ request, response, session }: HttpContext) {
    const { ids } = await request.validateUsing(itemIdsValidator)
    const outcome = await this.deletion.deleteItems(ids)

    this.flashOutcome(session, outcome)
    return response.redirect().back()
  }

  /**
   * Les **trois tons** du retour d'une suppression, jamais le silence — partagés par les deux
   * chemins (par cases et par filtre) depuis CC-108.
   *
   * ⚠️ **Partagés, pas recopiés.** Les deux gestes ont exactement les mêmes issues, et la seule
   * qui compte vraiment est la troisième : un lot par filtre peut tout à fait ne rien trouver
   * (un second onglet a déjà supprimé). Un chemin qui l'aurait oubliée aurait laissé le bouton
   * paraître cassé, sur le geste le plus destructeur du module.
   */
  private flashOutcome(session: HttpContext['session'], outcome: DeletionOutcome) {
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
  }
}
