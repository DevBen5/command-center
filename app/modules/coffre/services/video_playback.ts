/**
 * La décision de lecture vidéo du coffre (CC-241) — **pur** : ni disque, ni processus, ni horloge.
 * Ce fichier ne fait que répondre à deux questions, et c'est précisément ce qui le rend testable
 * sans `ffmpeg` (absent de ce poste de développement, présent uniquement dans l'image) :
 *
 * 1. **faut-il transcoder ce fichier, et si oui comment** (`videoPlaybackPlanFor`) ;
 * 2. **quel tableau d'arguments passer au binaire** (`ffprobeArgsFor`, `ffmpegArgsFor`).
 *
 * ⚠️ **Le piège que ce lot existe pour fermer** : une vidéo d'iPhone est du HEVC dans un `.mov`,
 * que ni Chrome ni Firefox ne lisent — même cause que le `.heic` de CC-229 (licence HEVC) et
 * **même échec muet** : lecteur noir, aucune erreur, rien dans la console. C'est le format par
 * défaut de l'appareil qui remplit un NAS familial, donc le cas majoritaire.
 *
 * ⚠️ **Mais le transcodage ne s'applique JAMAIS « au cas où »** — exigence explicite du ticket. Un
 * MP4/H.264 déjà lisible part en octets bruts, avec `Range`, sans qu'aucun processus ne soit lancé.
 * Transcoder par défaut viderait la fonctionnalité de son intérêt : ça coûterait un processus et
 * ferait perdre le déplacement du curseur (voir `PLAN_SANS_RANGE` plus bas) sur les fichiers qui
 * n'en avaient aucun besoin.
 */

/** Le plan de lecture retenu pour un fichier vidéo donné. */
export type VideoPlaybackPlan =
  /** Les octets du fichier, tels quels — aucun processus lancé, `Range` pleinement supporté. */
  | 'passthrough'
  /** Ré-empaquetage sans ré-encodage (`-c copy`) : les codecs conviennent, le conteneur non. */
  | 'remux'
  /** Ré-encodage complet vers H.264/AAC — le seul chemin coûteux. */
  | 'transcode'

/** Le chemin d'accélération effectivement pris — journalisé, jamais deviné après coup. */
export type VideoAcceleration = 'vaapi' | 'software'

/**
 * ⚠️ **Les deux plans qui produisent un flux généré ne peuvent pas honorer `Range`.** La taille de
 * sortie n'est pas connue à l'avance (elle n'existe pas encore), donc aucun `content-range` n'est
 * calculable : la réponse part en 200 avec `accept-ranges: none`. Conséquence assumée, à dire à
 * l'écran : sur une vidéo transcodée, le curseur ne se déplace que dans ce qui est déjà tamponné.
 * La rendre déplaçable demanderait du HLS (une segmentation, un manifeste, un cache de segments) —
 * un autre lot, pas un réglage.
 */
export const PLAN_SANS_RANGE: ReadonlySet<VideoPlaybackPlan> = new Set<VideoPlaybackPlan>([
  'remux',
  'transcode',
])

/**
 * Les codecs vidéo qu'un navigateur de bureau lit sans extension ni licence supplémentaire.
 *
 * ⚠️ **HEVC (`hevc`/`h265`) en est ABSENT volontairement, et c'est tout le sujet du lot.** Safari
 * le lit ; Chrome, Firefox et Edge non — blocage de licence, pas un retard d'implémentation. Ne
 * l'ajoute donc pas ici « parce que ça marche sur mon Mac » : ce serait rétablir l'écran noir pour
 * tous les autres navigateurs, en silence.
 */
export const CODECS_VIDEO_LISIBLES: ReadonlySet<string> = new Set(['h264', 'vp8', 'vp9', 'av1'])

/**
 * Les codecs audio lisibles. ⚠️ Un fichier **sans piste audio** est lisible aussi — l'absence de
 * piste n'est pas un codec inconnu, et la confondre avec un refus transcoderait des vidéos muettes
 * qui n'en avaient pas besoin.
 */
export const CODECS_AUDIO_LISIBLES: ReadonlySet<string> = new Set([
  'aac',
  'mp3',
  'opus',
  'vorbis',
  'flac',
])

/**
 * Les conteneurs qu'un `<video>` accepte directement.
 *
 * ⚠️ **`ffprobe` rend un `format_name` COMPOSITE** (`mov,mp4,m4a,3gp,3g2,mj2` pour tout ce qui est
 * de la famille ISO-BMFF) : il faut le découper sur les virgules et chercher une intersection,
 * jamais comparer la chaîne entière. Sans ça, aucun MP4 réel ne serait jamais reconnu compatible et
 * **tout** partirait en remux — le contraire exact de ce que le ticket demande.
 */
export const CONTENEURS_LISIBLES: ReadonlySet<string> = new Set(['mp4', 'webm'])

/** Ce que la sonde a pu établir du fichier — `null` quand `ffprobe` n'a rien su en dire. */
export interface VideoProbe {
  /** Le `format_name` de `ffprobe`, brut et possiblement composite. */
  formatName: string
  /** Le codec de la première piste vidéo, `null` s'il n'y en a aucune. */
  videoCodec: string | null
  /** Le codec de la première piste audio, `null` s'il n'y en a aucune. */
  audioCodec: string | null
}

/**
 * ⚠️ **Le conteneur se décide sur ce que `ffprobe` annonce, jamais sur l'extension du chemin.** Un
 * `.mp4` qui contiendrait en réalité du Matroska existe (renommage manuel, export raté) ; se fier au
 * nom rendrait un flux que le navigateur refuse, avec le même écran noir muet qu'on vient de fermer.
 */
function conteneurEstLisible(formatName: string): boolean {
  return formatName
    .split(',')
    .map((one) => one.trim().toLowerCase())
    .some((one) => CONTENEURS_LISIBLES.has(one))
}

/**
 * Le plan de lecture pour un fichier sondé.
 *
 * ⚠️ **`null` (sonde impossible) rend `passthrough`, jamais `transcode`.** C'est le comportement
 * d'avant CC-241, donc le repli le plus sûr : une installation dont l'image n'aurait pas `ffmpeg`
 * continue de servir ses fichiers exactement comme avant, au lieu de perdre la lecture de tout ce
 * qui marchait déjà. L'appelant journalise la sonde ratée — c'est un état à voir, pas à taire.
 *
 * ⚠️ **Un fichier SANS piste vidéo rend `passthrough`.** Ce n'est pas une vidéo à réparer : c'est
 * un conteneur audio, ou un fichier que la sonde a mal lu. Le transcoder produirait un flux vide.
 */
export function videoPlaybackPlanFor(probe: VideoProbe | null): VideoPlaybackPlan {
  if (probe === null) return 'passthrough'
  if (probe.videoCodec === null) return 'passthrough'

  const videoLisible = CODECS_VIDEO_LISIBLES.has(probe.videoCodec.toLowerCase())
  const audioLisible =
    probe.audioCodec === null || CODECS_AUDIO_LISIBLES.has(probe.audioCodec.toLowerCase())

  // Un codec hors liste impose le ré-encodage : aucun ré-empaquetage ne rend lisible du HEVC.
  if (!videoLisible || !audioLisible) return 'transcode'

  // Les codecs conviennent : reste le conteneur. `.mov`/`.mkv`/`.avi` portent très souvent du
  // H.264 parfaitement lisible — un `-c copy` suffit alors, sans toucher une seule image.
  return conteneurEstLisible(probe.formatName) ? 'passthrough' : 'remux'
}

/**
 * Les arguments de la sonde.
 *
 * ⚠️ **`-i` devant le chemin, jamais le chemin en positionnel.** Un fichier dont le nom commence
 * par `-` serait sinon lu comme une option par `ffprobe`. Le confinement du chemin est déjà tenu en
 * amont (`NasRootsService`), mais un nom de fichier reste une donnée que l'utilisateur contrôle :
 * il ne doit jamais pouvoir devenir un drapeau.
 */
export function ffprobeArgsFor(realPath: string): string[] {
  return [
    '-v',
    'error',
    '-of',
    'json',
    '-show_entries',
    'format=format_name:stream=codec_type,codec_name',
    '-i',
    realPath,
  ]
}

/**
 * Les arguments de lecture pour un plan qui produit un flux.
 *
 * ⚠️ **Ne l'appelle jamais avec `passthrough`** : ce plan ne lance aucun processus, et lui
 * fabriquer des arguments laisserait croire le contraire au prochain lecteur. La fonction lève.
 *
 * Trois décisions qui ne sont pas décoratives :
 *
 * - **`-map 0:v:0 -map 0:a:0?`** — une seule piste vidéo, une seule piste audio si elle existe. Un
 *   `.mkv` porte couramment des sous-titres et des pistes de données que le muxer MP4 refuse : sans
 *   ce filtrage, ffmpeg échoue sur des fichiers parfaitement lisibles par ailleurs. Le `?` rend
 *   l'audio optionnel — une vidéo muette ne doit pas faire échouer la commande.
 * - **`-movflags frag_keyframe+empty_moov+default_base_moof`** — du MP4 **fragmenté**. Un MP4
 *   classique place son index (`moov`) à la fin, donc après le dernier octet écrit : sur un tube,
 *   le navigateur n'aurait rien de lisible avant la fin du transcodage. Fragmenté, il joue dès les
 *   premiers octets.
 * - **`pipe:1`** — la sortie part sur `stdout`, jamais dans un fichier temporaire. Rien de déchiffré
 *   ni de dérivé du coffre ne touche le disque, ce qui est la même doctrine que le reste du module.
 */
export function ffmpegArgsFor(
  realPath: string,
  plan: VideoPlaybackPlan,
  acceleration: VideoAcceleration,
  renderNode: string | null
): string[] {
  if (plan === 'passthrough') {
    throw new Error('ffmpegArgsFor : le plan « passthrough » ne lance aucun processus.')
  }

  const sortie = ['-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1']

  // `-nostdin` : sans lui, ffmpeg hérite du `stdin` du serveur et peut le consommer.
  const entete = ['-nostdin', '-v', 'error']

  if (plan === 'remux') {
    // Aucun ré-encodage : le matériel n'a rien à faire ici, quel qu'il soit.
    return [...entete, '-i', realPath, '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', ...sortie]
  }

  const audio = ['-c:a', 'aac', '-b:a', '160k', '-ac', '2']

  if (acceleration === 'vaapi' && renderNode !== null) {
    return [
      ...entete,
      '-hwaccel',
      'vaapi',
      '-hwaccel_device',
      renderNode,
      '-hwaccel_output_format',
      'vaapi',
      '-i',
      realPath,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      // `format=nv12|vaapi,hwupload` couvre les deux cas d'un seul filtre : image déjà en mémoire
      // GPU (décodage matériel réussi) ou retombée en mémoire centrale (décodeur logiciel).
      '-vf',
      'format=nv12|vaapi,hwupload',
      '-c:v',
      'h264_vaapi',
      '-b:v',
      '8M',
      ...audio,
      ...sortie,
    ]
  }

  return [
    ...entete,
    '-i',
    realPath,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-maxrate',
    '8M',
    '-bufsize',
    '16M',
    // ⚠️ `yuv420p` explicite : une source 10 bits (HEVC d'iPhone récent) produirait sinon du
    // `yuv420p10le`, que le profil H.264 baseline des navigateurs ne lit pas — on aurait transcodé
    // pour rien, et le lecteur resterait noir.
    '-pix_fmt',
    'yuv420p',
    ...audio,
    ...sortie,
  ]
}
