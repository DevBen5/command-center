import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { copyFile, rename, stat, unlink } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'

import { dumpsAPurger, listerDumps, lireGarder, verifierDump } from './lib/dumps.js'

/*
| Sauvegarde de la base dans un fichier SQL, sur le disque de la machine — puis, si
| `BACKUP_MIRROR_DIR` est renseignée, une copie HORS de ce disque.
|
| La source vivante est `./pgdata`, un bind mount : Postgres écrit dans un dossier du
| dépôt, sur le disque de la machine. Un `docker compose down -v` ne l'emporte PAS —
| le `-v` ne supprime que les volumes gérés par Docker.
|
| Ce dump reste néanmoins le vrai filet, et les deux ne se remplacent pas : `pgdata`
| est le fichier VIVANT de Postgres, binaire, lié à la version majeure (PG 16). Une
| corruption, un `rm -rf` ou un changement de machine l'emporte, lui. Le dump est du
| SQL portable, horodaté, et il emporte tout : contenu, réglages, comptes.
|
| ⚠️ Mais les deux vivaient sur le MÊME disque (CC-69). Panne de disque, vol, chiffrement
| par rançongiciel : les deux partaient ensemble. D'où la troisième copie, sur un support
| que ce disque n'emporte pas.
|
| ⚠️ **L'ordre des étapes n'est pas décoratif** : dump → flush → vérification → miroir →
| purge. La purge est la seule opération destructive et elle vient EN DERNIER : si la
| copie vers le miroir échoue, rien n'est supprimé localement. Sans ça, un NAS débranché
| ferait disparaître des dumps que l'archive n'a jamais reçus.
|
| `spawn` reçoit un TABLEAU d'arguments, jamais une chaîne interpolée dans un shell
| (même règle que `SystemStatsService`).
*/

const { DB_USER = 'root', DB_DATABASE = 'app' } = process.env

const dossier = resolve(process.cwd(), 'backups')
// 2026-07-13T14:12 → 2026-07-13_14h12 (les « : » sont interdits dans un nom de fichier Windows).
const horodatage = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', 'h')
const fichier = resolve(dossier, `command-center-${horodatage}.sql`)

/** Arrête le script en nommant la cause. Rien n'a été purgé : c'est toujours la dernière étape. */
function echouer(message) {
  console.error(message)
  process.exitCode = 1
}

/** `pg_dump` vers le fichier local. Rend le code de sortie, l'écriture VRAIMENT terminée. */
async function dumper() {
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

  const sortie = new Promise((resoudre, rejeter) => {
    dump.on('error', (erreur) => {
      rejeter(new Error(`${erreur.message}\nDocker Desktop est-il démarré ?`))
    })
    dump.on('close', (code) => resoudre(code ?? 1))
  })

  // ⚠️ `pipeline` et non `.pipe()` : il attend la fermeture du fichier et propage les
  // erreurs d'écriture. Le `close` du process, lui, peut arriver avant que le dernier
  // bloc soit sur le disque — on vérifiait alors un fichier encore incomplet.
  const [, code] = await Promise.all([pipeline(dump.stdout, createWriteStream(fichier)), sortie])

  return code
}

/**
 * Copie le dump hors de ce disque, puis le relit DEPUIS le support.
 *
 * ⚠️ Le dossier doit EXISTER — il n'est jamais créé. Un `mkdir -p` sur un NAS non monté
 * fabriquerait un dossier sur le disque local : on croirait avoir une copie hors-site,
 * on aurait un doublon dans le même panier. C'est exactement la panne que CC-69 corrige,
 * et la créer en silence serait pire que de ne rien copier.
 */
async function copierVersLeMiroir(destination) {
  const cible = resolve(destination)

  if (cible === dossier) {
    return `BACKUP_MIRROR_DIR pointe sur ${dossier} : ce ne serait pas une seconde copie.`
  }
  if (!existsSync(cible) || !statSync(cible).isDirectory()) {
    return (
      `BACKUP_MIRROR_DIR introuvable : ${cible}\n` +
      "Le support est-il monté ? Ce dossier n'est jamais créé automatiquement — un dossier " +
      'fabriqué sur le disque local ressemblerait à une sauvegarde hors-site sans en être une.'
    )
  }

  // Nom temporaire puis renommage : une copie interrompue (NAS débranché) laisse un
  // `.part` visible, jamais un `.sql` tronqué qui passerait pour une sauvegarde.
  const partiel = resolve(cible, `${basename(fichier)}.part`)
  const final = resolve(cible, basename(fichier))

  try {
    await copyFile(fichier, partiel)

    const { size: attendu } = await stat(fichier)
    const { size: copie } = await stat(partiel)
    if (copie !== attendu) {
      await unlink(partiel).catch(() => {})
      return `Copie incomplète vers ${cible} (${copie} octets sur ${attendu}).`
    }

    await rename(partiel, final)
  } catch (erreur) {
    await unlink(partiel).catch(() => {})
    return `Copie vers ${cible} impossible : ${erreur.message}`
  }

  // ⚠️ La relecture porte sur le fichier ARRIVÉ, pas sur celui qu'on a envoyé. C'est la
  // copie qui compte — la seule qui survive à la perte de ce disque — et comparer les
  // tailles ne prouve que la longueur, jamais la lisibilité. Un support fatigué ou un
  // partage réseau capricieux ne se trahit qu'ici, en relisant depuis lui.
  const { ok, raison } = verifierDump(final)
  if (!ok) {
    // Illisible et pourtant nommé comme un dump : il passerait pour une sauvegarde sur
    // l'archive. Même traitement qu'en local — on l'efface. Le dump local, lui, est bon.
    await unlink(final).catch(() => {})
    return `Copie illisible une fois sur ${cible} — ${raison}`
  }

  return null
}

/**
 * Ne garde que les `BACKUP_KEEP` derniers dumps LOCAUX.
 *
 * ⚠️ Le miroir n'est jamais purgé : c'est l'archive, et elle grossit sans fin. Rien dans
 * ce script ne supprime quoi que ce soit hors de `backups/`.
 */
async function purger() {
  const garder = lireGarder(process.env.BACKUP_KEEP)
  const aPurger = dumpsAPurger(listerDumps(dossier), garder)

  for (const nom of aPurger) {
    await unlink(resolve(dossier, nom))
  }

  return { garder, supprimes: aPurger.length }
}

async function principal() {
  let code
  try {
    code = await dumper()
  } catch (erreur) {
    await unlink(fichier).catch(() => {})
    return echouer(`Échec : ${erreur.message}`)
  }

  if (code !== 0) {
    // Ne pas laisser derrière soi un fichier vide qui passerait pour une sauvegarde.
    await unlink(fichier).catch(() => {})
    return echouer(`pg_dump a échoué (code ${code}). Le conteneur postgres tourne-t-il ?`)
  }

  const { ok, raison } = verifierDump(fichier)
  if (!ok) {
    await unlink(fichier).catch(() => {})
    return echouer(`Dump inutilisable, supprimé : ${raison}`)
  }

  const { size } = await stat(fichier)
  console.log(`Sauvegarde : ${fichier} (${Math.round(size / 1024)} Ko, vérifiée)`)

  const destination = process.env.BACKUP_MIRROR_DIR?.trim()
  if (destination) {
    const probleme = await copierVersLeMiroir(destination)
    if (probleme) {
      // Le dump local est bon : on le garde, et surtout on ne purge pas.
      return echouer(`${probleme}\nLe dump local est conservé, aucune purge effectuée.`)
    }
    console.log(`Copie hors-disque : ${resolve(destination)}`)
  } else {
    console.log(
      'Aucune copie hors-disque (BACKUP_MIRROR_DIR non renseignée) : ce dump vit sur le ' +
        "même disque que la base qu'il sauvegarde."
    )
  }

  try {
    const { garder, supprimes } = await purger()
    if (supprimes > 0) {
      console.log(`Purge : ${supprimes} dump(s) local(aux) supprimé(s), ${garder} conservé(s).`)
    }
  } catch (erreur) {
    return echouer(`Purge annulée : ${erreur.message}`)
  }
}

await principal()
