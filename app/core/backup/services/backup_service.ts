import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, statSync } from 'node:fs'
import { copyFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import logger from '@adonisjs/core/services/logger'
import env from '#start/env'
import { BACKUP_DIR, BACKUP_MIRROR_DIR } from '#config/backup'
import backupSettings from '#core/backup/services/backup_settings_service'
import {
  chiffrerDump,
  dumpsAPurger,
  estDumpChiffre,
  listerDumps,
  verifierDump,
  verifierDumpChiffre,
} from '../../../../scripts/lib/dumps.js'

/**
 * L'orchestration de `node ace db:backup` ET de l'écran d'administration (CC-140) — un seul
 * point d'écriture, pour que les deux appelants ne divergent jamais sur l'ordre des étapes.
 *
 * ⚠️ **L'ordre n'est pas décoratif** : dump → écriture close → vérification → CHIFFREMENT →
 * relecture du chiffré → suppression du clair → miroir → purge (CC-223). La purge est la seule
 * opération destructive, elle vient EN DERNIER — si la copie vers le miroir échoue, RIEN n'est
 * supprimé. Même doctrine que `scripts/db-backup.js`, dont ce service réutilise la logique de
 * vérification/chiffrement/purge (`scripts/lib/dumps.js`) sans la réécrire.
 *
 * ⚠️ **Le chiffrement est opt-in** (`BACKUP_ENCRYPTION_RECIPIENT`, clé publique age `age1...`,
 * lue depuis l'environnement — jamais la base ni un formulaire, même frontière de confiance que
 * `LLM_BASE_URL`/`IMMICH_BASE_URL`) : absente, le dump reste en clair, annoncé à chaque exécution.
 * Configurée mais invalide, la sauvegarde s'arrête plutôt que de mirrorer un clair qu'un
 * chiffrement était censé protéger — le dump local, lui, n'est jamais supprimé.
 *
 * ⚠️ **`pg_dump` est invoqué en connexion TCP directe** (`-h DB_HOST -p DB_PORT`), pas via
 * `docker compose exec` : ce service tourne DANS le conteneur applicatif, qui n'a pas accès au
 * démon Docker (voir `docker-compose.prod.yml`, aucun socket monté). `PGPASSWORD` part en
 * variable d'environnement du sous-processus, jamais en argument — un argument de ligne de
 * commande est visible par tout autre processus de la machine (`ps`).
 *
 * ⚠️ **Le runner est injectable** : la production spawn un vrai `pg_dump`, les tests unitaires
 * injectent un faux runner pour prouver l'ORDRE des étapes et l'invariant « miroir en échec ⇒
 * rien n'est purgé », sans dépendre d'un Postgres réel — même raisonnement que `LlmClient` côté
 * Leitner.
 */
export type DumpRunner = (destination: string) => Promise<number>

export interface BackupOptions {
  directory?: string
  mirrorDirectory?: string
  runner?: DumpRunner
  /** Clé publique age (`age1...`) — par défaut `BACKUP_ENCRYPTION_RECIPIENT`. Override de test. */
  recipient?: string
}

export interface BackupResult {
  ok: boolean
  file?: string
  sizeBytes?: number
  mirrored: boolean
  purged: number
  error?: string
}

function horodatage(): string {
  // 2026-07-13T14:12 → 2026-07-13_14h12, le même format que `scripts/db-backup.js` — c'est ce
  // que `MOTIF_DUMP` reconnaît, et donc ce que la purge accepte de voir.
  return new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', 'h')
}

/** Le runner de production : un vrai `pg_dump`, en TCP direct vers Postgres. */
async function pgDumpRunner(destination: string): Promise<number> {
  const dump = spawn(
    'pg_dump',
    [
      '-h',
      env.get('DB_HOST'),
      '-p',
      String(env.get('DB_PORT')),
      '-U',
      env.get('DB_USER'),
      '-d',
      env.get('DB_DATABASE'),
      '--clean',
      '--if-exists',
    ],
    {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, PGPASSWORD: env.get('DB_PASSWORD') ?? '' },
    }
  )

  const sortie = new Promise<number>((resoudre, rejeter) => {
    dump.on('error', (erreur) => {
      rejeter(new Error(`${erreur.message} — pg_dump est-il installé dans l'image ?`))
    })
    dump.on('close', (code) => resoudre(code ?? 1))
  })

  const [, code] = await Promise.all([
    pipeline(dump.stdout, createWriteStream(destination)),
    sortie,
  ])

  return code
}

export class BackupService {
  #directory: string
  #mirrorDirectory: string
  #runner: DumpRunner
  #recipient: string | undefined
  /**
   * ⚠️ Garde anti-chevauchement, en mémoire — même patron que `veille_scheduler`. Sans elle,
   * un déclenchement admin et le tick automatique retombant dans la même minute (résolution de
   * `horodatage()`) écriraient DEUX fois dans le MÊME fichier via deux `createWriteStream`
   * indépendants : pas « deux dumps quasi identiques », une écriture concurrente sur un seul
   * chemin — corruption. Elle vit sur l'instance : le contrôleur admin et le scheduler
   * partagent le même singleton exporté par défaut, donc la même garde.
   */
  #enCours = false

  constructor(options: BackupOptions = {}) {
    this.#directory = options.directory ?? BACKUP_DIR
    this.#mirrorDirectory = options.mirrorDirectory ?? BACKUP_MIRROR_DIR
    this.#runner = options.runner ?? pgDumpRunner
    // ⚠️ `|| undefined`, PAS `?? undefined` : une chaîne vide n'est pas nullish, donc `??` la
    // laisserait passer. `Env.schema.string.optional()` traduit bien `VAR=` en `undefined`, mais
    // PAS `VAR="   "`, qui arrive ici en `'   '` puis devient `''` au `trim()`. Ce `''` est falsy
    // — aucun chiffrement n'aurait lieu — tout en étant `!== undefined`, donc `status()` aurait
    // annoncé le chiffrement CONFIGURÉ sur l'écran d'administration pendant que les dumps
    // partent en clair. C'est la panne de `BACKUP_MIRROR_DIR` prise dans l'autre sens : croire
    // qu'on est protégé sans l'être est pire que de savoir qu'on ne l'est pas.
    const destinataire = (options.recipient ?? env.get('BACKUP_ENCRYPTION_RECIPIENT'))?.trim()
    this.#recipient = destinataire || undefined
  }

  /** Les dumps du dossier de sauvegarde, du plus ancien au plus récent, avec taille et âge. */
  async list(): Promise<Array<{ name: string; sizeBytes: number; mtimeMs: number }>> {
    return listerDumps(this.#directory).map((name) => {
      const { size, mtimeMs } = statSync(resolve(this.#directory, name))
      return { name, sizeBytes: size, mtimeMs }
    })
  }

  /** Le dossier de sauvegarde et le miroir existent-ils et sont-ils des dossiers ? */
  status(): { directoryReady: boolean; mirrorConfigured: boolean; encryptionConfigured: boolean } {
    return {
      directoryReady: existsSync(this.#directory) && statSync(this.#directory).isDirectory(),
      mirrorConfigured:
        existsSync(this.#mirrorDirectory) && statSync(this.#mirrorDirectory).isDirectory(),
      encryptionConfigured: this.#recipient !== undefined,
    }
  }

  async runBackup(): Promise<BackupResult> {
    if (this.#enCours) {
      return {
        ok: false,
        mirrored: false,
        purged: 0,
        error: 'Une sauvegarde est déjà en cours (automatique ou déclenchée juste avant).',
      }
    }

    this.#enCours = true
    try {
      return await this.#executerBackup()
    } finally {
      this.#enCours = false
    }
  }

  async #executerBackup(): Promise<BackupResult> {
    if (!existsSync(this.#directory) || !statSync(this.#directory).isDirectory()) {
      return {
        ok: false,
        mirrored: false,
        purged: 0,
        error:
          `Dossier de sauvegarde introuvable : ${this.#directory}\n` +
          "Le volume est-il monté ? Ce dossier n'est jamais créé automatiquement.",
      }
    }

    const fichier = resolve(this.#directory, `command-center-${horodatage()}.sql`)

    let code: number
    try {
      code = await this.#runner(fichier)
    } catch (erreur) {
      await unlink(fichier).catch(() => {})
      const message = erreur instanceof Error ? erreur.message : String(erreur)
      return { ok: false, mirrored: false, purged: 0, error: `Échec : ${message}` }
    }

    if (code !== 0) {
      await unlink(fichier).catch(() => {})
      return {
        ok: false,
        mirrored: false,
        purged: 0,
        error: `pg_dump a échoué (code ${code}).`,
      }
    }

    const { ok, raison } = verifierDump(fichier)
    if (!ok) {
      await unlink(fichier).catch(() => {})
      return {
        ok: false,
        mirrored: false,
        purged: 0,
        error: `Dump inutilisable, supprimé : ${raison}`,
      }
    }

    const { size } = await stat(fichier)

    let cheminAPropager = fichier
    if (this.#recipient) {
      try {
        cheminAPropager = await this.#chiffrerEtRemplacer(fichier, this.#recipient)
      } catch (erreur) {
        // Le clair reste une sauvegarde valide, jamais supprimé pour un chiffrement en
        // échec — mais on s'arrête là : hors de question de mirrorer ce clair alors qu'un
        // chiffrement était configuré pour le protéger.
        const message = erreur instanceof Error ? erreur.message : String(erreur)
        return {
          ok: false,
          file: fichier,
          sizeBytes: size,
          mirrored: false,
          purged: 0,
          error: `${message}\nLe dump local reste en clair, conservé : ${fichier}`,
        }
      }
    }

    const miroir = await this.#copierVersLeMiroir(cheminAPropager)
    if (miroir.error) {
      // Le dump local est bon : on le garde, et surtout on ne purge pas.
      return {
        ok: true,
        file: cheminAPropager,
        sizeBytes: size,
        mirrored: false,
        purged: 0,
        error: `${miroir.error}\nLe dump local est conservé, aucune purge effectuée.`,
      }
    }

    const purged = await this.#purger()

    return { ok: true, file: cheminAPropager, sizeBytes: size, mirrored: miroir.copied, purged }
  }

  /**
   * Chiffre `fichierClair` pour `clePublique`, relit le résultat, puis supprime le clair.
   * Ne rend le chemin du `.sql.age` QUE si toute la chaîne a réussi — sur n'importe quel
   * échec, le clair reste intact et RIEN n'est supprimé (CC-223, même doctrine que le miroir).
   */
  async #chiffrerEtRemplacer(fichierClair: string, clePublique: string): Promise<string> {
    let chiffre: Buffer
    try {
      chiffre = await chiffrerDump(fichierClair, clePublique)
    } catch (erreur) {
      const message = erreur instanceof Error ? erreur.message : String(erreur)
      throw new Error(`Chiffrement échoué : ${message}`)
    }

    const cheminChiffre = `${fichierClair}.age`
    await writeFile(cheminChiffre, chiffre)

    const { ok, raison } = verifierDumpChiffre(cheminChiffre)
    if (!ok) {
      await unlink(cheminChiffre).catch(() => {})
      throw new Error(`Dump chiffré illisible une fois écrit, supprimé : ${raison}`)
    }

    await unlink(fichierClair)
    return cheminChiffre
  }

  /**
   * ⚠️ Le dossier doit EXISTER — jamais créé. Un `mkdir` sur un support non monté fabriquerait
   * un dossier sur le disque local : on croirait avoir une copie hors-site sans en avoir une.
   *
   * ⚠️ `copied: false, error: null` (miroir non configuré) et `copied: true, error: null`
   * (copie réussie) sont deux issues distinctes — les confondre ferait annoncer un miroir
   * qui n'existe pas.
   */
  async #copierVersLeMiroir(fichier: string): Promise<{ copied: boolean; error: string | null }> {
    if (!existsSync(this.#mirrorDirectory) || !statSync(this.#mirrorDirectory).isDirectory()) {
      return { copied: false, error: null }
    }

    const cible = this.#mirrorDirectory
    if (resolve(cible) === resolve(this.#directory)) {
      return {
        copied: false,
        error: `Le miroir pointe sur ${cible} : ce ne serait pas une seconde copie.`,
      }
    }
    const partiel = resolve(cible, `${basename(fichier)}.part`)
    const final = resolve(cible, basename(fichier))

    try {
      await copyFile(fichier, partiel)

      const { size: attendu } = await stat(fichier)
      const { size: copie } = await stat(partiel)
      if (copie !== attendu) {
        await unlink(partiel).catch(() => {})
        return {
          copied: false,
          error: `Copie incomplète vers ${cible} (${copie} octets sur ${attendu}).`,
        }
      }

      await rename(partiel, final)
    } catch (erreur) {
      await unlink(partiel).catch(() => {})
      const message = erreur instanceof Error ? erreur.message : String(erreur)
      return { copied: false, error: `Copie vers ${cible} impossible : ${message}` }
    }

    // La relecture porte sur le fichier ARRIVÉ, pas sur celui qu'on a envoyé — comparer les
    // tailles ne prouve que la longueur, pas la lisibilité. La forme (clair ou chiffré) se
    // déduit du nom, même source de vérité que `scripts/db-backup.js` et la purge.
    const verifier = estDumpChiffre(basename(final)) ? verifierDumpChiffre : verifierDump
    const { ok, raison } = verifier(final)
    if (!ok) {
      await unlink(final).catch(() => {})
      return { copied: false, error: `Copie illisible une fois sur ${cible} — ${raison}` }
    }

    return { copied: true, error: null }
  }

  async #purger(): Promise<number> {
    const { keep } = await backupSettings.current()
    const aPurger = dumpsAPurger(listerDumps(this.#directory), keep)

    for (const nom of aPurger) {
      await unlink(resolve(this.#directory, nom)).catch((erreur) => {
        logger.error({ err: erreur }, `Sauvegarde : purge de ${nom} impossible.`)
      })
    }

    return aPurger.length
  }
}

export default new BackupService()
