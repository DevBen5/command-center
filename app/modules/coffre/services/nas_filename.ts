/**
 * La validation d'un NOM DE FICHIER pour l'écriture NAS (CC-240) — le point dur du ticket.
 *
 * ⚠️ **`NasRootsService.resolve()`/`resolveInRoot()` valident un chemin qui EXISTE** : ils font
 * `realpath`, qui échoue sur un chemin inexistant. Écrire (envoyer, renommer) demande de composer
 * un nom de fichier qui n'existe PAS ENCORE — c'est du code neuf, et c'est exactement là que se
 * logent les traversées de répertoire. La règle tenue par ce fichier : un nom de fichier ne
 * contient JAMAIS de séparateur, JAMAIS `..`, JAMAIS d'octet nul, n'est JAMAIS vide, et n'est
 * JAMAIS un nom réservé Windows — validé avant d'approcher le système de fichiers.
 *
 * ⚠️ **Ce n'est PAS `NAS_PATH` de `validators/coffre.ts`.** Cette regex-là valide un chemin RELATIF
 * déjà existant (collé par l'utilisateur, résolu ensuite par `resolve()`) et exige une extension de
 * l'allow-list photo/vidéo. Un nom de fichier envoyé/renommé n'a aucune raison d'être une photo ou
 * une vidéo — c'est un gestionnaire de fichiers généraliste, pas un formulaire d'attache media.
 */

/**
 * Les noms réservés par Windows, quelle que soit la casse et quelle que soit l'extension
 * (`CON.txt` est aussi réservé que `CON`). Un serveur de dev tourne HORS conteneur sur ce dépôt
 * (voir le `CLAUDE.md` racine) : ce n'est pas une précaution théorique.
 */
const WINDOWS_RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
])

/** Longueur maximale usuelle d'un composant de chemin (ext4/NTFS) — un filet, pas une cible. */
const MAX_NAS_FILE_NAME_LENGTH = 255

export function isValidNasFileName(name: string): boolean {
  if (name.length === 0 || name.length > MAX_NAS_FILE_NAME_LENGTH) return false
  if (name.includes('/') || name.includes('\\')) return false
  if (name.includes('..')) return false
  if (name.includes('\0')) return false

  const base = name.split('.')[0]!.toUpperCase()
  if (WINDOWS_RESERVED_NAMES.has(base)) return false

  return true
}
