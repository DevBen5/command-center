import { spawn } from 'node:child_process'
import { createReadStream, existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

/*
| Restauration d'un dump produit par `npm run db:backup`.
|
| Le dump est fait avec `--clean --if-exists` : il SUPPRIME les tables existantes
| avant de les recréer. Le contenu actuel de la base est donc remplacé, pas fusionné.
| C'est l'inverse de l'import JSON du module Leitner, qui n'ajoute que ce qui manque.
|
| Usage : npm run db:restore              → le dump le plus récent
|         npm run db:restore -- <fichier> → un dump précis
*/

const { DB_USER = 'root', DB_DATABASE = 'app' } = process.env

const dossier = resolve(process.cwd(), 'backups')

/** Le dump demandé, ou le plus récent (les noms sont horodatés, donc triables). */
function trouverDump() {
  const demande = process.argv[2]
  if (demande) return resolve(demande)

  if (!existsSync(dossier)) return null
  const dumps = readdirSync(dossier)
    .filter((nom) => nom.endsWith('.sql'))
    .sort()

  return dumps.length > 0 ? resolve(dossier, dumps.at(-1)) : null
}

const fichier = trouverDump()

if (!fichier || !existsSync(fichier)) {
  console.error(
    'Aucune sauvegarde à restaurer.\nUsage : npm run db:restore -- backups/<fichier>.sql'
  )
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

createReadStream(fichier).pipe(psql.stdin)

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
