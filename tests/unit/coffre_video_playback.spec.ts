import { test } from '@japa/runner'
import {
  ffmpegArgsFor,
  ffprobeArgsFor,
  PLAN_SANS_RANGE,
  videoPlaybackPlanFor,
  type VideoProbe,
} from '#modules/coffre/services/video_playback'

/**
 * La décision de lecture vidéo du coffre (CC-241) — la partie **pure** du lot, celle qu'on peut
 * prouver sans binaire. `ffmpeg` n'existe ni sur le poste de développement (mesuré : aucun binaire
 * sur le `PATH`, seulement des bibliothèques `libav*` et des copies confinées dans des runtimes
 * Flatpak) ni sur les runners de CI, et c'est précisément pour ça que la décision a été séparée de
 * l'exécution.
 *
 * ⚠️ **Ce que ce fichier ne prouve PAS, et qu'aucun test de ce dépôt ne prouve** : qu'un vrai
 * `ffmpeg` accepte ces arguments et produit un flux qu'un navigateur lit. Cette preuve-là est une
 * mesure manuelle dans l'image — voir le `CLAUDE.md` du module.
 */

function sonde(partial: Partial<VideoProbe>): VideoProbe {
  return { formatName: 'mp4', videoCodec: 'h264', audioCodec: 'aac', ...partial }
}

test.group('Coffre / la décision de lecture vidéo', () => {
  test('un MP4/H.264 déjà lisible part SANS transcodage', ({ assert }) => {
    /**
     * ⚠️ **L'exigence explicite du ticket.** Un transcodage « au cas où » viderait la
     * fonctionnalité de son intérêt : il coûterait un processus par lecture et ferait perdre le
     * déplacement du curseur (voir `PLAN_SANS_RANGE`) sur des fichiers qui n'en avaient aucun
     * besoin.
     */
    assert.equal(videoPlaybackPlanFor(sonde({})), 'passthrough')
    assert.isFalse(PLAN_SANS_RANGE.has('passthrough'))
  })

  test('⚠️ le `format_name` COMPOSITE de ffprobe est reconnu comme MP4', ({ assert }) => {
    /**
     * ⚠️ **Le piège qui aurait fait transcoder TOUTE la bibliothèque en silence.** `ffprobe` rend
     * `mov,mp4,m4a,3gp,3g2,mj2` pour tout ce qui est de la famille ISO-BMFF — donc pour un MP4
     * parfaitement ordinaire. Comparer la chaîne entière à `'mp4'` n'aurait JAMAIS matché : chaque
     * MP4 serait parti en ré-empaquetage, le contraire exact de ce que le ticket demande, sans
     * qu'aucune erreur ne le signale.
     */
    assert.equal(
      videoPlaybackPlanFor(sonde({ formatName: 'mov,mp4,m4a,3gp,3g2,mj2' })),
      'passthrough'
    )
  })

  test('du HEVC est transcodé, quel que soit son conteneur', ({ assert }) => {
    // Le cas majoritaire d'un NAS familial : la vidéo d'iPhone, du HEVC dans un `.mov`.
    assert.equal(
      videoPlaybackPlanFor(sonde({ formatName: 'mov,mp4,m4a', videoCodec: 'hevc' })),
      'transcode'
    )
    // Même dans un conteneur MP4 : c'est le CODEC que le navigateur refuse, pas l'emballage.
    assert.equal(
      videoPlaybackPlanFor(sonde({ formatName: 'mp4', videoCodec: 'hevc' })),
      'transcode'
    )
  })

  test('des codecs lisibles dans un conteneur qui ne l’est pas sont RÉ-EMPAQUETÉS, pas ré-encodés', ({
    assert,
  }) => {
    /**
     * ⚠️ **La distinction qui économise le CPU sur le cas le plus fréquent après le HEVC.** Un
     * `.mkv` ou un `.avi` porte très souvent du H.264 parfaitement lisible : un `-c copy` suffit,
     * sans toucher une seule image. Les confondre avec le HEVC ferait payer un ré-encodage complet
     * à des fichiers qui n'en ont pas besoin — sur un Celeron J3455, c'est la différence entre
     * quelques pour cent de CPU et une machine à genoux.
     */
    assert.equal(videoPlaybackPlanFor(sonde({ formatName: 'matroska,webm' })), 'passthrough')
    assert.equal(videoPlaybackPlanFor(sonde({ formatName: 'matroska' })), 'remux')
    assert.equal(videoPlaybackPlanFor(sonde({ formatName: 'avi' })), 'remux')
  })

  test('un codec AUDIO hors liste impose le ré-encodage même avec une vidéo lisible', ({
    assert,
  }) => {
    // Un `.mkv` H.264 + AC-3 est courant, et le navigateur reste muet sur l'audio.
    assert.equal(videoPlaybackPlanFor(sonde({ audioCodec: 'ac3' })), 'transcode')
    assert.equal(videoPlaybackPlanFor(sonde({ audioCodec: 'dts' })), 'transcode')
  })

  test('une vidéo SANS piste audio reste lisible telle quelle', ({ assert }) => {
    // ⚠️ L'absence de piste n'est pas un codec inconnu. Les confondre transcoderait des vidéos
    // muettes (une capture d'écran, un time-lapse) qui n'en avaient aucun besoin.
    assert.equal(videoPlaybackPlanFor(sonde({ audioCodec: null })), 'passthrough')
  })

  test('une sonde impossible retombe sur les octets bruts, JAMAIS sur un transcodage', ({
    assert,
  }) => {
    /**
     * ⚠️ **Le repli le plus sûr, et il est choisi.** Une installation dont l'image n'aurait pas
     * `ffmpeg` doit continuer de servir ses fichiers exactement comme avant CC-241, pas perdre la
     * lecture de tout ce qui marchait déjà. Transcoder par défaut ferait exactement l'inverse : la
     * panne du binaire deviendrait la panne de la fonctionnalité entière.
     */
    assert.equal(videoPlaybackPlanFor(null), 'passthrough')
    // Un conteneur sans piste vidéo n'est pas une vidéo à réparer : le transcoder rendrait du vide.
    assert.equal(videoPlaybackPlanFor(sonde({ videoCodec: null })), 'passthrough')
  })

  test('les deux plans qui GÉNÈRENT un flux sont ceux qui ne peuvent pas honorer `Range`', ({
    assert,
  }) => {
    // La taille de sortie n'existe pas encore : aucun `content-range` n'est calculable.
    assert.isTrue(PLAN_SANS_RANGE.has('remux'))
    assert.isTrue(PLAN_SANS_RANGE.has('transcode'))
    assert.equal(PLAN_SANS_RANGE.size, 2)
  })
})

test.group('Coffre / les arguments passés aux binaires vidéo', () => {
  test('⚠️ le chemin est un ÉLÉMENT du tableau, jamais concaténé dans une chaîne', ({ assert }) => {
    /**
     * ⚠️ **L'exigence de sécurité du ticket, vérifiée sur un nom réellement hostile.** Un chemin de
     * fichier NAS est une entrée utilisateur même après résolution : le propriétaire du NAS choisit
     * ses noms de fichiers. Tant qu'il occupe une case entière du tableau et qu'aucun shell n'est
     * lancé (`spawn`/`execFile`, `shell: false`), `;`, `$(…)`, `&&` et les espaces sont des
     * caractères ordinaires d'un nom de fichier. Une chaîne interpolée passée à `exec()` en ferait
     * une exécution de commande.
     */
    const hostile = "/nas/root/; rm -rf / #$(whoami) 'et'.mp4"

    for (const args of [
      ffprobeArgsFor(hostile),
      ffmpegArgsFor(hostile, 'remux', 'software', null),
      ffmpegArgsFor(hostile, 'transcode', 'software', null),
      ffmpegArgsFor(hostile, 'transcode', 'vaapi', '/dev/dri/renderD128'),
    ]) {
      // Exactement une case, égale au chemin — donc jamais collée à un drapeau ni à un autre mot.
      assert.equal(args.filter((one) => one === hostile).length, 1)
      assert.isFalse(args.some((one) => one !== hostile && one.includes(hostile)))
    }
  })

  test('⚠️ le chemin est précédé de `-i`, jamais posé en positionnel', ({ assert }) => {
    // Un fichier dont le nom commence par `-` serait sinon lu comme une option par le binaire.
    const chemin = '-suspect.mp4'

    for (const args of [
      ffprobeArgsFor(chemin),
      ffmpegArgsFor(chemin, 'remux', 'software', null),
      ffmpegArgsFor(chemin, 'transcode', 'software', null),
    ]) {
      assert.equal(args[args.indexOf(chemin) - 1], '-i')
    }
  })

  test('le ré-empaquetage COPIE les pistes — aucun encodeur', ({ assert }) => {
    const args = ffmpegArgsFor('/nas/a.mkv', 'remux', 'software', null)

    assert.include(args.join(' '), '-c copy')
    assert.notInclude(args, 'libx264')
    assert.notInclude(args, 'h264_vaapi')
    // Le MP4 fragmenté : sans lui, l'index part en fin de fichier et le navigateur n'a rien à
    // lire avant la fin du flux.
    assert.include(args, 'frag_keyframe+empty_moov+default_base_moof')
    assert.include(args, 'pipe:1')
  })

  test('le transcodage LOGICIEL force un pixel format que les navigateurs lisent', ({ assert }) => {
    const args = ffmpegArgsFor('/nas/a.mov', 'transcode', 'software', null)

    assert.include(args, 'libx264')
    // ⚠️ Une source HEVC 10 bits (iPhone récent) produirait sinon du `yuv420p10le`, que le profil
    // H.264 des navigateurs ne lit pas : on aurait transcodé pour rien, lecteur noir compris.
    assert.include(args, 'yuv420p')
    assert.include(args, 'aac')
    // Une seule piste vidéo, l'audio optionnel : un `.mkv` porte souvent des sous-titres que le
    // muxer MP4 refuse, ce qui ferait échouer des fichiers par ailleurs parfaitement lisibles.
    assert.include(args.join(' '), '-map 0:v:0 -map 0:a:0?')
  })

  test('le transcodage MATÉRIEL cite l’encodeur VAAPI et le périphérique détecté', ({ assert }) => {
    const args = ffmpegArgsFor('/nas/a.mov', 'transcode', 'vaapi', '/dev/dri/renderD129')

    assert.include(args, 'h264_vaapi')
    assert.include(args, '/dev/dri/renderD129')
    assert.include(args, 'vaapi')
    assert.notInclude(args, 'libx264')
  })

  test('⚠️ sans périphérique, « vaapi » retombe sur le LOGICIEL au lieu de fabriquer une commande impossible', ({
    assert,
  }) => {
    /**
     * ⚠️ La combinaison ne devrait pas se produire (`VideoTranscoder.acceleration()` ne rend
     * `vaapi` qu'avec un `renderNode`), mais construire `-hwaccel_device null` échouerait au
     * lancement — donc un écran noir dont la cause serait cherchée dans le fichier plutôt que dans
     * la configuration.
     */
    const args = ffmpegArgsFor('/nas/a.mov', 'transcode', 'vaapi', null)

    assert.include(args, 'libx264')
    assert.notInclude(args, 'h264_vaapi')
  })

  test('⚠️ demander des arguments pour « passthrough » LÈVE', ({ assert }) => {
    // Ce plan ne lance aucun processus : lui fabriquer des arguments laisserait croire le
    // contraire au prochain lecteur du code.
    assert.throws(() => ffmpegArgsFor('/nas/a.mp4', 'passthrough', 'software', null))
  })
})
