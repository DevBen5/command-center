import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import VeilleItem from '#modules/veille/models/veille_item'
import ImmichClient from '#modules/veille/services/immich_client'
import YoutubeClient from '#modules/veille/services/youtube_client'
import { assetIdFromDedupKey } from '#modules/veille/services/immich_asset'
import { videoIdFromDedupKey } from '#modules/veille/services/youtube_asset'

/** Ce que le proxy rend, quelle que soit la provenance. */
type Thumbnail = { bytes: Buffer; contentType: string }

/**
 * Le proxy de vignette (CC-55, généralisé en CC-88) — la seule chose qui traverse le serveur, et
 * jamais un fichier.
 *
 * Immich exige la clé d'API pour servir une vignette, et **`IMMICH_API_KEY` ne repart jamais vers
 * le client** (même doctrine que `LLM_API_KEY`). Un `<img src>` direct vers Immich supposerait donc
 * de donner la clé au navigateur : c'est ce que cette route évite.
 *
 * ⚠️ **Ce n'est pas une copie.** Rien n'est écrit sur le disque ni en base : les octets traversent
 * et sont oubliés. La décision qui porte le lot — « Immich possède les octets, Command Center
 * possède le sens » — reste entière, et `npm run db:backup` reste une sauvegarde complète.
 *
 * ⚠️ **La route est indexée par l'id d'item de NOTRE base, jamais par l'identifiant du média.**
 * C'est le point de sécurité du lot, et il est structurel :
 *
 * - une route `/veille/immich/:assetId/thumbnail` serait un **proxy de lecture ouvert sur toute la
 *   bibliothèque personnelle** — n'importe quel asset, photos de famille comprises, servi par un
 *   serveur qui porte la clé d'API. Le paramètre étant l'identifiant Immich lui-même, il n'y
 *   aurait rien à vérifier contre quoi que ce soit ;
 * - ici le seul paramètre venu du client est un **entier**. L'identifiant est relu dans
 *   `dedup_key`, c'est-à-dire une valeur que nous avons écrite nous-mêmes, et l'autorisation est un
 *   effet de bord de la recherche : ce qui n'est pas dans la table n'est pas servi.
 *
 * ⚠️ **L'aiguillage se fait sur le PRÉFIXE de `dedup_key`** (CC-88), pas sur `veille_items.type` :
 * `image` et `video` valent pour les deux provenances, alors que `immich:` et `youtube:` sont
 * mutuellement exclusifs par construction — c'est le préfixe qui porte l'information, et
 * `assetIdFromDedupKey` / `videoIdFromDedupKey` refusent déjà ce qui n'est pas de leur ressort.
 *
 * ⚠️ **Réponse HTTP nue, pas de l'Inertia** — comme l'export JSON de Leitner. Côté page, c'est un
 * `<img src>` natif ; ni `<Link>`, ni `router.get()`, qui attendent une réponse Inertia.
 */
@inject()
export default class VeilleMediaController {
  constructor(
    private immich: ImmichClient,
    private youtube: YoutubeClient
  ) {}

  async thumbnail({ params, response }: HttpContext) {
    // ⚠️ `visible()` (CC-63) : l'autorisation reste un effet de bord de la recherche, et un item
    // supprimé n'est plus dans la table *visible*. Son asset est à la corbeille d'Immich, qui
    // répondrait de toute façon en erreur — mais l'autorisation ne doit pas dépendre de ce que
    // l'autre système veut bien refuser.
    const item = await VeilleItem.visible().where('id', params.id).first()

    // Un item inconnu, une capture manuelle, un article : aucun n'a de média derrière lui. Les
    // deux lecteurs de clé rendent `null` dans ces cas, et vérifient la forme de l'identifiant.
    const assetId = item ? assetIdFromDedupKey(item.dedupKey) : null
    const videoId = item ? videoIdFromDedupKey(item.dedupKey) : null

    if (assetId === null && videoId === null) {
      return response.notFound({ error: 'Aucun média pour cet item.' })
    }

    try {
      /**
       * ⚠️ **Côté YouTube, l'identifiant relu ici est la SEULE donnée qui traverse.**
       * `metadata.thumbnailUrl` porte bien l'URL annoncée par l'API, et il serait tentant de la
       * passer au client — ne le fais pas : ce serait une valeur relue en base promue en cible
       * réseau. `YoutubeClient.thumbnail` dérive l'URL d'un hôte constant et d'un identifiant
       * validé, exactement comme le client Immich n'a qu'une seule instance à interroger.
       */
      const thumbnail: Thumbnail =
        assetId !== null
          ? await this.immich.thumbnail(assetId)
          : await this.youtube.thumbnail(videoId!)

      response.header('content-type', thumbnail.contentType)
      /**
       * ⚠️ `private` : c'est du contenu servi derrière `veille.view`. Sans lui, un mandataire
       * partagé pourrait servir la vignette à quelqu'un d'autre. Une heure suffit — une vignette
       * ne change pas. Vrai des deux provenances, y compris YouTube : la miniature est publique
       * chez Google, mais la **route**, elle, ne l'est pas.
       */
      response.header('cache-control', 'private, max-age=3600')

      return response.send(thumbnail.bytes)
    } catch (error) {
      /**
       * ⚠️ **404 au navigateur, mais jamais silencieux côté serveur.** Une image cassée est le
       * bon comportement visuel — le média a pu être réellement supprimé, et c'est précisément ce
       * que le ticket veut voir. Mais sans ce log, « Immich éteint », « clé révoquée », « vidéo
       * supprimée » et « réseau coupé » seraient indiscernables, et le premier réflexe serait
       * d'accuser le proxy. Même doctrine que le repli muet du juge Leitner.
       */
      logger.warn(
        {
          itemId: item?.id,
          kind: assetId !== null ? 'immich' : 'youtube',
          error: error instanceof Error ? error.message : String(error),
        },
        "La vignette n'a pas pu être récupérée."
      )
      return response.notFound({ error: 'Vignette indisponible.' })
    }
  }
}
