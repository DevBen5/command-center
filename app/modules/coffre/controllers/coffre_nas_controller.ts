import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import ForbiddenException from '#core/shared/exceptions/forbidden_exception'
import vault from '#modules/coffre/services/vault_service'
import NasRootsService from '#modules/coffre/services/nas_roots_service'
import VideoTranscoder from '#modules/coffre/services/video_transcoder'
import { serveNasMedia } from '#modules/coffre/services/nas_media_response'

/**
 * Le proxy de streaming de médias NAS du coffre — photos ET vidéos (CC-181). Reprend le patron de
 * `CoffreMediaController`, avec le disque du NAS à la place d'Immich.
 *
 * ⚠️ **Un seul point d'accès sert les deux natures** — décision de l'amendement du ticket
 * (2026-08-06) : `Range` est utile à la vidéo, sans objet pour une photo, mais le même code sert
 * les deux sans qu'il faille dupliquer la garde de chemin. `NasRootsService.resolve` et le
 * `content-type` déterminé par nous ne connaissent pas la nature du fichier.
 *
 * ⚠️ **La route est indexée par l'`id` de NOTRE ligne `coffre_entry_nas_file`, jamais par un
 * chemin ni un id qui viendrait du client** — même décision de sécurité que le proxy de vignette.
 * Le chemin réel n'est déchiffré qu'ici, avec la clé de session élevée, puis résolu contre les
 * racines autorisées : le client ne voit jamais où sur le disque se trouve le fichier.
 *
 * ⚠️ **Elle hérite EN PLUS du mur du coffre** (`middleware.coffreOuvert()`) : un média servi sans
 * élévation viderait le coffre de son sens, le média étant le contenu.
 *
 * ⚠️ **`cache-control: no-store` + `pragma: no-cache`, comme la vignette — pas un compromis pour
 * la taille.** Le contenu du coffre est verrouillable ; un fichier mis en cache par le navigateur
 * resterait lisible sur son disque après un verrouillage. Le coût assumé : chaque segment demandé
 * repasse par ce serveur, jamais par un cache local — cohérence du modèle de sécurité du module
 * plutôt que performance.
 *
 * ⚠️ **Depuis CC-241, une vidéo passe par `serveNasMedia`, donc éventuellement par un transcodage
 * à la volée.** Une vidéo attachée est du HEVC dans un `.mov` aussi souvent qu'une vidéo parcourue
 * — c'est le format par défaut de l'iPhone. Laisser ce point d'accès hors du transcodage aurait
 * rendu le lecteur noir ici et fonctionnel deux écrans plus loin, sans que rien ne l'explique.
 * ⚠️ **Le chemin PHOTO est inchangé, à la ligne près** : aucune sonde, aucun processus.
 */
@inject()
export default class CoffreNasController {
  constructor(
    private roots: NasRootsService,
    private transcoder: VideoTranscoder
  ) {}

  async stream(ctx: HttpContext) {
    const { auth, params, response, session } = ctx
    const user = auth.user!
    const key = vault.keyFor(user, session)
    if (key === null) {
      throw new ForbiddenException('Le coffre est verrouillé.')
    }

    const fileId = Number(params.id)
    const relativePath = await vault.nasFilePathFor(user, key, fileId)
    if (relativePath === null) {
      return response.notFound({ error: 'Média introuvable.' })
    }

    const realPath = await this.roots.resolve(relativePath)
    if (realPath === null) {
      // ⚠️ Ne dit jamais POURQUOI (racine non montée, chemin déplacé, ou hostile) — même
      // doctrine que la vignette : indiscernable pour le client, nommé côté serveur.
      logger.warn(
        { fileId },
        "Le fichier référencé n'a pas pu être résolu sous une racine autorisée."
      )
      return response.notFound({ error: 'Média introuvable.' })
    }

    // ⚠️ Depuis CC-241, la lecture (allow-list, `stat`, `Range`, transcodage éventuel) vit dans
    // `serveNasMedia`, partagée avec les deux points d'accès neufs. Ce contrôleur ne garde que ce
    // qui lui est propre : le déchiffrement du chemin et la résolution contre les racines.
    const echec = await serveNasMedia(ctx, {
      realPath,
      transcoder: this.transcoder,
      contexte: { fileId },
    })

    if (echec !== null) {
      logger.warn(
        { fileId, echec },
        echec === 'unsupported'
          ? 'Le fichier référencé a une extension hors allow-list.'
          : "Le chemin résolu n'est pas un fichier lisible."
      )
      return response.notFound({ error: 'Média introuvable.' })
    }
  }
}
