import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import env from '#start/env'
import { BACKUP_DIR } from '#config/backup'
import {
  dechiffrerDump,
  estDumpChiffre,
  listerDumps,
  verifierDump,
  verifierDumpChiffre,
} from '../scripts/lib/dumps.js'

/**
 * `node ace db:restore` (CC-140) — le pendant de `db:backup`, dans le conteneur applicatif.
 *
 * ⚠️ **Jamais une route.** Comme `auth:reset-account` : un geste destructif (`--clean` supprime
 * avant de recréer) n'est pas un bouton d'écran. Seule une commande exige l'accès que le réseau
 * ne donne pas.
 *
 * ⚠️ Le dump est vérifié AVANT d'ouvrir le flux vers `psql` (même doctrine que
 * `scripts/db-restore.js`) : sur un fichier tronqué, `--clean` supprimerait les tables puis
 * `ON_ERROR_STOP=1` s'arrêterait au milieu — base à moitié détruite, dump incapable de la
 * reconstruire. Un dump qui échoue à cette vérification est refusé et JAMAIS supprimé : il est
 * peut-être le seul qui reste.
 *
 * ⚠️ **Un dump chiffré (CC-223, `.sql.age`) est déchiffré EN MÉMOIRE avant tout `psql`** —
 * jamais de clair posé sur le disque du conteneur au moment de la restauration. La clé privée
 * (`BACKUP_DECRYPTION_KEY`, `AGE-SECRET-KEY-1...`) se lit dans `process.env` DIRECTEMENT, pas
 * via `env` (`#start/env`) : elle n'a, à dessein, aucune entrée dans le schéma — jamais un
 * statut de config persistable, même doctrine que le rejet d'`ADMIN_PASSWORD`. Elle se passe en
 * ligne, à l'invocation :
 *   docker compose exec -e BACKUP_DECRYPTION_KEY=AGE-SECRET-KEY-1... app node ace db:restore
 */
export default class DbRestore extends BaseCommand {
  static commandName = 'db:restore'
  static description = 'Restaure un dump — le plus récent du dossier de sauvegarde par défaut.'

  static options: CommandOptions = { startApp: true }

  @flags.string({ description: 'Chemin explicite vers un dump, au lieu du plus récent.' })
  declare file?: string

  async run() {
    const fichier = this.#trouverDump()

    if (!fichier || !existsSync(fichier)) {
      this.logger.error(
        `Aucune sauvegarde à restaurer dans ${BACKUP_DIR}.\n` +
          'Précise un fichier avec --file=<chemin>.'
      )
      this.exitCode = 1
      return
    }

    const chiffre = estDumpChiffre(basename(fichier))
    const { ok, raison } = chiffre ? verifierDumpChiffre(fichier) : verifierDump(fichier)
    if (!ok) {
      this.logger.error(
        `Restauration refusée — ${raison}\n${fichier}\n` +
          'Ce dump ne peut pas reconstruire la base, et le tenter la détruirait à moitié.'
      )
      this.exitCode = 1
      return
    }

    const contenu = await this.#contenuARestaurer(fichier, chiffre)
    if (!contenu) {
      this.exitCode = 1
      return
    }

    const confirme = await this.prompt.confirm(
      `Restaurer ${fichier} ? Le contenu actuel de la base sera remplacé.`
    )
    if (!confirme) {
      this.logger.info('Rien n’a été modifié.')
      return
    }

    const code = await this.#restaurer(contenu)
    if (code !== 0) {
      this.logger.error(`La restauration a échoué (code ${code}). La base peut être incomplète.`)
      this.exitCode = code
      return
    }

    this.logger.success('Base restaurée.')
  }

  #trouverDump(): string | null {
    if (this.file) return resolve(this.file)

    const dumps = listerDumps(BACKUP_DIR)
    return dumps.length > 0 ? resolve(BACKUP_DIR, dumps.at(-1)!) : null
  }

  /**
   * Le contenu clair à restaurer, en mémoire — soit le fichier lu tel quel, soit le résultat
   * d'un déchiffrement. Rend `null` sans avoir rien écrit si la clé privée manque ou ne
   * convient pas : c'est ce qui garantit qu'aucun `psql` n'est jamais lancé sur un dump qu'on
   * n'a pas pu authentifier (CC-223).
   */
  async #contenuARestaurer(fichier: string, chiffre: boolean): Promise<Buffer | null> {
    if (!chiffre) return readFile(fichier)

    const clePrivee = process.env.BACKUP_DECRYPTION_KEY?.trim()
    if (!clePrivee) {
      this.logger.error(
        `Restauration refusée — BACKUP_DECRYPTION_KEY absente.\n${fichier}\n` +
          "Ce dump est chiffré, et la clé privée n'est jamais sur cette machine : passe-la " +
          'en ligne, à cette seule invocation :\n' +
          '  docker compose exec -e BACKUP_DECRYPTION_KEY=AGE-SECRET-KEY-1... app node ace db:restore'
      )
      return null
    }

    try {
      return await dechiffrerDump(fichier, clePrivee)
    } catch (erreur) {
      const message = erreur instanceof Error ? erreur.message : String(erreur)
      this.logger.error(`Restauration refusée — ${message}\n${fichier}`)
      return null
    }
  }

  async #restaurer(contenu: Buffer): Promise<number> {
    const psql = spawn(
      'psql',
      [
        '-h',
        env.get('DB_HOST'),
        '-p',
        String(env.get('DB_PORT')),
        '-U',
        env.get('DB_USER'),
        '-d',
        env.get('DB_DATABASE'),
        '-v',
        'ON_ERROR_STOP=1',
        '--quiet',
      ],
      {
        stdio: ['pipe', 'inherit', 'inherit'],
        env: { ...process.env, PGPASSWORD: env.get('DB_PASSWORD') ?? '' },
      }
    )

    psql.stdin.end(contenu)

    return new Promise((resoudre, rejeter) => {
      psql.on('error', (erreur) => rejeter(erreur))
      psql.on('close', (code) => resoudre(code ?? 1))
    })
  }
}
