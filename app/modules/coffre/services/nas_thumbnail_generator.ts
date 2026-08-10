import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import type { CatalogThumbnail } from '#modules/coffre/services/catalog_source'
import { PHOTO_CONTENT_TYPES } from '#modules/coffre/services/nas_file_format'

/**
 * Le générateur de vignettes serveur pour les médias NAS (CC-228) — **photos seulement**, décision
 * du ticket : une vidéo ne reçoit aucune image extraite (ffmpeg est un second binaire et un second
 * axe multi-arch, hors périmètre, à re-ticketer si le besoin se confirme).
 *
 * ⚠️ **`sharp` a été écarté par une mesure réelle, pas par principe** : ses binaires précompilés
 * n'embarquent PAS le codec HEVC (raisons de brevet), donc ne lisent jamais un `.heic` réel — vérifié
 * contre un fichier encodé avec `libheif`+`x265`, pas un fichier renommé. `apk add imagemagick
 * imagemagick-heic imagemagick-jpeg imagemagick-webp` lit les cinq formats de l'allow-list photo, sur
 * `node:22-alpine`, amd64 ET arm64 (QEMU) — c'est le même mécanisme de résolution par architecture
 * que `postgresql16-client` dans le `Dockerfile`, pas un nouvel axe.
 *
 * ⚠️ **Le coder est TOUJOURS forcé par préfixe (`FORMAT:chemin`), jamais un chemin nu.** La policy.xml
 * par défaut d'Alpine est la policy « open » (aucune restriction de coder) : sans ce préfixe, un
 * fichier dont le contenu ne correspond pas à son extension pourrait être sniffé vers un coder
 * dangereux (la famille ImageTragick — MVG/MSL déguisés en `.jpg`). Mesuré : un payload MVG renommé
 * `.jpg` et forcé en lecture `JPEG:` échoue proprement (« insufficient image data »), jamais exécuté
 * comme MVG. La policy.xml durcie de `docker/coffre-imagemagick-policy.xml` est la seconde ligne de
 * défense (deny-all puis allow-list), pas la seule.
 */

const IMAGEMAGICK_FORMAT_FOR: Readonly<Record<string, string>> = {
  jpg: 'JPEG',
  jpeg: 'JPEG',
  png: 'PNG',
  webp: 'WEBP',
  gif: 'GIF',
  heic: 'HEIC',
}

/**
 * ⚠️ **Garde-fou sur la SOURCE, vérifié AVANT tout appel au binaire** — c'est lui qui répond à
 * « borné… y compris sur un fichier volontairement énorme », pas une limite d'ImageMagick qu'un bug
 * de code pourrait oublier de passer. 25 Mo : largement au-dessus des « 10 à 20 Mo pour une photo
 * d'appareil moderne » cités par le ticket, avec de la marge.
 */
export const MAX_NAS_THUMBNAIL_SOURCE_BYTES = 25 * 1024 * 1024

/**
 * ⚠️ **Plafond de SORTIE, vérifié APRÈS génération** — une vignette 512×512 JPEG pèse en pratique
 * 20 à 80 Ko ; ce plafond est un filet, pas une cible.
 */
export const MAX_NAS_THUMBNAIL_BYTES = 512 * 1024

/** Le long côté maximal de la vignette générée, en pixels. */
export const NAS_THUMBNAIL_DIMENSION = 512

const GENERATION_TIMEOUT_MS = 15_000

/**
 * Refus de génération — toujours traduit en 404 uniforme par l'appelant, jamais une 500. Le message
 * n'est jamais montré au client, seulement journalisé (`logger.warn`) côté serveur, même doctrine
 * que le reste du module.
 */
export class NasThumbnailGenerationError extends Error {}

function extensionOf(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? ''
}

/**
 * Génère une vignette JPEG bornée depuis un chemin déjà résolu et confiné (voir
 * `NasRootsService.resolveInRoot` — cette fonction ne fait AUCUNE vérification de confinement,
 * elle suppose `realPath` déjà sûr).
 *
 * ⚠️ **`[0]` sur le chemin d'entrée** : sélectionne la première image d'un conteneur qui peut en
 * porter plusieurs (rafale HEIC, GIF animé) — jamais toutes, ce qui bornerait mal le temps de
 * génération sur un GIF de centaines de frames.
 */
export async function generateNasThumbnail(realPath: string): Promise<CatalogThumbnail> {
  const extension = extensionOf(realPath)
  const imFormat = Object.hasOwn(IMAGEMAGICK_FORMAT_FOR, extension)
    ? IMAGEMAGICK_FORMAT_FOR[extension]
    : null
  if (imFormat === null || !Object.hasOwn(PHOTO_CONTENT_TYPES, extension)) {
    throw new NasThumbnailGenerationError(
      `Extension hors de l'allow-list photo du catalogue : « ${extension} ».`
    )
  }

  const stats = await stat(realPath).catch(() => null)
  if (stats === null || !stats.isFile()) {
    throw new NasThumbnailGenerationError('Fichier introuvable ou pas un fichier régulier.')
  }
  if (stats.size > MAX_NAS_THUMBNAIL_SOURCE_BYTES) {
    throw new NasThumbnailGenerationError(
      `Fichier source trop volumineux pour une vignette (${stats.size} octets).`
    )
  }

  const bytes = await new Promise<Buffer>((resolve, reject) => {
    execFile(
      'magick',
      [
        // ⚠️ Les limites de ressources sont redondantes avec la policy.xml de l'image — défense en
        // profondeur, pas une duplication à nettoyer : un code qui invoquerait `magick` sans cette
        // liste resterait borné par la policy, et une policy mal copiée resterait bornée par ceci.
        '-limit',
        'memory',
        '128MiB',
        '-limit',
        'map',
        '128MiB',
        '-limit',
        'time',
        '10',
        `${imFormat}:${realPath}[0]`,
        '-auto-orient',
        '-thumbnail',
        `${NAS_THUMBNAIL_DIMENSION}x${NAS_THUMBNAIL_DIMENSION}>`,
        '-strip',
        'JPEG:-',
      ],
      {
        encoding: 'buffer',
        maxBuffer: MAX_NAS_THUMBNAIL_BYTES + 4096,
        timeout: GENERATION_TIMEOUT_MS,
      },
      (error, stdout) => {
        if (error) {
          reject(
            new NasThumbnailGenerationError(`La génération de vignette a échoué : ${error.message}`)
          )
          return
        }
        resolve(stdout as unknown as Buffer)
      }
    )
  })

  if (bytes.length === 0) {
    throw new NasThumbnailGenerationError('La vignette générée est vide.')
  }
  if (bytes.length > MAX_NAS_THUMBNAIL_BYTES) {
    throw new NasThumbnailGenerationError(
      `Vignette générée trop volumineuse (${bytes.length} octets).`
    )
  }

  return { bytes, contentType: 'image/jpeg' }
}
