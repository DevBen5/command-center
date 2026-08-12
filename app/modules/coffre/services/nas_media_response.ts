import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import { nasContentTypeFor, VIDEO_CONTENT_TYPES } from '#modules/coffre/services/nas_file_format'
import { parseByteRange } from '#modules/coffre/services/byte_range'
import { PLAN_SANS_RANGE, videoPlaybackPlanFor } from '#modules/coffre/services/video_playback'
import type VideoTranscoder from '#modules/coffre/services/video_transcoder'

/**
 * Servir un fichier NAS déjà résolu et confiné, en octets bruts ou transcodé à la volée (CC-241).
 *
 * ⚠️ **Cette fonction ne vérifie AUCUN confinement** — elle suppose `realPath` déjà passé par
 * `NasRootsService.resolve` / `resolveInRoot`, exactement comme `generateNasThumbnail` (CC-228). La
 * garde de chemin reste chez l'appelant : il n'y en a qu'une dans ce module, et ce lot n'en ouvre
 * pas une seconde.
 *
 * ⚠️ **Extraite pour être partagée par TROIS points d'accès**, et pas seulement par les deux que ce
 * lot ajoute : le proxy de pièce jointe de CC-181 (`/coffre/nas/:id/stream`) passe désormais par
 * ici aussi. Sans ça, une vidéo HEVC **attachée à une entrée** serait restée un lecteur noir alors
 * que la même vidéo parcourue depuis la carte NAS se lirait — une incohérence que rien n'aurait
 * signalée, sur exactement le format majoritaire d'un NAS familial.
 *
 * ⚠️ **`cache-control: no-store` reste, et ne se rediscute pas ici** (CC-180, CC-181) : une vidéo
 * mise en cache resterait lisible sur le disque du navigateur après verrouillage du coffre. Le coût
 * assumé est que chaque déplacement du curseur redemande un segment au serveur.
 */

/** Les échecs possibles — tous traduits en 404 uniforme par l'appelant, jamais un oracle. */
export type NasMediaFailure = 'unsupported' | 'not-a-file'

export interface ServeNasMediaOptions {
  /** Le fichier, déjà résolu ET confiné par l'appelant. */
  realPath: string
  /** Le transcodeur injecté — substitué en test, `ffmpeg` n'existant ni sur le poste ni en CI. */
  transcoder: VideoTranscoder
  /** Ce que le journal doit citer pour retrouver la ligne — jamais le chemin réel côté client. */
  contexte: Record<string, unknown>
}

/**
 * Sert le fichier. Rend `null` en cas de succès (la réponse est déjà écrite), ou la cause de
 * l'échec pour que l'appelant rende SON 404 — le message uniforme n'appartient pas à cette
 * fonction, chaque point d'accès a le sien.
 */
export async function serveNasMedia(
  ctx: HttpContext,
  options: ServeNasMediaOptions
): Promise<NasMediaFailure | null> {
  const { realPath, transcoder, contexte } = options
  const { response } = ctx

  const contentType = nasContentTypeFor(realPath)
  if (contentType === null) return 'unsupported'

  // ⚠️ Même garde qu'avant CC-241 et pour la même raison : `realpath` réussit sur un DOSSIER — un
  // dossier nommé `album.mp4` traverse l'allow-list d'extension — et le fichier peut avoir disparu
  // entre la résolution et cette ligne. Sans elle, la lecture échoue APRÈS l'envoi des en-têtes.
  const stats = await stat(realPath).catch(() => null)
  if (stats === null || !stats.isFile()) return 'not-a-file'

  response.header('cache-control', 'no-store')
  response.header('pragma', 'no-cache')

  const extension = realPath.split('.').pop()?.toLowerCase() ?? ''
  const estVideo = Object.hasOwn(VIDEO_CONTENT_TYPES, extension)

  // ⚠️ Une photo ne se sonde pas : `ffprobe` la lirait très bien, mais lancer un processus par
  // vignette ouverte serait un coût pur. Le chemin photo est celui d'avant ce lot, inchangé.
  if (!estVideo) {
    servirOctets(ctx, realPath, contentType, stats.size)
    return null
  }

  const plan = videoPlaybackPlanFor(await transcoder.probe(realPath))

  if (!PLAN_SANS_RANGE.has(plan)) {
    // Le cas nominal, et celui que le ticket demande de prouver : un MP4/H.264 déjà lisible part
    // en octets bruts, `Range` compris, sans qu'aucun processus ne soit lancé.
    logger.debug({ ...contexte, plan }, 'Coffre / vidéo : servie sans transcodage.')
    servirOctets(ctx, realPath, contentType, stats.size)
    return null
  }

  const session = await transcoder.start(realPath, plan)
  if (session === null) {
    // ⚠️ 503 et non 404 : ce n'est PAS un échec de résolution, et le confondre avec les autres
    // tromperait à la fois l'utilisateur et le diagnostic. `retry-after` dit que réessayer a un
    // sens, ce qu'un 404 nierait.
    response.header('retry-after', '30')
    response.status(503)
    response.send({ error: 'Trop de lectures vidéo simultanées. Réessayez dans un instant.' })
    return null
  }

  // ⚠️ **La mort du processus à la déconnexion du client, la garde la plus facile à croire acquise
  // et à ne pas avoir.** Sans elle, fermer l'onglet laisse ffmpeg transcoder jusqu'au dernier
  // octet du fichier : sur un NAS, quelques onglets fermés suffisent à saturer la machine pour
  // rien. `close` couvre les deux chemins d'un seul geste — déconnexion du client ET fin normale
  // de la réponse (où `kill()` ne fait rien, le processus étant déjà sorti).
  response.response.on('close', () => session.kill())

  // ⚠️ Le flux généré n'a pas de taille connue : aucun `content-length`, et `accept-ranges: none`
  // pour que le navigateur ne demande PAS un segment qu'on ne saurait pas rendre. Voir
  // `PLAN_SANS_RANGE` — le déplacement du curseur se limite alors au tampon déjà reçu.
  response.header('accept-ranges', 'none')
  response.header('content-type', 'video/mp4')
  response.status(200)
  response.stream(session.stream, () => {
    session.kill()
    // Rien n'est rendu au client : les en-têtes sont déjà partis. Le journal porte la cause.
    logger.warn(contexte, 'Coffre / vidéo : le flux transcodé a été interrompu.')
    return ['', 500]
  })

  return null
}

/** Le chemin d'octets bruts — celui d'avant CC-241, `Range` compris, à la lettre. */
function servirOctets(
  { request, response }: HttpContext,
  realPath: string,
  contentType: string,
  size: number
): void {
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
    response.requestedRangeNotSatisfiable()
    return
  }

  response.status(206)
  response.header('content-range', `bytes ${parsed.start}-${parsed.end}/${size}`)
  response.header('content-length', String(parsed.end - parsed.start + 1))
  response.stream(createReadStream(realPath, { start: parsed.start, end: parsed.end }))
}
