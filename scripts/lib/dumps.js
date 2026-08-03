import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs'

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
*/

/**
 * Le nom exact que produit `db-backup.js`. Sert de garde-fou à la purge : elle ne
 * supprime QUE ce motif, jamais un `.sql` étranger déposé dans le dossier.
 */
export const MOTIF_DUMP = /^command-center-\d{4}-\d{2}-\d{2}_\d{2}h\d{2}\.sql$/

/** Nombre de dumps conservés dans `backups/` quand `BACKUP_KEEP` est absent. */
export const GARDER_PAR_DEFAUT = 10

const ENTETE = '-- PostgreSQL database dump'
const FIN = '-- PostgreSQL database dump complete'
const TABLE = '\nCREATE TABLE '

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
 * Les dumps d'un dossier, du plus ancien au plus récent.
 *
 * L'horodatage est en tête du nom et de largeur fixe : le tri lexicographique est donc
 * chronologique. Un dossier absent rend une liste vide, pas une erreur.
 */
export function listerDumps(dossier) {
  let noms
  try {
    noms = readdirSync(dossier)
  } catch {
    return []
  }

  return noms.filter((nom) => MOTIF_DUMP.test(nom)).sort()
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
