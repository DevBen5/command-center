import { copyFile, link, realpath, stat, unlink } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import NasRootsService, { isWithinRoot } from '#modules/coffre/services/nas_roots_service'
import { isValidNasFileName } from '#modules/coffre/services/nas_filename'

/**
 * L'écriture sur le NAS depuis le coffre (CC-240) — le lot dangereux de l'épique CC-224, pris
 * après la navigation par dossier (CC-239) qui donne à « déplacer » un endroit où déplacer.
 *
 * ⚠️ **Le point dur : `NasRootsService.resolve()`/`resolveInRoot()` valident un chemin qui
 * EXISTE** (`realpath`, qui échoue sinon). Écrire — la destination d'un envoi, la cible d'un
 * renommage — porte un nom de fichier qui n'existe PAS ENCORE. La règle tenue partout ici :
 *
 * 1. le DOSSIER PARENT (qui, lui, existe) se résout par `resolveInRoot`, la garde déjà éprouvée ;
 * 2. le nom de fichier est une entrée utilisateur, validé par `isValidNasFileName` AVANT
 *    d'approcher le disque — jamais résolu, jamais suivi de symlink ;
 * 3. `join(dossierRéel, nom)` ne peut PAS sortir du dossier : `nom` est garanti sans séparateur,
 *    donc `join` ne peut construire qu'un chemin sous `dossierRéel` — c'est une propriété de
 *    `path.join`, pas une hypothèse ;
 * 4. après écriture, une RE-VÉRIFICATION (`realpath` + `isWithinRoot`) confirme que le fichier
 *    créé est bien sous la racine — défense en profondeur contre un dossier remplacé par un lien
 *    symbolique ENTRE la résolution du parent et l'écriture (TOCTOU), même doctrine que le miroir
 *    de sauvegarde qui relit depuis le support plutôt que de croire ce qu'il a envoyé.
 *
 * ⚠️ **Une seule primitive atomique-et-exclusive, réutilisée trois fois : `link()` puis
 * `unlink()`, jamais `rename()` nu.** `fs.link()` échoue `EEXIST` si la cible existe déjà — il ne
 * l'écrase JAMAIS, contrairement à `rename()`. C'est ce qui tient à la fois « un envoi vers un nom
 * déjà pris ne clobber rien » ET « un envoi interrompu ne laisse pas de fichier partiel visible
 * sous le nom final » (le contenu est copié sous un nom TEMPORAIRE, `link()` ne rend le nom final
 * visible qu'une fois la copie entièrement terminée).
 */

export type NasWriteResult =
  | { status: 'ok' }
  | { status: 'bad-name' }
  | { status: 'name-taken' }
  | { status: 'not-found' }
  | { status: 'cross-root' }

function isEnoentOrEexist(error: unknown, code: 'ENOENT' | 'EEXIST'): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code
}

/**
 * Le dossier réel d'une racine nommée, confirmé comme un VRAI dossier (pas un fichier). `null`
 * uniforme sur toute anomalie — même doctrine que `NasRootsService` : jamais une exception.
 */
async function resolveExistingFolder(
  nasRoots: NasRootsService,
  rootName: string,
  folderPath: string
): Promise<string | null> {
  const realFolder = await nasRoots.resolveInRoot(rootName, folderPath)
  if (realFolder === null) return null

  const stats = await stat(realFolder).catch(() => null)
  if (stats === null || !stats.isDirectory()) return null

  return realFolder
}

/**
 * Re-vérifie qu'un chemin fraîchement écrit tombe bien sous la racine — la défense en profondeur
 * du point 4 ci-dessus. Supprime le fichier et rend `false` si ce n'est pas le cas.
 */
async function confirmWithinRootOrCleanUp(writtenPath: string, realRoot: string): Promise<boolean> {
  const real = await realpath(writtenPath).catch(() => null)
  if (real !== null && isWithinRoot(real, realRoot)) return true

  await unlink(writtenPath).catch(() => {})
  return false
}

/**
 * Crée `destFileName` dans `destFolderReal` en pointant sur le même contenu que `sourceReal` —
 * atomique, exclusif (jamais d'écrasement). `sourceReal` est supprimé une fois la nouvelle entrée
 * en place ; un échec de cette DERNIÈRE suppression est journalisé mais ne fait pas échouer
 * l'opération, la nouvelle entrée étant déjà correcte — même doctrine que le reste du module :
 * en cas de doute, une copie résiduelle est un moindre mal qu'une perte.
 */
async function relocate(
  sourceReal: string,
  destFolderReal: string,
  destFileName: string,
  realRoot: string
): Promise<NasWriteResult> {
  if (!isValidNasFileName(destFileName)) return { status: 'bad-name' }

  const destPath = join(destFolderReal, destFileName)

  try {
    await link(sourceReal, destPath)
  } catch (error) {
    if (isEnoentOrEexist(error, 'EEXIST')) return { status: 'name-taken' }
    throw error
  }

  const confined = await confirmWithinRootOrCleanUp(destPath, realRoot)
  if (!confined) return { status: 'not-found' }

  await unlink(sourceReal).catch(() => {})

  return { status: 'ok' }
}

/**
 * Envoie un fichier depuis un chemin temporaire déjà sur disque (le `tmpPath` d'un
 * `MultipartFile`, déjà écrit par le bodyparser) vers un dossier du NAS.
 *
 * ⚠️ **Écrit sous un nom temporaire (`.uploading-<hex>-<nom>`) dans le dossier de destination,
 * PUIS `link()` vers le nom final.** Si `copyFile` échoue en cours de route (source disparue,
 * disque plein…), le nom final n'existe jamais ; le temporaire est nettoyé dans le `catch`.
 */
export async function uploadNasFile(
  nasRoots: NasRootsService,
  rootName: string,
  folderPath: string,
  fileName: string,
  sourceTmpPath: string
): Promise<NasWriteResult> {
  if (!isValidNasFileName(fileName)) return { status: 'bad-name' }

  const root = nasRoots.getRoots().find((candidate) => candidate.name === rootName)
  if (root === undefined) return { status: 'not-found' }

  const destFolderReal = await resolveExistingFolder(nasRoots, rootName, folderPath)
  if (destFolderReal === null) return { status: 'not-found' }

  const realRoot = await realpath(root.path).catch(() => null)
  if (realRoot === null) return { status: 'not-found' } // racine démontée entre les deux résolutions

  const tempName = `.uploading-${randomBytes(8).toString('hex')}-${fileName}`
  const tempPath = join(destFolderReal, tempName)

  try {
    await copyFile(sourceTmpPath, tempPath)
  } catch {
    await unlink(tempPath).catch(() => {})
    return { status: 'not-found' }
  }

  const finalPath = join(destFolderReal, fileName)
  try {
    await link(tempPath, finalPath)
  } catch (error) {
    await unlink(tempPath).catch(() => {})
    if (isEnoentOrEexist(error, 'EEXIST')) return { status: 'name-taken' }
    throw error
  }
  await unlink(tempPath).catch(() => {})

  const confined = await confirmWithinRootOrCleanUp(finalPath, realRoot)
  if (!confined) return { status: 'not-found' }

  return { status: 'ok' }
}

/** Renomme un fichier DANS le même dossier — jamais un dossier, jamais entre racines. */
export async function renameNasFile(
  nasRoots: NasRootsService,
  rootName: string,
  relativePath: string,
  newName: string
): Promise<NasWriteResult> {
  const sourceReal = await nasRoots.resolveInRoot(rootName, relativePath)
  if (sourceReal === null) return { status: 'not-found' }

  const sourceStats = await stat(sourceReal).catch(() => null)
  if (sourceStats === null || !sourceStats.isFile()) return { status: 'not-found' }

  const root = nasRoots.getRoots().find((candidate) => candidate.name === rootName)
  if (root === undefined) return { status: 'not-found' }
  const realRoot = await realpath(root.path).catch(() => null)
  if (realRoot === null) return { status: 'not-found' }

  return relocate(sourceReal, dirname(sourceReal), newName, realRoot)
}

/**
 * Déplace un fichier d'un dossier à un autre, à L'INTÉRIEUR DE LA MÊME RACINE — un déplacement
 * entre racines est REFUSÉ (`cross-root`), jamais simulé par copie-puis-suppression (une copie
 * interrompue laisserait deux fichiers, ou zéro).
 *
 * ⚠️ **Conserve le nom d'origine** (`basename(relativePath)`) — ce n'est pas un renommage, voir
 * `renameNasFile` pour ça.
 */
export async function moveNasFile(
  nasRoots: NasRootsService,
  rootName: string,
  relativePath: string,
  targetRootName: string,
  targetFolderPath: string
): Promise<NasWriteResult> {
  if (rootName !== targetRootName) return { status: 'cross-root' }

  const sourceReal = await nasRoots.resolveInRoot(rootName, relativePath)
  if (sourceReal === null) return { status: 'not-found' }

  const sourceStats = await stat(sourceReal).catch(() => null)
  if (sourceStats === null || !sourceStats.isFile()) return { status: 'not-found' }

  const destFolderReal = await resolveExistingFolder(nasRoots, targetRootName, targetFolderPath)
  if (destFolderReal === null) return { status: 'not-found' }

  const root = nasRoots.getRoots().find((candidate) => candidate.name === rootName)
  if (root === undefined) return { status: 'not-found' }
  const realRoot = await realpath(root.path).catch(() => null)
  if (realRoot === null) return { status: 'not-found' }

  const fileName = relativePath.split('/').pop() ?? ''
  if (fileName === '') return { status: 'not-found' }

  return relocate(sourceReal, destFolderReal, fileName, realRoot)
}

/** Supprime un fichier — réel, définitif, sans corbeille. Jamais un dossier. */
export async function deleteNasFile(
  nasRoots: NasRootsService,
  rootName: string,
  relativePath: string
): Promise<NasWriteResult> {
  const realPath = await nasRoots.resolveInRoot(rootName, relativePath)
  if (realPath === null) return { status: 'not-found' }

  const stats = await stat(realPath).catch(() => null)
  if (stats === null || !stats.isFile()) return { status: 'not-found' }

  await unlink(realPath)

  return { status: 'ok' }
}
