import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import immichConfig, { type ImmichConfig } from '#config/immich'
import VeilleSource, { IMMICH_SOURCE_URL_PREFIX } from '#modules/veille/models/veille_source'
import ImmichClient from '#modules/veille/services/immich_client'
import { immichDedupKey, type ImmichAsset } from '#modules/veille/services/immich_asset'
import { insertNewItems, type NewItem } from '#modules/veille/services/veille_item_writer'

/** Ce qu'une passe Immich rapporte à l'orchestrateur. */
export type ImmichCollectOutcome = {
  /** Assets retenus dans l'album. `0` n'est pas une erreur, c'est une anomalie affichée. */
  found: number
  /** Items réellement écrits — les autres étaient déjà là. */
  inserted: number
  /** Assets qui ont quitté l'album depuis la dernière passe. */
  disappeared: number
}

/**
 * Le message qui marque une source désactivée **par la configuration**, et pas par l'utilisateur.
 *
 * ⚠️ La comparaison exacte est ce qui permet de réactiver la source quand `.env` est réparé, sans
 * jamais écraser une désactivation volontaire faite depuis l'écran des sources. Sans ce marqueur,
 * il faudrait choisir entre deux mauvaises options : réactiver à chaque démarrage (et ignorer
 * l'utilisateur) ou ne jamais réactiver (et laisser la source muette après une correction, sans
 * dire pourquoi).
 */
const DISABLED_BY_CONFIG =
  'Collecte Immich inactive : IMMICH_BASE_URL, IMMICH_API_KEY et IMMICH_ALBUM_ID doivent être ' +
  "définies dans l'environnement. La source se réactivera au prochain démarrage une fois " +
  'la configuration en place.'

/**
 * La collecte d'un album Immich.
 *
 * **Immich possède les octets, Command Center possède le sens.** Rien n'est copié : on stocke
 * l'identifiant de l'asset (dans `dedup_key`) et ce que le module produit lui-même — titre, tags,
 * et le résumé au lot suivant. C'est ce qui garde `npm run db:backup` complet : un dump SQL
 * n'aurait jamais emporté des dizaines de Go de vidéos.
 */
@inject()
export default class ImmichCollector {
  constructor(private client: ImmichClient) {}

  /**
   * La ligne `veille_sources` de l'album, alignée sur l'environnement.
   *
   * ⚠️ **La configuration reste dans `.env` ; cette ligne n'en est que le reflet.** Elle existe
   * pour que la collecte Immich hérite de tout ce que le lot 1 a construit — cadence,
   * `last_fetched_at`, **`last_error`**, `last_item_count`, rafraîchissement manuel, affichage sur
   * l'écran des sources. Sans elle, « une erreur d'API n'écrit pas un album vide en silence »
   * n'aurait aucun endroit où s'afficher.
   *
   * ⚠️ **Elle n'est créable par aucun formulaire** : `sourceValidator` impose `isPublicFeedUrl`,
   * qui refuse `immich:album:…` (ce n'est même pas une URL http). L'`url` n'est donc jamais une
   * cible réseau — c'est un identifiant d'album, et le collecteur ne la lit pas : il lit la
   * configuration.
   *
   * ⚠️ La configuration est un **paramètre**, pas une lecture directe du module. `.env.test`
   * neutralise les variables Immich (voir le fichier) : sans ce paramètre, les tests de cette
   * méthode dépendraient du `.env` de la personne qui les exécute.
   */
  async ensureSource(config: ImmichConfig = immichConfig): Promise<VeilleSource | null> {
    const existing = await VeilleSource.query().where('kind', 'immich').first()

    if (!config.enabled) {
      if (existing && existing.active) {
        existing.active = false
        existing.lastError = DISABLED_BY_CONFIG
        existing.lastErrorAt = DateTime.now()
        await existing.save()
      }
      return null
    }

    const url = `${IMMICH_SOURCE_URL_PREFIX}${config.albumId}`

    if (!existing) {
      return VeilleSource.create({
        kind: 'immich',
        url,
        title: 'Immich — album de veille',
        // Les vidéos arrivent depuis le téléphone au fil de la journée : une heure suffit, et
        // c'est le même défaut que les flux.
        fetchIntervalMinutes: 60,
        active: true,
      })
    }

    if (existing.url !== url) {
      /**
       * ⚠️ **Changer d'album vide la veille de l'ancien, en une passe.** Les items de l'ancien
       * album ne seront plus dans la liste rapportée par Immich : la différence les marquera tous
       * « plus dans l'album ». C'est défendable — ils n'en font effectivement plus partie — mais
       * c'est surprenant, donc c'est journalisé. Le marquage reste réversible : remettre l'ancien
       * album les rétablit à la passe suivante.
       */
      logger.warn(
        { from: existing.url, to: url },
        "L'album Immich de veille a changé : les items de l'ancien album seront marqués " +
          '« plus dans l’album » à la prochaine collecte.'
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
   * Une passe complète sur l'album.
   *
   * ⚠️ **Ne rattrape rien.** Toute erreur remonte à `VeilleCollectorService`, qui l'écrit dans
   * `last_error` et laisse la source intacte. C'est délibéré : la moitié de la valeur de ce lot
   * est qu'un incident réseau **ne touche pas** les items déjà collectés.
   */
  async collect(source: VeilleSource): Promise<ImmichCollectOutcome> {
    // Échouer tôt et clairement : le ticket demande qu'une rupture d'API se lise comme une erreur,
    // pas comme un album vide. C'est aussi ce qui trace la version réellement en face de nous.
    await this.client.serverVersion()

    // ⚠️ Tout ou rien : `albumAssets` lève à la moindre page en échec et ne rend **jamais** une
    // liste partielle. Toute la sûreté du marquage ci-dessous en dépend.
    const assets = await this.client.albumAssets()

    const inserted = await insertNewItems(assets.map((asset) => this.toItem(source, asset)))
    const disappeared = await this.reconcile(source, assets)

    return { found: assets.length, inserted, disappeared }
  }

  /**
   * Ce qu'un asset devient en base.
   *
   * ⚠️ **`url` reste nul, et ce n'est pas un oubli.** Le lien vers Immich se construit à
   * l'affichage à partir de `IMMICH_BASE_URL` : figé en base, il pointerait sur l'ancien domaine
   * le jour d'un déménagement, et **tous** les liens casseraient en silence. Ici, changer une
   * variable d'environnement suffit.
   *
   * ⚠️ **L'identifiant de l'asset ne vit que dans `dedup_key`** — unique, indexé, et déjà relu par
   * le proxy de vignette. Le recopier dans `metadata` en ferait une seconde source de vérité, à
   * garder synchronisée pour rien.
   */
  private toItem(source: VeilleSource, asset: ImmichAsset): NewItem {
    return {
      type: asset.type,
      sourceId: source.id,
      dedupKey: immichDedupKey(asset.id),
      url: null,
      // Le nom de fichier est tout ce qu'on a sans IA — et il est indexé par `search_vector`,
      // donc réellement utile pour retrouver un média. Le vrai titre viendra du lot 3.
      title: asset.fileName,
      content: null,
      // Le réseau d'origine **s'il est lisible dans le nom de fichier**, sinon rien : on ne devine
      // pas. Un tag faux se retrouverait dans la barre de tags et dans les filtres.
      tags: asset.network ? [asset.network] : [],
      metadata: {
        sourceTitle: source.title,
        durationSeconds: asset.durationSeconds,
      },
      publishedAt: asset.takenAt,
    }
  }

  /**
   * Aligne l'état des items sur ce que l'album contient réellement — dans les **deux** sens.
   *
   * Le retour compte autant que le marquage : un asset remis dans l'album redevient normal à la
   * passe suivante. Sans ça, une sortie accidentelle serait définitive, et il faudrait passer par
   * la base pour la défaire.
   *
   * ⚠️ **Cette méthode n'est appelée qu'après une pagination complète et réussie.** Appelée sur
   * une liste partielle, elle marquerait « plus dans l'album » des dizaines d'assets présents —
   * la panne silencieuse la plus coûteuse de ce lot, puisqu'elle *ressemble* à un fonctionnement
   * normal. C'est `ImmichClient.albumAssets()` qui garantit le tout-ou-rien ; ne l'affaiblis pas.
   */
  private async reconcile(source: VeilleSource, assets: ImmichAsset[]): Promise<number> {
    const present = assets.map((asset) => immichDedupKey(asset.id))
    const now = DateTime.now().toSQL()

    const gone = db
      .from('veille_items')
      .where('veille_source_id', source.id)
      .whereNull('unavailable_at')

    // ⚠️ Le cas de l'album vide est traité **explicitement**, pas laissé à `whereNotIn([])` — dont
    // le SQL produit (`1 = 1`) donne certes le bon résultat, mais par accident. Un album vidé par
    // l'utilisateur marque bien tous ses items ; le bandeau « 0 entrée » du lot 1 le signale, et
    // une *erreur* d'API n'arrive jamais jusqu'ici.
    if (present.length > 0) gone.whereNotIn('dedup_key', present)

    const disappeared = await gone.update({ unavailable_at: now })

    if (present.length > 0) {
      await db
        .from('veille_items')
        .where('veille_source_id', source.id)
        .whereNotNull('unavailable_at')
        .whereIn('dedup_key', present)
        .update({ unavailable_at: null })
    }

    // `update()` rend le nombre de lignes touchées ; le driver `pg` le donne en nombre.
    return Number(disappeared) || 0
  }
}
