import { execFile, spawn, type ChildProcessByStdio } from 'node:child_process'
import { access, constants, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import logger from '@adonisjs/core/services/logger'
import {
  ffmpegArgsFor,
  ffprobeArgsFor,
  type VideoAcceleration,
  type VideoPlaybackPlan,
  type VideoProbe,
} from '#modules/coffre/services/video_playback'
import { libererCreneau, reserverCreneau } from '#modules/coffre/services/video_transcode_slots'

/**
 * L'exécution de `ffprobe`/`ffmpeg` pour la lecture vidéo du coffre (CC-241) — la seule partie du
 * lot qui touche un binaire externe. La **décision** (faut-il transcoder, avec quels arguments) vit
 * dans `video_playback.ts`, pur et testé sans binaire : ici il ne reste que le lancement, la borne
 * et la mort du processus.
 *
 * ⚠️ **`spawn` avec un TABLEAU d'arguments, jamais `exec()` avec une chaîne interpolée** — et
 * jamais `execFile` non plus pour `ffmpeg`, pour une raison qui n'est pas la sécurité : `execFile`
 * **tamponne** la sortie complète en mémoire avant de la rendre, ce qui pour une vidéo veut dire la
 * charger entière avant d'en servir le premier octet. `spawn` rend un flux, qui est tout l'intérêt.
 * La garantie qui compte est la même dans les deux cas : **aucun shell** (`shell: false`, le défaut),
 * donc un nom de fichier ne peut porter ni `;`, ni `$(…)`, ni redirection. `ffprobe`, lui, rend
 * quelques centaines d'octets de JSON : `execFile` y est le bon outil, borné et simple.
 *
 * ⚠️ **Injectable, sur le patron de `NasRootsService`.** `ffmpeg` n'existe ni sur le poste de
 * développement ni sur les runners de CI — les tests substituent cette classe
 * (`app.container.swap`) plutôt que d'exiger un binaire, ce qui garde les gates exécutables partout.
 * Le corollaire est nommé sans détour dans le `CLAUDE.md` du module : **aucun test de ce dépôt ne
 * prouve qu'un vrai `ffmpeg` produit un flux lisible** — cette preuve-là est une mesure manuelle,
 * dans l'image.
 */

/** Le dossier des périphériques de rendu DRM — lu une fois, jamais deviné par variable. */
const DRI_DIR = '/dev/dri'

const PROBE_TIMEOUT_MS = 10_000
const PROBE_MAX_BUFFER = 256 * 1024

/**
 * Le délai laissé à `ffmpeg` pour sortir sur `SIGTERM` avant le `SIGKILL`. Court : le processus n'a
 * rien à sauvegarder — sa sortie est un tube que plus personne ne lit.
 */
const GRACE_KILL_MS = 2_000

/** Un transcodage en cours : le flux à servir, et de quoi le tuer. */
export interface TranscodeSession {
  /** La sortie de `ffmpeg`, à brancher sur la réponse HTTP. */
  stream: Readable
  /**
   * L'identifiant du processus lancé. ⚠️ **Exposé pour être VÉRIFIABLE** : c'est ce qui permet à un
   * test d'établir que `kill()` a réellement fait mourir un processus du système, au lieu de se
   * contenter d'observer qu'une méthode a été appelée.
   */
  pid: number | undefined
  /**
   * Tue le processus et rend son créneau. **Idempotent** — appelé à la déconnexion du client comme
   * à la terminaison normale, sans coordination entre les deux.
   */
  kill(): void
}

let accelerationDetectee: { acceleration: VideoAcceleration; renderNode: string | null } | null =
  null

export default class VideoTranscoder {
  /**
   * Le chemin d'accélération disponible, détecté **une seule fois par process** puis journalisé.
   *
   * ⚠️ **La journalisation est une exigence explicite du ticket, pas du confort.** Le conteneur ne
   * reçoit pas `/dev/dri` aujourd'hui : sans cette ligne, une installation tombe en repli logiciel
   * **sans que rien ne le dise**, et la panne de performance qui s'ensuit sur le NAS est cherchée
   * partout sauf au bon endroit. Le message nomme la cause ET le remède.
   */
  async acceleration(): Promise<{ acceleration: VideoAcceleration; renderNode: string | null }> {
    if (accelerationDetectee !== null) return accelerationDetectee

    const renderNode = await this.#trouverRenderNode()
    accelerationDetectee =
      renderNode === null
        ? { acceleration: 'software', renderNode: null }
        : { acceleration: 'vaapi', renderNode }

    if (renderNode === null) {
      logger.warn(
        { dri: DRI_DIR },
        'Coffre / vidéo : aucun périphérique de rendu DRM — transcodage en REPLI LOGICIEL. ' +
          'Sur un NAS, ajouter « devices: - /dev/dri:/dev/dri » au service `app` du compose ' +
          'pour activer Quick Sync (VAAPI).'
      )
    } else {
      logger.info(
        { renderNode },
        'Coffre / vidéo : transcodage par ACCÉLÉRATION MATÉRIELLE (VAAPI).'
      )
    }

    return accelerationDetectee
  }

  async #trouverRenderNode(): Promise<string | null> {
    const entries = await readdir(DRI_DIR).catch(() => null)
    if (entries === null) return null

    // ⚠️ Un « render node » (`renderD*`), jamais une `card*` : les secondes exigent des droits que
    // le conteneur n'a pas et servent l'affichage, pas le calcul.
    for (const nom of entries.filter((one) => one.startsWith('renderD')).sort()) {
      const chemin = join(DRI_DIR, nom)
      // ⚠️ **L'existence ne suffit PAS, il faut pouvoir l'OUVRIR.** Le cas réel : `/dev/dri` est
      // bien passé au conteneur, mais le nœud appartient au groupe `render` de l'hôte auquel
      // l'utilisateur `node` n'appartient pas (il manque `group_add` au compose). Se contenter de
      // `readdir` annoncerait alors « accélération matérielle » au journal, puis ffmpeg échouerait
      // à chaque lecture — un écran noir dont la cause serait cherchée dans le fichier plutôt que
      // dans une permission. Avec ce test, on retombe proprement en logiciel, et le journal le dit.
      const ouvrable = await access(chemin, constants.R_OK | constants.W_OK)
        .then(() => true)
        .catch(() => false)
      if (ouvrable) return chemin
    }

    return null
  }

  /**
   * ⚠️ **Le seul point d'appel de `ffprobe`, isolé pour être substituable en test.** `execFile` et
   * non `spawn` : la sonde rend quelques centaines d'octets de JSON, bornés par `maxBuffer`.
   */
  protected runFfprobe(args: string[]): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      execFile(
        'ffprobe',
        args,
        { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS, maxBuffer: PROBE_MAX_BUFFER },
        (error, stdout) => resolve(error ? null : stdout)
      )
    })
  }

  /**
   * ⚠️ **Le seul point de lancement de `ffmpeg`**, isolé pour la même raison — un test peut y
   * substituer un processus réel bon marché et prouver ainsi que `kill()` tue vraiment, et que le
   * créneau est vraiment rendu, sans exiger `ffmpeg` sur la machine qui exécute les gates.
   *
   * ⚠️ **`shell` reste à son défaut (`false`)** : un nom de fichier ne peut donc porter ni `;`, ni
   * `$(…)`, ni redirection. Ne passe JAMAIS `shell: true` ici, quelle que soit la commodité.
   */
  protected spawnFfmpeg(args: string[]): ChildProcessByStdio<null, Readable, Readable> {
    return spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  }

  /**
   * Sonde un fichier. ⚠️ **Rend `null` sur le moindre échec, jamais une exception** : `ffprobe`
   * absent, fichier illisible, JSON inattendu. L'appelant retombe alors sur `passthrough`,
   * c'est-à-dire sur le comportement d'avant ce lot — un défaut de sonde ne doit pas faire perdre
   * la lecture de ce qui marchait déjà.
   */
  async probe(realPath: string): Promise<VideoProbe | null> {
    const brut = await this.runFfprobe(ffprobeArgsFor(realPath))

    if (brut === null) {
      logger.warn(
        { realPath },
        'Coffre / vidéo : la sonde ffprobe a échoué — lecture en octets bruts.'
      )
      return null
    }

    return this.#lireSonde(brut)
  }

  #lireSonde(brut: string): VideoProbe | null {
    let parsed: unknown
    try {
      parsed = JSON.parse(brut)
    } catch {
      return null
    }

    if (typeof parsed !== 'object' || parsed === null) return null
    const racine = parsed as { format?: unknown; streams?: unknown }

    const format = racine.format as { format_name?: unknown } | undefined
    const formatName = typeof format?.format_name === 'string' ? format.format_name : ''
    if (formatName === '') return null

    const streams = Array.isArray(racine.streams) ? racine.streams : []
    const codecDe = (type: string): string | null => {
      for (const one of streams) {
        if (typeof one !== 'object' || one === null) continue
        const piste = one as { codec_type?: unknown; codec_name?: unknown }
        if (piste.codec_type === type && typeof piste.codec_name === 'string') {
          return piste.codec_name
        }
      }
      return null
    }

    return {
      formatName,
      videoCodec: codecDe('video'),
      audioCodec: codecDe('audio'),
    }
  }

  /**
   * Lance un transcodage (ou un ré-empaquetage).
   *
   * ⚠️ **Rend `null` quand la borne de créneaux est atteinte** — l'appelant DOIT alors répondre au
   * client (503), jamais attendre : une file d'attente se traduirait par un lecteur figé sans
   * message.
   *
   * ⚠️ **Le créneau est rendu par les DEUX bouts** : la terminaison du processus (`close`) et
   * `kill()`. Les deux arrivent, dans un ordre non garanti ; `libererCreneau` est idempotent et
   * `#rendu` empêche le double décompte du même créneau.
   */
  async start(realPath: string, plan: VideoPlaybackPlan): Promise<TranscodeSession | null> {
    if (!reserverCreneau()) {
      logger.warn(
        { plan },
        'Coffre / vidéo : borne de transcodages simultanés atteinte — lecture refusée.'
      )
      return null
    }

    const { acceleration, renderNode } = await this.acceleration()
    const args = ffmpegArgsFor(realPath, plan, acceleration, renderNode)

    logger.info({ plan, acceleration }, 'Coffre / vidéo : flux généré par ffmpeg.')

    const child = this.spawnFfmpeg(args)

    let rendu = false
    const rendreCreneau = (): void => {
      if (rendu) return
      rendu = true
      libererCreneau()
    }

    // ⚠️ `stderr` est LU, jamais laissé se remplir : un tube que personne ne vide finit par bloquer
    // le processus qui écrit dedans — ffmpeg s'arrêterait au milieu du flux, sans erreur visible.
    let journalErreur = ''
    child.stderr.on('data', (chunk: Buffer) => {
      if (journalErreur.length < 4096) journalErreur += chunk.toString('utf8')
    })

    child.on('error', (error) => {
      logger.warn({ plan, error: error.message }, 'Coffre / vidéo : ffmpeg n’a pas pu être lancé.')
      rendreCreneau()
    })

    child.on('close', (code) => {
      if (code !== 0 && code !== null && journalErreur.trim() !== '') {
        logger.warn(
          { plan, code, stderr: journalErreur.trim() },
          'Coffre / vidéo : ffmpeg a échoué.'
        )
      }
      rendreCreneau()
    })

    let minuteur: NodeJS.Timeout | null = null

    return {
      stream: child.stdout,
      pid: child.pid,
      kill: () => {
        rendreCreneau()
        if (child.exitCode !== null || child.signalCode !== null) return

        child.kill('SIGTERM')
        // ⚠️ Le `SIGKILL` de secours : un ffmpeg bloqué sur une écriture dans un tube dont plus
        // personne ne lit l'autre bout n'atteint jamais son gestionnaire de `SIGTERM`. Sans ce
        // second temps, fermer l'onglet laisserait le processus vivre jusqu'au bout du fichier —
        // exactement ce que le ticket demande de fermer.
        if (minuteur !== null) return
        minuteur = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
        }, GRACE_KILL_MS)
        // ⚠️ `unref()` : ce minuteur ne doit pas retenir le process au moment de s'arrêter — même
        // raison que l'absence de `setInterval` dans `vault_keyring.ts`.
        minuteur.unref()
      },
    }
  }
}

/**
 * Oublie l'accélération détectée. ⚠️ **Réservé aux tests** : la détection est mise en cache pour la
 * vie du process, donc un test qui la déclenche figerait la valeur pour tous les suivants.
 */
export function reinitialiserAccelerationDetectee(): void {
  accelerationDetectee = null
}
