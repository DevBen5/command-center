import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import NasRootsService from '#modules/coffre/services/nas_roots_service'
import VideoTranscoder from '#modules/coffre/services/video_transcoder'
import {
  MAX_TRANSCODAGES_SIMULTANES,
  reinitialiserCreneaux,
  reserverCreneau,
} from '#modules/coffre/services/video_transcode_slots'
import { reinitialiserAccelerationDetectee } from '#modules/coffre/services/video_transcoder'
import CoffreCatalogItem from '#modules/coffre/models/coffre_catalog_item'
import { createUserWith } from '#tests/helpers/users'
import { createVault, unlockedSession } from '#tests/helpers/coffre'

/**
 * La lecture vidéo depuis le coffre (CC-241) — streaming des fichiers de source **non rattachés à
 * une entrée**, et transcodage à la volée de ce qu'un navigateur ne sait pas lire.
 *
 * ⚠️ **Ni `ffmpeg` ni `ffprobe` n'existent sur ce poste ni sur les runners de CI** (mesuré : aucun
 * binaire sur le `PATH`, seulement des bibliothèques `libav*` et des copies confinées dans des
 * runtimes Flatpak). Les deux points d'appel du binaire sont donc substitués — mais **tout le reste
 * de `VideoTranscoder.start` s'exécute réellement** : la borne de créneaux, le lancement d'un vrai
 * processus, la mort de ce processus. Ce n'est pas un objet simulé qui répond « oui », c'est le
 * mécanisme réel avec un binaire bon marché à la place du coûteux.
 *
 * ⚠️ **Ce que ce fichier ne prouve PAS** : qu'un vrai `ffmpeg` produit un flux qu'un navigateur
 * lit, ni que la lecture est fluide. Aucun test de ce dépôt ne le prouvera — voir le `CLAUDE.md` du
 * module.
 */

const SONDE_H264 = JSON.stringify({
  streams: [
    { codec_type: 'video', codec_name: 'h264' },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
})

const SONDE_HEVC = JSON.stringify({
  streams: [
    { codec_type: 'video', codec_name: 'hevc' },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
})

/** Ce que le faux `ffmpeg` écrit — reconnaissable, et différent du contenu du fichier source. */
const FLUX_TRANSCODE = 'FLUX-TRANSCODE'

/** Contenu de taille connue, pour vérifier des plages d'octets précises. */
const CONTENU_VIDEO = 'abcdefghij'.repeat(100) // 1000 octets

class FauxTranscodeur extends VideoTranscoder {
  /** La réponse que la sonde doit rendre — `null` simule un `ffprobe` absent ou en échec. */
  sondeJson: string | null = SONDE_H264
  /** Chaque lancement réellement demandé au binaire, avec ses arguments. */
  lancements: string[][] = []

  protected runFfprobe(): Promise<string | null> {
    return Promise.resolve(this.sondeJson)
  }

  protected spawnFfmpeg(args: string[]): ChildProcessByStdio<null, Readable, Readable> {
    this.lancements.push(args)
    return spawn(
      process.execPath,
      ['-e', `process.stdout.write(${JSON.stringify(FLUX_TRANSCODE)})`],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )
  }
}

test.group('Coffre / la lecture vidéo', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  let dossier: string
  let racine: string
  let transcodeur: FauxTranscodeur

  group.each.setup(async () => {
    reinitialiserCreneaux()
    reinitialiserAccelerationDetectee()

    dossier = await mkdtemp(join(tmpdir(), 'cc-nas-video-'))
    racine = join(dossier, 'root')
    await mkdir(join(racine, 'films'), { recursive: true })
    await writeFile(join(racine, 'films', 'compatible.mp4'), CONTENU_VIDEO)
    await writeFile(join(racine, 'films', 'iphone.mov'), CONTENU_VIDEO)
    await writeFile(join(racine, 'films', 'photo.jpg'), 'jpeg')
    // ⚠️ Un DOSSIER portant une extension autorisée : `realpath` y réussit et l'allow-list le
    // laisse passer — même piège que celui couvert par `coffre_nas.spec.ts`.
    await mkdir(join(racine, 'films', 'album.mp4'), { recursive: true })

    transcodeur = new FauxTranscodeur()
    app.container.swap(NasRootsService, () => new NasRootsService([{ name: 'root', path: racine }]))
    app.container.swap(VideoTranscoder, () => transcodeur)

    return async () => {
      app.container.restore(NasRootsService)
      app.container.restore(VideoTranscoder)
      reinitialiserCreneaux()
      reinitialiserAccelerationDetectee()
      await rm(dossier, { recursive: true, force: true })
    }
  })

  async function sessionOuverte() {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    return { user, session: await unlockedSession(user, vault) }
  }

  test('⚠️ un MP4/H.264 déjà compatible est servi SANS qu’aucun processus soit lancé', async ({
    client,
    assert,
  }) => {
    /**
     * ⚠️ **L'exigence explicite du ticket.** Un transcodage « au cas où » viderait la
     * fonctionnalité de son intérêt. On ne se contente donc pas de vérifier que le corps est bon :
     * on vérifie que le binaire n'a **pas** été lancé — un transcodage qui rendrait par hasard les
     * mêmes octets passerait sinon au vert.
     */
    const { user, session } = await sessionOuverte()

    const response = await client
      .get('/coffre/nas/stream?root=root&path=films/compatible.mp4')
      .loginAs(user)
      .withSession(session)

    response.assertStatus(200)
    response.assertHeader('content-type', 'video/mp4')
    response.assertHeader('accept-ranges', 'bytes')
    response.assertHeader('content-length', String(CONTENU_VIDEO.length))
    response.assertHeader('cache-control', 'no-store')
    assert.equal(response.body().toString(), CONTENU_VIDEO)

    assert.lengthOf(transcodeur.lancements, 0)
  })

  test('⚠️ un `Range` rend le SEGMENT demandé, pas le fichier entier', async ({
    client,
    assert,
  }) => {
    const { user, session } = await sessionOuverte()

    const response = await client
      .get('/coffre/nas/stream?root=root&path=films/compatible.mp4')
      .header('range', 'bytes=100-199')
      .loginAs(user)
      .withSession(session)

    response.assertStatus(206)
    response.assertHeader('content-range', `bytes 100-199/${CONTENU_VIDEO.length}`)
    response.assertHeader('content-length', '100')
    // Le contenu du segment, pas seulement sa longueur : une réponse tronquée au bon nombre
    // d'octets mais prise au mauvais endroit passerait une assertion de taille seule.
    assert.equal(response.body().toString(), CONTENU_VIDEO.slice(100, 200))
    assert.lengthOf(transcodeur.lancements, 0)
  })

  test('un `Range` hors bornes rend 416 avec la taille réelle', async ({ client }) => {
    const { user, session } = await sessionOuverte()

    const response = await client
      .get('/coffre/nas/stream?root=root&path=films/compatible.mp4')
      .header('range', 'bytes=99999-')
      .loginAs(user)
      .withSession(session)

    response.assertStatus(416)
    response.assertHeader('content-range', `bytes */${CONTENU_VIDEO.length}`)
  })

  test('⚠️ du HEVC EST transcodé, et la réponse annonce qu’elle n’accepte pas de `Range`', async ({
    client,
    assert,
  }) => {
    const { user, session } = await sessionOuverte()
    transcodeur.sondeJson = SONDE_HEVC

    const response = await client
      .get('/coffre/nas/stream?root=root&path=films/iphone.mov')
      .loginAs(user)
      .withSession(session)

    response.assertStatus(200)
    response.assertHeader('content-type', 'video/mp4')
    // ⚠️ La taille de sortie n'existe pas encore : annoncer `accept-ranges: bytes` ferait demander
    // au navigateur un segment qu'on ne saurait pas rendre.
    response.assertHeader('accept-ranges', 'none')
    response.assertHeader('cache-control', 'no-store')
    assert.equal(response.body().toString(), FLUX_TRANSCODE)

    assert.lengthOf(transcodeur.lancements, 1)
    assert.include(transcodeur.lancements[0], join(racine, 'films', 'iphone.mov'))
    assert.include(transcodeur.lancements[0].join(' '), 'pipe:1')
  })

  test('une sonde en échec retombe sur les octets bruts, jamais sur un transcodage', async ({
    client,
    assert,
  }) => {
    // Le comportement d'avant CC-241 : une image sans `ffprobe` continue de servir ses fichiers.
    const { user, session } = await sessionOuverte()
    transcodeur.sondeJson = null

    const response = await client
      .get('/coffre/nas/stream?root=root&path=films/iphone.mov')
      .loginAs(user)
      .withSession(session)

    response.assertStatus(200)
    assert.equal(response.body().toString(), CONTENU_VIDEO)
    assert.lengthOf(transcodeur.lancements, 0)
  })

  test('⚠️ une PHOTO n’est jamais sondée — le chemin d’avant le lot, inchangé', async ({
    client,
    assert,
  }) => {
    // Lancer un processus par vignette ouverte serait un coût pur : le plan vidéo ne s'applique
    // qu'aux extensions de l'allow-list VIDÉO.
    const { user, session } = await sessionOuverte()
    transcodeur.sondeJson = SONDE_HEVC

    const response = await client
      .get('/coffre/nas/stream?root=root&path=films/photo.jpg')
      .loginAs(user)
      .withSession(session)

    response.assertStatus(200)
    response.assertHeader('content-type', 'image/jpeg')
    assert.lengthOf(transcodeur.lancements, 0)
  })

  test('⚠️ au-delà de la borne, la réponse est un 503 CLAIR — jamais une attente', async ({
    client,
    assert,
  }) => {
    /**
     * ⚠️ **Le dépassement doit être dit, pas subi.** Une file d'attente sur une requête HTTP de
     * vidéo se traduirait par un lecteur figé sans message — l'échec muet que tout ce lot existe
     * pour supprimer. Et 503 plutôt que 404 : ce n'est pas un fichier introuvable, et les
     * confondre tromperait le diagnostic autant que l'utilisateur.
     */
    const { user, session } = await sessionOuverte()
    transcodeur.sondeJson = SONDE_HEVC

    for (let i = 0; i < MAX_TRANSCODAGES_SIMULTANES; i += 1) {
      assert.isTrue(reserverCreneau())
    }

    const response = await client
      .get('/coffre/nas/stream?root=root&path=films/iphone.mov')
      .loginAs(user)
      .withSession(session)

    response.assertStatus(503)
    response.assertHeader('retry-after', '30')
    assert.lengthOf(transcodeur.lancements, 0)
  })

  test('le créneau est RENDU quand la lecture se termine — deux lectures de suite passent', async ({
    client,
    assert,
  }) => {
    // ⚠️ Le pendant obligatoire du test ci-dessus : sans lui, une borne qui ne relâcherait
    // jamais refuserait tout après deux lectures et passerait quand même au vert.
    const { user, session } = await sessionOuverte()
    transcodeur.sondeJson = SONDE_HEVC

    for (let i = 0; i < MAX_TRANSCODAGES_SIMULTANES + 1; i += 1) {
      const response = await client
        .get('/coffre/nas/stream?root=root&path=films/iphone.mov')
        .loginAs(user)
        .withSession(session)

      response.assertStatus(200)
    }

    assert.lengthOf(transcodeur.lancements, MAX_TRANSCODAGES_SIMULTANES + 1)
  })

  test('un chemin hostile rend 404, sans dire pourquoi', async ({ client }) => {
    const { user, session } = await sessionOuverte()

    for (const chemin of ['../../etc/passwd', '/etc/passwd', 'films/absent.mp4']) {
      const response = await client
        .get(`/coffre/nas/stream?root=root&path=${encodeURIComponent(chemin)}`)
        .loginAs(user)
        .withSession(session)

      response.assertStatus(404)
    }
  })

  test('une racine inconnue rend 404', async ({ client }) => {
    const { user, session } = await sessionOuverte()

    const response = await client
      .get('/coffre/nas/stream?root=inconnue&path=films/compatible.mp4')
      .loginAs(user)
      .withSession(session)

    response.assertStatus(404)
  })

  test('⚠️ un DOSSIER portant une extension autorisée rend 404, jamais une 500', async ({
    client,
  }) => {
    // `realpath` réussit sur un dossier et l'allow-list d'extension le laisse passer : sans la
    // garde `isFile()`, la lecture échouerait APRÈS l'envoi des en-têtes.
    const { user, session } = await sessionOuverte()

    const response = await client
      .get('/coffre/nas/stream?root=root&path=films/album.mp4')
      .loginAs(user)
      .withSession(session)

    response.assertStatus(404)
  })

  test('une extension hors allow-list rend 404', async ({ client }) => {
    const { user, session } = await sessionOuverte()
    await writeFile(join(racine, 'films', 'notes.txt'), 'texte')

    const response = await client
      .get('/coffre/nas/stream?root=root&path=films/notes.txt')
      .loginAs(user)
      .withSession(session)

    response.assertStatus(404)
  })
})

test.group('Coffre / la lecture d’un élément du catalogue NAS', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  let dossier: string
  let racine: string
  let transcodeur: FauxTranscodeur

  group.each.setup(async () => {
    reinitialiserCreneaux()
    reinitialiserAccelerationDetectee()

    dossier = await mkdtemp(join(tmpdir(), 'cc-catalog-video-'))
    racine = join(dossier, 'root')
    await mkdir(racine, { recursive: true })
    await writeFile(join(racine, 'film.mp4'), CONTENU_VIDEO)

    transcodeur = new FauxTranscodeur()
    app.container.swap(NasRootsService, () => new NasRootsService([{ name: 'root', path: racine }]))
    app.container.swap(VideoTranscoder, () => transcodeur)

    return async () => {
      app.container.restore(NasRootsService)
      app.container.restore(VideoTranscoder)
      reinitialiserCreneaux()
      reinitialiserAccelerationDetectee()
      await rm(dossier, { recursive: true, force: true })
    }
  })

  test('un élément NAS du compte est lu, `Range` compris', async ({ client, assert }) => {
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const item = await CoffreCatalogItem.create({
      ownerId: user.id,
      source: 'nas',
      reference: 'root/film.mp4',
      nature: 'video',
      displayName: 'film.mp4',
      discoveredAt: DateTime.now(),
      lastSeenAt: DateTime.now(),
    })

    const response = await client
      .get(`/coffre/catalog/nas/${item.id}/stream`)
      .header('range', 'bytes=0-9')
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(206)
    assert.equal(response.body().toString(), CONTENU_VIDEO.slice(0, 10))
  })

  test('⚠️ un élément `immich_locked` rend 404 sur cette route', async ({ client }) => {
    // Sa lecture passe par `/coffre/immich/dossier/:assetId/video` — un tout autre mécanisme
    // d'authentification. Les mélanger brouillerait deux sécurités qui n'ont rien en commun.
    const user = await createUserWith(['coffre.view'])
    const vault = await createVault(user)
    const item = await CoffreCatalogItem.create({
      ownerId: user.id,
      source: 'immich_locked',
      reference: '11111111-2222-4333-8444-555555555555',
      nature: 'video',
      displayName: 'immich.mp4',
      discoveredAt: DateTime.now(),
      lastSeenAt: DateTime.now(),
    })

    const response = await client
      .get(`/coffre/catalog/nas/${item.id}/stream`)
      .loginAs(user)
      .withSession(await unlockedSession(user, vault))

    response.assertStatus(404)
  })

  test('⚠️ l’élément d’un AUTRE compte rend 404', async ({ client }) => {
    const proprietaire = await createUserWith(['coffre.view'])
    const item = await CoffreCatalogItem.create({
      ownerId: proprietaire.id,
      source: 'nas',
      reference: 'root/film.mp4',
      nature: 'video',
      displayName: 'film.mp4',
      discoveredAt: DateTime.now(),
      lastSeenAt: DateTime.now(),
    })

    const intrus = await createUserWith(['coffre.view'])
    const vaultIntrus = await createVault(intrus)

    const response = await client
      .get(`/coffre/catalog/nas/${item.id}/stream`)
      .loginAs(intrus)
      .withSession(await unlockedSession(intrus, vaultIntrus))

    response.assertStatus(404)
  })
})
