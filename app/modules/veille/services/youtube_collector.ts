import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import youtubeConfig, { type YoutubeConfig } from '#config/youtube'
import VeilleSource, { YOUTUBE_SOURCE_URL_PREFIX } from '#modules/veille/models/veille_source'
import YoutubeClient from '#modules/veille/services/youtube_client'
import {
  YOUTUBE_TAG,
  youtubeDedupKey,
  type YoutubeVideo,
} from '#modules/veille/services/youtube_asset'
import { insertNewItems, type NewItem } from '#modules/veille/services/veille_item_writer'

/** Ce qu'une passe YouTube rapporte à l'orchestrateur. */
export type YoutubeCollectOutcome = {
  /** Vidéos lisibles dans la playlist. `0` n'est pas une erreur, c'est une anomalie affichée. */
  found: number
  /** Items réellement écrits — les autres étaient déjà là. */
  inserted: number
  /** Vidéos qui ont quitté la playlist depuis la dernière passe. */
  disappeared: number
}

/**
 * Le message qui marque la source désactivée **par la configuration**, et pas par l'utilisateur.
 *
 * ⚠️ La comparaison exacte est ce qui permet de réactiver la source quand `.env` est réparé, sans
 * jamais écraser une désactivation volontaire faite depuis l'écran des sources — même mécanique
 * que `DISABLED_BY_CONFIG` côté Immich, et pour la même raison : sans marqueur, il faudrait
 * choisir entre réactiver à chaque démarrage (donc ignorer l'utilisateur) et ne jamais réactiver
 * (donc laisser la source muette après une correction, sans dire pourquoi).
 */
const DISABLED_BY_CONFIG =
  'Collecte YouTube inactive : YOUTUBE_API_KEY et YOUTUBE_PLAYLIST_ID doivent être définies ' +
  "dans l'environnement. La source se réactivera au prochain démarrage une fois la " +
  'configuration en place.'

/**
 * La collecte de la playlist « Veille ».
 *
 * **YouTube possède les octets, Command Center possède le sens** — exactement comme pour Immich.
 * Rien n'est copié : on garde l'identifiant de la vidéo (dans `dedup_key`), son titre, sa durée,
 * sa chaîne, et l'URL de sa miniature. Aucune vidéo ne traverse jamais ce serveur.
 */
@inject()
export default class YoutubeCollector {
  constructor(private client: YoutubeClient) {}

  /**
   * La ligne `veille_sources` de la playlist, alignée sur l'environnement.
   *
   * ⚠️ **La configuration reste dans `.env` ; cette ligne n'en est que le reflet.** Elle existe
   * pour que la collecte YouTube hérite de tout ce que le module a déjà construit — cadence,
   * `last_fetched_at`, **`last_error`**, `last_item_count`, rafraîchissement manuel, affichage sur
   * l'écran des sources. Sans elle, un quota épuisé ou une clé révoquée n'auraient aucun endroit
   * où s'afficher.
   *
   * ⚠️ **Elle n'est créable par aucun formulaire** : `sourceValidator` impose `isPublicFeedUrl`,
   * qui refuse `youtube:playlist:…` — ce n'est même pas une URL http. L'`url` n'est donc jamais
   * une cible réseau : c'est un identifiant de playlist, et le collecteur ne la lit pas, il lit la
   * configuration.
   *
   * ⚠️ La configuration est un **paramètre**, pas une lecture directe du module. `.env.test`
   * neutralise les variables YouTube : sans ce paramètre, les tests de cette méthode dépendraient
   * du `.env` de la personne qui les exécute.
   */
  async ensureSource(config: YoutubeConfig = youtubeConfig): Promise<VeilleSource | null> {
    const existing = await VeilleSource.query().where('kind', 'youtube').first()

    if (!config.enabled) {
      if (existing && existing.active) {
        existing.active = false
        existing.lastError = DISABLED_BY_CONFIG
        existing.lastErrorAt = DateTime.now()
        await existing.save()
      }
      return null
    }

    const url = `${YOUTUBE_SOURCE_URL_PREFIX}${config.playlistId}`

    if (!existing) {
      return VeilleSource.create({
        kind: 'youtube',
        url,
        title: 'YouTube — playlist Veille',
        /**
         * Une heure, comme Immich et comme les flux. Le quota entre ici en ligne de compte : une
         * passe coûte `2 × ceil(vidéos / 50)` unités sur les 10 000 quotidiennes d'un projet
         * Google Cloud, soit ~100 par jour à cette cadence sur une playlist de 100 vidéos. La
         * marge est large, mais elle n'est pas infinie — descendre à cinq minutes la diviserait
         * par douze.
         */
        fetchIntervalMinutes: 60,
        active: true,
      })
    }

    if (existing.url !== url) {
      /**
       * ⚠️ **Changer de playlist vide la veille de l'ancienne, en une passe.** Les items de
       * l'ancienne playlist ne seront plus dans la liste rapportée : la différence les marquera
       * tous « plus dans la playlist ». C'est défendable — ils n'en font effectivement plus
       * partie — mais c'est surprenant, donc c'est journalisé. Le marquage reste réversible :
       * remettre l'ancienne playlist les rétablit à la passe suivante.
       */
      logger.warn(
        { from: existing.url, to: url },
        'La playlist YouTube de veille a changé : les items de l’ancienne seront marqués ' +
          '« plus dans la playlist » à la prochaine collecte.'
      )
      existing.url = url
    }

    // Réactivation **seulement** si c'est nous qui avions désactivé, faute de configuration.
    if (!existing.active && existing.lastError === DISABLED_BY_CONFIG) {
      existing.active = true
      existing.lastError = null
      existing.lastErrorAt = null
    }

    await existing.save()
    return existing
  }

  /**
   * Une passe complète sur la playlist.
   *
   * ⚠️ **Ne rattrape rien.** Toute erreur remonte à `VeilleCollectorService`, qui l'écrit dans
   * `last_error` et laisse la source intacte. C'est délibéré : un incident réseau **ne touche
   * pas** les items déjà collectés.
   */
  async collect(source: VeilleSource): Promise<YoutubeCollectOutcome> {
    // ⚠️ Tout ou rien : `playlistVideos` lève à la moindre page en échec et ne rend **jamais** une
    // liste partielle. Toute la sûreté du marquage ci-dessous en dépend — ne l'entoure pas d'un
    // `try/catch`, la passe paraîtrait réussir et marquerait tout.
    const videos = await this.client.playlistVideos()

    const inserted = await insertNewItems(videos.map((video) => this.toItem(source, video)))
    const disappeared = await this.reconcile(source, videos)

    return { found: videos.length, inserted, disappeared }
  }

  /**
   * Ce qu'une vidéo devient en base.
   *
   * ⚠️ **`published_at` porte la date d'AJOUT à la playlist, pas celle de la vidéo** (CC-87). La
   * liste de veille trie sur `coalesce(published_at, created_at) DESC` : avec la date de mise en
   * ligne, une conférence de 2019 ajoutée aujourd'hui atterrirait des centaines de lignes plus
   * bas, donc invisible — elle passerait pour non collectée. Une playlist de veille est une file :
   * l'événement, c'est le geste de curation. La date de la vidéo n'est pas perdue pour autant,
   * elle part dans `metadata`.
   *
   * ⚠️ **`url` porte l'URL canonique, contrairement à Immich où elle reste nulle.** La raison du
   * `null` côté Immich est qu'une URL figée pointerait sur l'ancien domaine le jour d'un
   * déménagement d'instance. `youtube.com/watch?v=<id>` n'a pas ce problème : le domaine ne nous
   * appartient pas et ne bougera pas.
   *
   * ⚠️ **L'identifiant de la vidéo ne vit que dans `dedup_key`** — unique, indexé, et c'est lui
   * que relira le proxy de vignette. Le recopier dans `metadata` en ferait une seconde source de
   * vérité, à garder synchronisée pour rien.
   */
  private toItem(source: VeilleSource, video: YoutubeVideo): NewItem {
    return {
      type: 'video',
      sourceId: source.id,
      dedupKey: youtubeDedupKey(video.videoId),
      url: `https://www.youtube.com/watch?v=${video.videoId}`,
      title: video.title,
      // Indexée par `search_vector` : c'est ce qui rend une vidéo retrouvable par son sujet, et
      // pas seulement par son titre.
      content: video.description || null,
      // La provenance est certaine, elle ne se devine pas : voir `YOUTUBE_TAG` (CC-86).
      tags: [YOUTUBE_TAG],
      metadata: {
        sourceTitle: source.title,
        durationSeconds: video.durationSeconds,
        channelTitle: video.channelTitle,
        /**
         * L'URL de miniature **telle que l'API l'a donnée**, pas une URL devinée. `maxres`
         * n'existe que sur les vidéos téléversées en HD : fabriquer `maxresdefault.jpg` sans
         * demander rendrait 404 sur les plus anciennes. C'est ce que lira CC-88.
         */
        thumbnailUrl: video.thumbnailUrl,
        /** La date de mise en ligne, conservée puisque `published_at` porte celle de l'ajout. */
        videoPublishedAt: video.publishedAt?.toISO() ?? null,
      },
      publishedAt: video.addedToPlaylistAt,
    }
  }

  /**
   * Aligne l'état des items sur ce que la playlist contient réellement — dans les **deux** sens.
   *
   * Le retour compte autant que le marquage : une vidéo remise dans la playlist redevient normale
   * à la passe suivante. Sans ça, un retrait accidentel serait définitif.
   *
   * ⚠️ **Cette méthode n'est appelée qu'après une pagination complète et réussie.** Appelée sur
   * une liste partielle, elle marquerait « plus dans la playlist » des dizaines de vidéos
   * présentes — la panne la plus coûteuse du lot, puisqu'elle *ressemble* à un fonctionnement
   * normal. C'est `YoutubeClient.playlistVideos()` qui garantit le tout-ou-rien.
   *
   * ⚠️ **Les items supprimés sont hors du calcul, dans les deux sens** (CC-63). Retirer une vidéo
   * de la playlist après l'avoir supprimée de la veille ne doit pas poser un badge sur une ligne
   * que plus personne ne regarde ; et la remettre dans la playlist ne doit pas ressusciter un item
   * volontairement supprimé, sinon une mécanique de fond déferait une décision de l'utilisateur.
   */
  private async reconcile(source: VeilleSource, videos: YoutubeVideo[]): Promise<number> {
    const present = videos.map((video) => youtubeDedupKey(video.videoId))
    const now = DateTime.now().toSQL()

    const gone = db
      .from('veille_items')
      .where('veille_source_id', source.id)
      .whereNull('deleted_at')
      .whereNull('unavailable_at')

    // ⚠️ Le cas de la playlist vide est traité **explicitement**, pas laissé à `whereNotIn([])` —
    // dont le SQL produit (`1 = 1`) donne certes le bon résultat, mais par accident. Une playlist
    // vidée par l'utilisateur marque bien tous ses items ; le `last_item_count = 0` le signale, et
    // une *erreur* d'API n'arrive jamais jusqu'ici.
    if (present.length > 0) gone.whereNotIn('dedup_key', present)

    const disappeared = await gone.update({ unavailable_at: now })

    if (present.length > 0) {
      await db
        .from('veille_items')
        .where('veille_source_id', source.id)
        .whereNull('deleted_at')
        .whereNotNull('unavailable_at')
        .whereIn('dedup_key', present)
        .update({ unavailable_at: null })
    }

    // `update()` rend le nombre de lignes touchées ; le driver `pg` le donne en nombre.
    return Number(disappeared) || 0
  }
}
