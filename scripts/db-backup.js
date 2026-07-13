import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync } from 'node:fs'
import { stat, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'

/*
| Sauvegarde de la base dans un fichier SQL, sur le disque de la machine.
|
| Le volume Docker `postgres_data` reste la source vivante — mais il vit DANS Docker :
| un `docker compose down -v` l'emporte. Ce dump, lui, est un fichier ordinaire de
| `backups/` : c'est la seule copie qui survit au volume.
|
| `spawn` reçoit un TABLEAU d'arguments, jamais une chaîne interpolée dans un shell
| (même règle que `SystemStatsService`).
*/

const { DB_USER = 'root', DB_DATABASE = 'app' } = process.env

const dossier = resolve(process.cwd(), 'backups')
// 2026-07-13T14:12 → 2026-07-13_14h12 (les « : » sont interdits dans un nom de fichier Windows).
const horodatage = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', 'h')
const fichier = resolve(dossier, `command-center-${horodatage}.sql`)

mkdirSync(dossier, { recursive: true })

const dump = spawn(
  'docker',
  [
    'compose',
    'exec',
    '-T',
    'postgres',
    'pg_dump',
    '-U',
    DB_USER,
    '-d',
    DB_DATABASE,
    // Le dump se restaure sur une base déjà peuplée : il supprime avant de recréer.
    '--clean',
    '--if-exists',
  ],
  { stdio: ['ignore', 'pipe', 'inherit'] }
)

dump.stdout.pipe(createWriteStream(fichier))

dump.on('error', (error) => {
  console.error(`Échec : ${error.message}\nDocker Desktop est-il démarré ?`)
  process.exitCode = 1
})

dump.on('close', async (code) => {
  if (code !== 0) {
    // Ne pas laisser derrière soi un fichier vide qui passerait pour une sauvegarde.
    await unlink(fichier).catch(() => {})
    console.error(`pg_dump a échoué (code ${code}). Le conteneur postgres tourne-t-il ?`)
    process.exitCode = code ?? 1
    return
  }

  const { size } = await stat(fichier)
  console.log(`Sauvegarde : ${fichier} (${Math.round(size / 1024)} Ko)`)
})
