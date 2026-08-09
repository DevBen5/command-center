import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs'
import * as age from 'age-encryption'

/*
| Ce que sait un dump, sans le restaurer.
|
| Extrait de `db-backup.js` et `db-restore.js` pour une raison précise : la purge
| SUPPRIME des fichiers, et la vérification décide si un dump mérite le nom de
| sauvegarde. Ces deux décisions doivent être prouvables par un test, or les scripts
| eux-mêmes ne le sont pas — ils dépendent de Docker et d'un conteneur qui tourne.
|
| Ce module ne connaît ni Docker, ni Postgres, ni le réseau : il lit des fichiers et
| des noms de fichiers. C'est ce qui le rend testable (`tests/unit/db_dumps.spec.ts`).
|
| ⚠️ Le chiffrement (CC-223) tient dans ce module pour la même raison : `age-encryption`
| est une implémentation JS pure (aucun binaire externe), donc chiffrer/déchiffrer ne
| dépend pas plus de Docker que vérifier ou lister. `chiffrerDump`/`dechiffrerDump` ne
| touchent jamais le disque en ÉCRITURE — elles LISENT un fichier et rendent des octets ;
| c'est aux appelants (scripts, `BackupService`) d'écrire, dans le même ordre déjà en
| vigueur pour le miroir et la purge : jamais de suppression avant qu'un résultat en aval
| soit vérifié bon.
*/

/**
 * Le nom exact que produit `db-backup.js`. Sert de garde-fou à la purge : elle ne
 * supprime QUE ce motif, jamais un `.sql` étranger déposé dans le dossier.
 */
export const MOTIF_DUMP = /^command-center-\d{4}-\d{2}-\d{2}_\d{2}h\d{2}\.sql$/

/**
 * Le nom d'un dump chiffré par `chiffrerDump` — même horodatage, suffixe `.age` en plus.
 * Un dump d'avant CC-223 ne porte jamais ce motif : il reste `.sql`, en clair, restaurable
 * tel quel (aucun chiffrement rétroactif).
 */
export const MOTIF_DUMP_CHIFFRE = /^command-center-\d{4}-\d{2}-\d{2}_\d{2}h\d{2}\.sql\.age$/

/** Le fichier désigné par `nom` est-il chiffré ? Décide, côté restauration, s'il faut déchiffrer. */
export function estDumpChiffre(nom) {
  return MOTIF_DUMP_CHIFFRE.test(nom)
}

/** Nombre de dumps conservés dans `backups/` quand `BACKUP_KEEP` est absent. */
export const GARDER_PAR_DEFAUT = 10

const ENTETE = '-- PostgreSQL database dump'
const FIN = '-- PostgreSQL database dump complete'
const TABLE = '\nCREATE TABLE '
// Premiers octets de tout fichier produit par le format age v1 — indépendant du
// destinataire, donc vérifiable sans aucune clé.
const ENTETE_AGE = 'age-encryption.org/v1'

// La fenêtre de queue est large : `pg_dump` récent écrit un `\unrestrict <jeton>` APRÈS
// le marqueur de fin, donc celui-ci n'est pas la dernière ligne. Chercher « en dernière
// ligne » rejetterait les dix dumps déjà sur le disque.
const FENETRE = 8 * 1024
const BLOC = 64 * 1024
// Un motif cherché peut tomber à cheval sur deux blocs : on reporte la fin du précédent.
const CHEVAUCHEMENT = 64

/** Lit `longueur` octets à partir de `position`, sans charger le fichier entier. */
function lire(descripteur, position, longueur) {
  const tampon = Buffer.allocUnsafe(longueur)
  const lus = readSync(descripteur, tampon, 0, longueur, position)
  return tampon.toString('utf8', 0, lus)
}

/** Balaye le fichier bloc par bloc et s'arrête dès que `aiguille` est trouvée. */
function contient(descripteur, taille, aiguille) {
  let position = 0
  let reste = ''

  while (position < taille) {
    const texte = reste + lire(descripteur, position, BLOC)
    if (texte.includes(aiguille)) return true
    position += BLOC
    reste = texte.slice(-CHEVAUCHEMENT)
  }

  return false
}

/**
 * Le fichier ressemble-t-il à un dump complet ?
 *
 * ⚠️ **Ce n'est pas une restauration.** Cette vérification attrape la troncature — le
 * mode d'échec réel : disque plein, conteneur tué en plein dump, copie coupée vers le
 * NAS. Elle ne dira RIEN d'un dump syntaxiquement complet mais logiquement inutilisable.
 * La seule preuve qu'un dump se recharge reste de le recharger — voir
 * `docs/restauration-verifiee.md` (CC-153) pour la procédure et son dernier résultat.
 *
 * @returns `{ ok: true }`, ou `{ ok: false, raison }` qui nomme ce qui manque.
 */
export function verifierDump(chemin) {
  let taille
  try {
    taille = statSync(chemin).size
  } catch {
    return { ok: false, raison: 'fichier introuvable' }
  }

  if (taille === 0) {
    return { ok: false, raison: 'fichier vide (0 octet)' }
  }

  const descripteur = openSync(chemin, 'r')
  try {
    if (!lire(descripteur, 0, Math.min(FENETRE, taille)).includes(ENTETE)) {
      return { ok: false, raison: `en-tête « ${ENTETE} » absent — ce n'est pas un dump pg_dump` }
    }

    const debutQueue = Math.max(0, taille - FENETRE)
    if (!lire(descripteur, debutQueue, taille - debutQueue).includes(FIN)) {
      return { ok: false, raison: `marqueur « ${FIN} » absent — dump tronqué` }
    }

    if (!contient(descripteur, taille, TABLE)) {
      // Un dump sans une seule table n'est pas une sauvegarde : c'est le symptôme d'un
      // `DB_DATABASE` qui désigne une base vide. Il pèse quelques Ko et passerait sans
      // bruit pour une sauvegarde valide — précisément ce qu'on refuse ici.
      return { ok: false, raison: 'aucun CREATE TABLE — la base dumpée est vide (DB_DATABASE ?)' }
    }
  } finally {
    closeSync(descripteur)
  }

  return { ok: true }
}

/**
 * Le fichier chiffré ressemble-t-il à un dump age complet ?
 *
 * Volontairement plus frustre que `verifierDump` : sans la clé privée (qui n'est jamais
 * sur cette machine), impossible de vérifier le CONTENU.
 *
 * ⚠️ **Ce qu'elle attrape exactement : le fichier vide, et le fichier qui n'est pas un age.
 * PAS la troncature** — et c'est la différence de fond avec `verifierDump`, qu'il ne faut
 * pas croire équivalente. Le clair se vérifie par un marqueur de FIN, donc une coupure au
 * milieu se voit ; un fichier age n'a aucun marqueur de fin, et un fichier tronqué garde
 * son en-tête intact — il passe donc ici. La troncature d'une COPIE reste couverte, mais
 * par la comparaison de tailles qui précède le renommage, jamais par cette fonction. Le
 * reste (payload corrompu, coupé) n'est vu que par `dechiffrerDump`, au moment de la
 * restauration, `age` authentifiant le texte chiffré (CC-223).
 */
export function verifierDumpChiffre(chemin) {
  let taille
  try {
    taille = statSync(chemin).size
  } catch {
    return { ok: false, raison: 'fichier introuvable' }
  }

  if (taille === 0) {
    return { ok: false, raison: 'fichier vide (0 octet)' }
  }

  const descripteur = openSync(chemin, 'r')
  try {
    if (!lire(descripteur, 0, Math.min(FENETRE, taille)).includes(ENTETE_AGE)) {
      return {
        ok: false,
        raison: `en-tête « ${ENTETE_AGE} » absent — ce n'est pas un dump chiffré par age`,
      }
    }
  } finally {
    closeSync(descripteur)
  }

  return { ok: true }
}

/**
 * Chiffre le contenu de `cheminClair` pour `clePublique` (`age1...`) et rend les octets
 * chiffrés. N'ÉCRIT RIEN : c'est à l'appelant de poser le fichier `.sql.age`, et de ne
 * supprimer le clair qu'après avoir relu ce résultat avec `verifierDumpChiffre` — même
 * doctrine que le miroir, jamais de suppression avant qu'un résultat en aval soit vérifié
 * bon.
 *
 * ⚠️ `addRecipient` valide le FORMAT de la clé de façon SYNCHRONE et lève avant tout
 * chiffrement : une clé mal configurée ne consomme jamais un dump pour rien, et l'appelant
 * peut distinguer « clé invalide » de « chiffrement impossible pour une autre raison ».
 */
export async function chiffrerDump(cheminClair, clePublique) {
  const contenu = readFileSync(cheminClair)

  const chiffreur = new age.Encrypter()
  try {
    chiffreur.addRecipient(clePublique)
  } catch (erreur) {
    throw new Error(`BACKUP_ENCRYPTION_RECIPIENT invalide : ${erreur.message}`)
  }

  return Buffer.from(await chiffreur.encrypt(contenu))
}

/**
 * Déchiffre `cheminChiffre` avec `clePrivee` (`AGE-SECRET-KEY-1...`) et rend le clair.
 * N'ÉCRIT RIEN — c'est ce qui permet aux appelants de pipeliner le résultat directement
 * vers `psql` sans jamais poser le clair sur le disque au moment de la restauration.
 *
 * ⚠️ Lève dans tous les cas d'échec (clé malformée, clé qui ne correspond à aucun
 * destinataire du fichier, contenu corrompu) — jamais un résultat vide silencieux. C'est
 * ce qui permet à l'appelant de refuser AVANT d'ouvrir le moindre flux vers `psql`.
 */
export async function dechiffrerDump(cheminChiffre, clePrivee) {
  const contenu = readFileSync(cheminChiffre)

  const dechiffreur = new age.Decrypter()
  try {
    dechiffreur.addIdentity(clePrivee)
  } catch (erreur) {
    throw new Error(`Clé privée invalide : ${erreur.message}`)
  }

  try {
    return Buffer.from(await dechiffreur.decrypt(contenu, 'uint8array'))
  } catch (erreur) {
    throw new Error(`Déchiffrement impossible : ${erreur.message}`)
  }
}

/**
 * Les dumps d'un dossier, du plus ancien au plus récent — les deux formes confondues
 * (`.sql` en clair, `.sql.age` chiffré). Un dump d'avant CC-223 reste `.sql` pour
 * toujours : aucun chiffrement rétroactif, donc `db:restore` doit continuer à le voir.
 *
 * L'horodatage est en tête du nom et de largeur fixe, suffixe mis à part : le tri
 * lexicographique reste chronologique même en mélangeant les deux formes. Un dossier
 * absent rend une liste vide, pas une erreur.
 */
export function listerDumps(dossier) {
  let noms
  try {
    noms = readdirSync(dossier)
  } catch {
    return []
  }

  return noms.filter((nom) => MOTIF_DUMP.test(nom) || MOTIF_DUMP_CHIFFRE.test(nom)).sort()
}

/**
 * `BACKUP_KEEP` lu et validé.
 *
 * ⚠️ Une valeur illisible LÈVE, elle ne retombe pas sur le défaut ni sur 0 : `Number('')`
 * vaut 0, et 0 veut dire « ne garder aucun ». Un `.env` mal tapé effacerait la totalité
 * des sauvegardes en silence.
 */
export function lireGarder(valeur) {
  if (valeur === undefined) return GARDER_PAR_DEFAUT

  const brut = valeur.trim()
  if (brut === '') return GARDER_PAR_DEFAUT

  // Une suite de chiffres, et rien d'autre. `Number()` seul serait trop accommodant : il
  // accepte `1e3`, `0x10` et `+3` — des formes qu'on ne veut pas voir décider du nombre de
  // sauvegardes conservées, parce qu'on ne les relit pas comme leur auteur les a écrites.
  if (!/^\d+$/.test(brut)) {
    throw new TypeError(`BACKUP_KEEP doit être un entier ≥ 0 en chiffres (reçu : « ${valeur} »).`)
  }

  return Number(brut)
}

/**
 * Parmi `noms` (triés du plus ancien au plus récent), ceux à supprimer pour n'en garder
 * que `garder`. `garder === 0` désactive la purge — il ne la rend pas totale.
 */
export function dumpsAPurger(noms, garder) {
  if (!Number.isInteger(garder) || garder < 0) {
    throw new TypeError(`Nombre de dumps à garder invalide : ${garder}.`)
  }
  if (garder === 0) return []

  return noms.slice(0, Math.max(0, noms.length - garder))
}
