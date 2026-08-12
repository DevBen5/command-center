import { test } from '@japa/runner'
import { EventEmitter } from 'node:events'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { setTimeout as attendre } from 'node:timers/promises'
import type { HttpContext } from '@adonisjs/core/http'
import { serveNasMedia } from '#modules/coffre/services/nas_media_response'
import VideoTranscoder, {
  reinitialiserAccelerationDetectee,
  type TranscodeSession,
} from '#modules/coffre/services/video_transcoder'
import {
  creneauxOccupes,
  libererCreneau,
  MAX_TRANSCODAGES_SIMULTANES,
  reinitialiserCreneaux,
  reserverCreneau,
} from '#modules/coffre/services/video_transcode_slots'

/**
 * Les deux gardes d'exécution de la lecture vidéo (CC-241) : **la borne de transcodages
 * simultanés** et **la mort du processus**.
 *
 * ⚠️ **`ffmpeg` est remplacé par un vrai processus bon marché, pas par un objet simulé** — c'est
 * tout l'intérêt du point de substitution `spawnFfmpeg`. Un faux objet prouverait qu'on appelle
 * `kill()` ; ici on prouve qu'un processus du système d'exploitation, réellement lancé, est
 * réellement mort ensuite. C'est la différence entre « le câblage est en place » et « la garde
 * fonctionne », et c'est la seule des deux qui compte le jour où un onglet se ferme.
 *
 * ⚠️ **Ce que ça ne prouve pas** : que `ffmpeg` lui-même se termine sur `SIGTERM`/`SIGKILL` avec
 * ces arguments-là. Le mécanisme de signal est celui du système, pas celui du binaire — mais le
 * `SIGKILL` de secours existe précisément parce qu'on ne fait pas confiance au binaire pour
 * répondre au premier.
 */

/** Une sonde qui annonce du HEVC — donc un fichier que le plan enverra au transcodage. */
const SONDE_HEVC = JSON.stringify({
  streams: [{ codec_type: 'video', codec_name: 'hevc' }],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
})

/** Un processus qui vit jusqu'à ce qu'on le tue — le rôle que tient `ffmpeg` en production. */
class TranscodeurAvecProcessusReel extends VideoTranscoder {
  lastArgs: string[] | null = null
  dernierPid: number | undefined = undefined

  protected runFfprobe(): Promise<string | null> {
    return Promise.resolve(SONDE_HEVC)
  }

  protected spawnFfmpeg(args: string[]): ChildProcessByStdio<null, Readable, Readable> {
    this.lastArgs = args
    // Écrit un octet puis ne se termine jamais de lui-même : exactement le profil d'un transcodage
    // en cours dont le client se déconnecte au milieu.
    const child = spawn(
      process.execPath,
      ['-e', 'process.stdout.write("x"); setInterval(() => {}, 1000)'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
    this.dernierPid = child.pid
    return child
  }
}

/** ⚠️ La borne reste sous le `timeout` de 2 s de la suite `unit` (`adonisrc.ts`). */
async function attendreLaMort(pid: number, limiteMs = 1500): Promise<boolean> {
  const fin = Date.now() + limiteMs
  while (Date.now() < fin) {
    try {
      // Le signal 0 ne tue rien : il teste seulement l'existence du processus.
      process.kill(pid, 0)
    } catch {
      return true
    }
    await attendre(25)
  }
  return false
}

test.group('Coffre / la borne de transcodages simultanés', (group) => {
  group.each.setup(() => {
    reinitialiserCreneaux()
    return () => reinitialiserCreneaux()
  })

  test('la borne refuse au-delà de son plafond, et le relâchement rouvre', ({ assert }) => {
    for (let i = 0; i < MAX_TRANSCODAGES_SIMULTANES; i += 1) {
      assert.isTrue(reserverCreneau(), `le créneau ${i + 1} doit être accordé`)
    }

    // ⚠️ Le dépassement REFUSE, il ne met pas en file : une file d'attente sur une requête HTTP de
    // vidéo se traduirait par un lecteur figé sans message — l'échec muet qu'on cherche à fermer.
    assert.isFalse(reserverCreneau())
    assert.equal(creneauxOccupes(), MAX_TRANSCODAGES_SIMULTANES)

    libererCreneau()
    assert.isTrue(reserverCreneau())
  })

  test('⚠️ un double relâchement ne rend PAS le compteur négatif', ({ assert }) => {
    /**
     * ⚠️ **Sans cette idempotence, la borne cesserait purement et simplement d'exister.** Le
     * créneau est rendu par deux chemins qui arrivent tous les deux, dans un ordre non garanti : la
     * terminaison du processus et la fermeture de la réponse HTTP. Un compteur descendu à -3 laisse
     * passer cinq transcodages avant de refuser le premier — un mécanisme qui paraît en place et
     * n'en est plus un.
     */
    reserverCreneau()
    libererCreneau()
    libererCreneau()
    libererCreneau()

    assert.equal(creneauxOccupes(), 0)

    for (let i = 0; i < MAX_TRANSCODAGES_SIMULTANES; i += 1) assert.isTrue(reserverCreneau())
    assert.isFalse(reserverCreneau())
  })
})

test.group('Coffre / le transcodage réellement lancé', (group) => {
  group.each.setup(() => {
    reinitialiserCreneaux()
    reinitialiserAccelerationDetectee()
    return () => {
      reinitialiserCreneaux()
      reinitialiserAccelerationDetectee()
    }
  })

  test('`start` rend `null` une fois la borne atteinte, sans lancer de processus', async ({
    assert,
  }) => {
    const transcodeur = new TranscodeurAvecProcessusReel()
    const sessions: (TranscodeSession | null)[] = []

    /**
     * ⚠️ **Le `finally` n'est pas de la politesse, il rend ce test SÛR EN ÉCHEC — mesuré.** Sans
     * lui, une assertion qui tombe saute les `kill()` : le processus de test survit, son `stdout`
     * reste ouvert, et Japa (`forceExit: false`) attend indéfiniment que la boucle d'événements se
     * vide. La suite n'échoue alors pas, elle **ne se termine jamais** — le pire mode d'échec
     * possible pour une garde, et c'est exactement ce qu'a produit la première mutation de la borne
     * avant cette correction.
     */
    try {
      for (let i = 0; i < MAX_TRANSCODAGES_SIMULTANES; i += 1) {
        const session = await transcodeur.start('/nas/a.mov', 'transcode')
        sessions.push(session)
        assert.isNotNull(session)
      }

      // Le dépassement : refus net, et l'appelant en fait un 503 plutôt qu'une attente.
      const auDela = await transcodeur.start('/nas/b.mov', 'transcode')
      sessions.push(auDela)
      assert.isNull(auDela)
    } finally {
      for (const session of sessions) session?.kill()
    }
  })

  test('⚠️ `kill()` tue RÉELLEMENT le processus et rend son créneau', async ({ assert }) => {
    const transcodeur = new TranscodeurAvecProcessusReel()

    const session = await transcodeur.start('/nas/a.mov', 'transcode')
    try {
      assert.isNotNull(session)
      assert.equal(creneauxOccupes(), 1)

      // Le processus vit : on attend son premier octet pour être sûr qu'il tourne vraiment.
      const premierOctet = await new Promise<string>((resolve) => {
        session!.stream.once('data', (chunk: Buffer) => resolve(chunk.toString()))
      })
      assert.equal(premierOctet, 'x')
    } catch (erreur) {
      session?.kill()
      throw erreur
    }

    session!.kill()

    // ⚠️ **La garde du ticket** : sans elle, fermer l'onglet laisse le transcodage tourner jusqu'au
    // dernier octet du fichier. Le créneau est rendu tout de suite ; la mort du processus suit.
    assert.equal(creneauxOccupes(), 0)
    assert.isNumber(session!.pid)
    assert.isTrue(await attendreLaMort(session!.pid!))
  })

  test('`kill()` est idempotent — deux appels ne libèrent qu’un créneau', async ({ assert }) => {
    const transcodeur = new TranscodeurAvecProcessusReel()

    const premiere = await transcodeur.start('/nas/a.mov', 'transcode')
    const seconde = await transcodeur.start('/nas/b.mov', 'transcode')

    try {
      assert.equal(creneauxOccupes(), 2)

      premiere!.kill()
      premiere!.kill()
      premiere!.kill()

      // Si le triple appel avait décompté trois fois, il ne resterait rien de la seconde session.
      assert.equal(creneauxOccupes(), 1)
      seconde!.kill()
      assert.equal(creneauxOccupes(), 0)
    } finally {
      premiere?.kill()
      seconde?.kill()
    }
  })

  test('les arguments réellement passés sont ceux du plan demandé', async ({ assert }) => {
    const transcodeur = new TranscodeurAvecProcessusReel()

    const session = await transcodeur.start('/nas/film.mkv', 'remux')

    try {
      assert.isNotNull(transcodeur.lastArgs)
      assert.include(transcodeur.lastArgs!.join(' '), '-c copy')
      assert.include(transcodeur.lastArgs!, '/nas/film.mkv')
    } finally {
      session?.kill()
    }
  })
})

/**
 * ⚠️ **Le CÂBLAGE de la mort du processus, distinct de la mort elle-même.** Le groupe ci-dessus
 * prouve que `kill()` tue ; celui-ci prouve que **quelque chose l'appelle** quand le client s'en
 * va. Les deux moitiés sont nécessaires : `kill()` parfait mais jamais appelé laisse exactement le
 * problème que le ticket décrit — fermer l'onglet et laisser ffmpeg transcoder jusqu'au bout.
 *
 * ⚠️ **Un contexte HTTP minimal plutôt qu'une vraie requête**, parce que couper une connexion en
 * cours de réponse depuis le client Japa n'est pas atteignable : il attend la réponse complète. Ce
 * qu'on veut établir est que `serveNasMedia` s'abonne à la fermeture de la réponse Node — et c'est
 * exactement l'événement qu'on émet ici.
 */
test.group('Coffre / la déconnexion du client tue le transcodage', (group) => {
  let dossier: string
  let fichier: string

  group.each.setup(async () => {
    reinitialiserCreneaux()
    reinitialiserAccelerationDetectee()
    dossier = await mkdtemp(join(tmpdir(), 'cc-video-close-'))
    fichier = join(dossier, 'iphone.mov')
    await writeFile(fichier, 'contenu')

    return async () => {
      reinitialiserCreneaux()
      reinitialiserAccelerationDetectee()
      await rm(dossier, { recursive: true, force: true })
    }
  })

  test('⚠️ la fermeture de la réponse HTTP tue le processus et rend le créneau', async ({
    assert,
  }) => {
    const transcodeur = new TranscodeurAvecProcessusReel()
    const reponseNode = new EventEmitter()

    const ctx = {
      request: { header: () => undefined },
      response: {
        header: () => {},
        status: () => {},
        send: () => {},
        stream: () => {},
        requestedRangeNotSatisfiable: () => {},
        response: reponseNode,
      },
    } as unknown as HttpContext

    const echec = await serveNasMedia(ctx, {
      realPath: fichier,
      transcoder: transcodeur,
      contexte: {},
    })

    /**
     * ⚠️ **Le `finally` est ce qui rend ce test sûr EN ÉCHEC, et il a été mesuré nécessaire.** En
     * mutant le câblage (retirer l'abonnement à `close` de `nas_media_response.ts`), ce test
     * échoue — mais plus rien ne tue le processus lancé, donc Japa (`forceExit: false`) attend
     * indéfiniment que la boucle d'événements se vide : la suite ne rougissait pas, elle **ne se
     * terminait jamais** (mesuré : 900 s de timeout). Un test dont l'échec est un blocage est pire
     * qu'un test absent — il masque son propre verdict.
     */
    try {
      // Le fichier est du HEVC selon la sonde : un transcodage a donc bien été lancé.
      assert.isNull(echec)
      assert.equal(creneauxOccupes(), 1)
      const pid = (transcodeur.dernierPid ?? 0) as number
      assert.isAbove(pid, 0)

      // Le client s'en va : c'est exactement l'événement qu'émet Node quand la connexion tombe.
      reponseNode.emit('close')

      assert.equal(creneauxOccupes(), 0)
      assert.isTrue(await attendreLaMort(pid))
    } finally {
      const pid = transcodeur.dernierPid
      if (pid !== undefined) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          /* déjà mort : c'est le cas nominal */
        }
      }
    }
  })
})
