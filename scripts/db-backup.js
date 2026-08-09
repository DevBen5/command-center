import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { copyFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'

import {
  chiffrerDump,
  dumpsAPurger,
  estDumpChiffre,
  listerDumps,
  lireGarder,
  verifierDump,
  verifierDumpChiffre,
} from './lib/dumps.js'

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
| ⚠️ **L'ordre des étapes n'est pas décoratif** : dump → flush → vérification → CHIFFREMENT
| → relecture du chiffré → suppression du clair → miroir → purge (CC-223). La purge est la
| seule opération destructive et elle vient EN DERNIER : si la copie vers le miroir échoue,
| rien n'est supprimé localement. Sans ça, un NAS débranché ferait disparaître des dumps que
| l'archive n'a jamais reçus.
|
| ⚠️ **Le chiffrement est opt-in** (`BACKUP_ENCRYPTION_RECIPIENT`, une clé publique age
| `age1...`) — même doctrine que `BACKUP_MIRROR_DIR` : absente, le dump reste en clair comme
| aujourd'hui, et le script l'annonce à chaque exécution. Configurée mais invalide (mauvais
| format, par exemple), le script s'arrête : il ne mirrorerait jamais un clair alors qu'un
| chiffrement était censé le protéger. Le clair n'est JAMAIS supprimé avant que le fichier
| `.sql.age` ait été relu et vérifié bon — la clé PRIVÉE, elle, ne vit jamais sur cette
| machine : ce script peut chiffrer sans jamais pouvoir relire ce qu'il vient d'écrire.
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
 * Copie `source` hors de ce disque, puis la relit DEPUIS le support.
 *
 * ⚠️ Le dossier doit EXISTER — il n'est jamais créé. Un `mkdir -p` sur un NAS non monté
 * fabriquerait un dossier sur le disque local : on croirait avoir une copie hors-site,
 * on aurait un doublon dans le même panier. C'est exactement la panne que CC-69 corrige,
 * et la créer en silence serait pire que de ne rien copier.
 *
 * ⚠️ `source` est le fichier final à propager — le `.sql` en clair si le chiffrement n'est
 * pas configuré, le `.sql.age` sinon (CC-223). La fonction de vérification se déduit du nom
 * (`estDumpChiffre`) plutôt que d'être passée par l'appelant : une seule source de vérité
 * sur « quelle forme mérite quelle vérification », partagée avec la purge et le restore.
 */
async function copierVersLeMiroir(destination, source) {
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
  // `.part` visible, jamais un fichier tronqué qui passerait pour une sauvegarde.
  const partiel = resolve(cible, `${basename(source)}.part`)
  const final = resolve(cible, basename(source))

  try {
    await copyFile(source, partiel)

    const { size: attendu } = await stat(source)
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
  const verifier = estDumpChiffre(basename(final)) ? verifierDumpChiffre : verifierDump
  const { ok, raison } = verifier(final)
  if (!ok) {
    // Illisible et pourtant nommé comme un dump : il passerait pour une sauvegarde sur
    // l'archive. Même traitement qu'en local — on l'efface. Le dump local, lui, est bon.
    await unlink(final).catch(() => {})
    return `Copie illisible une fois sur ${cible} — ${raison}`
  }

  return null
}

/**
 * Chiffre `fichierClair` pour `clePublique`, relit le résultat, puis supprime le clair.
 * Ne rend le chemin du `.sql.age` QUE si toute la chaîne a réussi — sur n'importe quel
 * échec, le clair reste intact et RIEN n'est supprimé (CC-223, même doctrine que le miroir).
 */
async function chiffrerEtRemplacer(fichierClair, clePublique) {
  let chiffre
  try {
    chiffre = await chiffrerDump(fichierClair, clePublique)
  } catch (erreur) {
    throw new Error(`Chiffrement échoué : ${erreur.message}`)
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

  let cheminAPropager = fichier
  const recipient = process.env.BACKUP_ENCRYPTION_RECIPIENT?.trim()
  if (recipient) {
    try {
      cheminAPropager = await chiffrerEtRemplacer(fichier, recipient)
      console.log(`Chiffré : ${cheminAPropager}`)
    } catch (erreur) {
      // Le clair reste une sauvegarde valide, jamais supprimé pour un chiffrement en
      // échec — mais on s'arrête là : hors de question de mirrorer ce clair alors qu'un
      // chiffrement était configuré pour le protéger.
      return echouer(`${erreur.message}\nLe dump local reste en clair, conservé : ${fichier}`)
    }
  } else {
    console.log(
      'Dump non chiffré (BACKUP_ENCRYPTION_RECIPIENT non renseignée) : il vit en clair, ' +
        'sur ce disque et sur le miroir le cas échéant.'
    )
  }

  const destination = process.env.BACKUP_MIRROR_DIR?.trim()
  if (destination) {
    const probleme = await copierVersLeMiroir(destination, cheminAPropager)
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
