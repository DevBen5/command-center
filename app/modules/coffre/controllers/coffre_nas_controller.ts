import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import ForbiddenException from '#core/shared/exceptions/forbidden_exception'
import vault from '#modules/coffre/services/vault_service'
import NasRootsService from '#modules/coffre/services/nas_roots_service'
import { nasContentTypeFor } from '#modules/coffre/services/nas_file_format'
import { parseByteRange } from '#modules/coffre/services/byte_range'

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
 */
@inject()
export default class CoffreNasController {
  constructor(private roots: NasRootsService) {}

  async stream({ auth, params, request, response, session }: HttpContext) {
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

    const contentType = nasContentTypeFor(realPath)
    if (contentType === null) {
      logger.warn({ fileId }, 'Le fichier référencé a une extension hors allow-list.')
      return response.notFound({ error: 'Média introuvable.' })
    }

    // ⚠️ **`stat` est gardé, et pas seulement pour lire une taille.** `realpath` réussit sur un
    // DOSSIER — un dossier nommé `album.jpg` sous une racine passe l'allow-list d'extension — et
    // le fichier peut avoir disparu du NAS entre la résolution et cette ligne. Sans cette garde,
    // `createReadStream` échoue APRÈS l'envoi des en-têtes : une 500 là où tout le reste du module
    // rend un 404 uniforme, donc un échec qui cesse d'être indiscernable des autres.
    const stats = await stat(realPath).catch(() => null)
    if (stats === null || !stats.isFile()) {
      logger.warn({ fileId }, "Le chemin résolu n'est pas un fichier lisible.")
      return response.notFound({ error: 'Média introuvable.' })
    }
    const size = stats.size

    response.header('cache-control', 'no-store')
    response.header('pragma', 'no-cache')
    response.header('accept-ranges', 'bytes')
    response.header('content-type', contentType)

    const range = request.header('range')
    if (range === undefined) {
      response.header('content-length', String(size))
      response.stream(createReadStream(realPath))
      return
    }

    const parsed = parseByteRange(range, size)
    if (parsed === null) {
      response.header('content-range', `bytes */${size}`)
      return response.requestedRangeNotSatisfiable()
    }

    response.status(206)
    response.header('content-range', `bytes ${parsed.start}-${parsed.end}/${size}`)
    response.header('content-length', String(parsed.end - parsed.start + 1))
    response.stream(createReadStream(realPath, { start: parsed.start, end: parsed.end }))
  }
}
