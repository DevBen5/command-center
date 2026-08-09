import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

import {
  dechiffrerDump,
  estDumpChiffre,
  listerDumps,
  verifierDump,
  verifierDumpChiffre,
} from './lib/dumps.js'

/*
| Restauration d'un dump produit par `npm run db:backup`.
|
| Le dump est fait avec `--clean --if-exists` : il SUPPRIME les tables existantes
| avant de les recréer. Le contenu actuel de la base est donc remplacé, pas fusionné.
| C'est l'inverse de l'import JSON du module Leitner, qui n'ajoute que ce qui manque.
|
| ⚠️ C'est aussi pourquoi le dump est vérifié AVANT d'ouvrir le flux (CC-69) : sur un
| fichier tronqué, `--clean` supprimerait les tables, puis `ON_ERROR_STOP=1` arrêterait
| tout au milieu — la base à moitié détruite, et le dump incapable de la reconstruire.
|
| ⚠️ **Un dump chiffré (CC-223, `.sql.age`) est entièrement déchiffré EN MÉMOIRE avant
| que `psql` ne soit lancé** — jamais de clair posé sur le disque au moment de la
| restauration. Sans `BACKUP_DECRYPTION_KEY`, ou avec une clé qui ne correspond pas,
| le script refuse avant tout : aucune connexion à `psql`, donc aucune table touchée.
| Cette clé PRIVÉE n'est jamais un `.env` — elle se passe en ligne, à l'invocation :
|   BACKUP_DECRYPTION_KEY=AGE-SECRET-KEY-1... npm run db:restore
|
| Usage : npm run db:restore              → le dump local le plus récent (clair ou chiffré)
|         npm run db:restore -- <fichier> → un dump précis, y compris depuis le miroir
*/

const { DB_USER = 'root', DB_DATABASE = 'app' } = process.env

const dossier = resolve(process.cwd(), 'backups')

/** Le dump demandé, ou le plus récent (les noms sont horodatés, donc triables). */
function trouverDump() {
  const demande = process.argv[2]
  if (demande) return resolve(demande)

  // Le choix automatique ne retient que les noms produits par `db:backup` ; un fichier
  // renommé à la main reste restaurable en le nommant explicitement.
  const dumps = listerDumps(dossier)

  return dumps.length > 0 ? resolve(dossier, dumps.at(-1)) : null
}

const fichier = trouverDump()

if (!fichier || !existsSync(fichier)) {
  console.error(
    'Aucune sauvegarde à restaurer.\nUsage : npm run db:restore -- backups/<fichier>.sql'
  )
  process.exit(1)
}

const chiffre = estDumpChiffre(basename(fichier))
const { ok, raison } = chiffre ? verifierDumpChiffre(fichier) : verifierDump(fichier)
if (!ok) {
  console.error(
    `Restauration refusée — ${raison}\n${fichier}\n` +
      'Ce dump ne peut pas reconstruire la base, et le tenter la détruirait à moitié ' +
      '(--clean supprime avant de recréer).\n' +
      'Pour forcer malgré tout, en connaissance de cause :\n' +
      `  docker compose exec -T postgres psql -U ${DB_USER} -d ${DB_DATABASE} < <fichier>`
  )
  process.exit(1)
}

/**
 * Le contenu clair à restaurer — soit le fichier lu tel quel, soit le résultat d'un
 * déchiffrement en mémoire. Refuse et REND `null` sans avoir écrit quoi que ce soit si
 * la clé privée manque ou ne convient pas : c'est ce qui garantit qu'aucun `psql` n'est
 * jamais lancé sur un dump qu'on n'a pas pu authentifier.
 */
async function contenuARestaurer() {
  if (!chiffre) return readFile(fichier)

  const clePrivee = process.env.BACKUP_DECRYPTION_KEY?.trim()
  if (!clePrivee) {
    console.error(
      `Restauration refusée — BACKUP_DECRYPTION_KEY absente.\n${fichier}\n` +
        "Ce dump est chiffré, et la clé privée n'est jamais sur cette machine : passe-la " +
        'en ligne, à cette seule invocation :\n' +
        '  BACKUP_DECRYPTION_KEY=AGE-SECRET-KEY-1... npm run db:restore'
    )
    return null
  }

  try {
    return await dechiffrerDump(fichier, clePrivee)
  } catch (erreur) {
    console.error(`Restauration refusée — ${erreur.message}\n${fichier}`)
    return null
  }
}

const contenu = await contenuARestaurer()
if (!contenu) {
  process.exit(1)
}

console.log(`Restauration de ${fichier}\nLe contenu actuel de la base va être remplacé.`)

const psql = spawn(
  'docker',
  [
    'compose',
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    DB_USER,
    '-d',
    DB_DATABASE,
    // Sans ça, psql continue après une erreur et laisse une base à moitié restaurée.
    '-v',
    'ON_ERROR_STOP=1',
    '--quiet',
  ],
  { stdio: ['pipe', 'inherit', 'inherit'] }
)

psql.stdin.end(contenu)

psql.on('error', (error) => {
  console.error(`Échec : ${error.message}\nDocker Desktop est-il démarré ?`)
  process.exitCode = 1
})

psql.on('close', (code) => {
  if (code !== 0) {
    console.error(`La restauration a échoué (code ${code}). La base peut être incomplète.`)
    process.exitCode = code ?? 1
    return
  }
  console.log('Base restaurée.')
})
