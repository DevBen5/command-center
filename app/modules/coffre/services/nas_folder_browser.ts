import { readdir, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { DateTime } from 'luxon'
import NasRootsService, { isWithinRoot } from '#modules/coffre/services/nas_roots_service'
import { shouldSkipEntry } from '#modules/coffre/services/nas_directory_walker'
import { nasFileKindFor } from '#modules/coffre/services/nas_file_format'

/**
 * La navigation par dossier du coffre (CC-239) — le renversement de `nas_directory_walker.ts` :
 * celui-ci répond à « que contient TOUTE une racine ? » (indexation, récursif, pour le catalogue),
 * ce fichier répond à « que contient CE dossier, maintenant ? » (un seul niveau, lu à l'instant, sur
 * le disque — jamais `coffre_catalog_items`).
 *
 * ⚠️ **Décision explicite du propriétaire (CC-239)** : un fichier envoyé, déplacé ou renommé depuis
 * le coffre (lots suivants) doit apparaître immédiatement, sans attendre une resynchronisation. La
 * navigation est donc du `readdir` confiné, jamais une requête SQL.
 *
 * ⚠️ **Réutilise `NasRootsService.resolveInRoot`/`isWithinRoot`, n'en écrit pas une seconde.** La
 * garde de confinement (traversée, chemin absolu, lien symbolique sortant) est déjà fermée ailleurs
 * dans le module ; ce fichier ne fait qu'appliquer le même mécanisme à une question différente.
 */

export type NasBrowseEntryKind = 'dir' | 'photo' | 'video' | 'other'

export interface NasBrowseEntry {
  name: string
  /** Chemin relatif INTERNE à la racine, séparateurs `/` toujours — pour le prochain appel. */
  path: string
  kind: NasBrowseEntryKind
  /** `null` pour un dossier. */
  sizeBytes: number | null
  /** ISO, `null` pour un dossier. */
  capturedAt: string | null
}

export interface NasBrowseRoot {
  name: string
}

export type NasBrowseListing =
  | { level: 'roots'; roots: NasBrowseRoot[] }
  | { level: 'folder'; root: string; path: string; entries: NasBrowseEntry[] }

/** Les racines déclarées — jamais résolues : lister les racines n'a pas besoin de toucher le disque. */
export function browseNasRoots(nasRoots: NasRootsService): NasBrowseListing {
  return { level: 'roots', roots: nasRoots.getRoots().map((root) => ({ name: root.name })) }
}

function toChildPath(relativePath: string, name: string): string {
  return relativePath === '' ? name : `${relativePath}/${name}`
}

/**
 * Le contenu d'UN dossier, sous UNE racine nommée.
 *
 * ⚠️ **`null` uniforme sur toute forme anormale** — racine inconnue, chemin hostile, chemin qui
 * désigne un FICHIER plutôt qu'un dossier, dossier illisible (permission, disparu) — même doctrine
 * que `NasRootsService.resolve`/`resolveInRoot` : jamais une exception, l'appelant traduit en 404.
 *
 * ⚠️ **Un lien symbolique posé DANS le dossier et pointant DEHORS de la racine n'est jamais listé**
 * — même mécanisme que `nas_directory_walker.ts` (`isWithinRoot` sur le `realpath` de la cible),
 * pas seulement refusé si on tente d'y entrer : il ne doit même pas apparaître comme cliquable.
 */
export async function browseNasFolder(
  nasRoots: NasRootsService,
  rootName: string,
  relativePath: string
): Promise<NasBrowseListing | null> {
  const root = nasRoots.getRoots().find((candidate) => candidate.name === rootName)
  if (root === undefined) return null

  const realDir = await nasRoots.resolveInRoot(rootName, relativePath)
  if (realDir === null) return null

  const realRoot = await realpath(root.path).catch(() => null)
  if (realRoot === null) return null // racine démontée entre les deux résolutions ci-dessus

  let dirents
  try {
    dirents = await readdir(realDir, { withFileTypes: true })
  } catch {
    // Couvre à la fois « ce n'est pas un dossier » (ENOTDIR — `realDir` désigne un FICHIER) et
    // « dossier illisible » (permission, disparu en cours de route) : `readdir` échoue dans les
    // deux cas, un `stat` + `isDirectory()` préalable serait mort — vérifié par mutation, ce
    // `catch` seul suffit. Introuvable pour l'appelant, même doctrine que le reste du module :
    // jamais un oracle sur la cause exacte.
    return null
  }

  const entries: NasBrowseEntry[] = []

  for (const dirent of dirents) {
    if (shouldSkipEntry(dirent.name)) continue

    const childPath = toChildPath(relativePath, dirent.name)
    const absoluteChild = join(realDir, dirent.name)

    if (dirent.isSymbolicLink()) {
      const real = await realpath(absoluteChild).catch(() => null)
      if (real === null) continue // lien cassé : ignoré, pas une erreur
      if (!isWithinRoot(real, realRoot)) continue // sort de la racine : jamais listé

      const targetStats = await stat(real).catch(() => null)
      if (targetStats === null) continue

      if (targetStats.isDirectory()) {
        entries.push({
          name: dirent.name,
          path: childPath,
          kind: 'dir',
          sizeBytes: null,
          capturedAt: null,
        })
      } else if (targetStats.isFile()) {
        // ⚠️ Classé sur `real` (la cible), jamais sur le nom du lien — même doctrine que le
        // streaming existant et que `nas_directory_walker.ts`.
        entries.push({
          name: dirent.name,
          path: childPath,
          kind: nasFileKindFor(real) ?? 'other',
          sizeBytes: targetStats.size,
          capturedAt: DateTime.fromJSDate(targetStats.mtime).toISO(),
        })
      }
      continue
    }

    if (dirent.isDirectory()) {
      entries.push({
        name: dirent.name,
        path: childPath,
        kind: 'dir',
        sizeBytes: null,
        capturedAt: null,
      })
      continue
    }

    if (dirent.isFile()) {
      const stats = await stat(absoluteChild).catch(() => null)
      if (stats === null) continue // disparu entre le listing et la lecture : cas normal

      entries.push({
        name: dirent.name,
        path: childPath,
        kind: nasFileKindFor(dirent.name) ?? 'other',
        sizeBytes: stats.size,
        capturedAt: DateTime.fromJSDate(stats.mtime).toISO(),
      })
    }
    // autre type (socket, fifo, périphérique) : ignoré silencieusement.
  }

  // Dossiers d'abord, puis ordre alphabétique insensible à la casse — un navigateur de fichiers
  // classique, pas l'ordre `readdir` du système de fichiers.
  entries.sort((a, b) => {
    if (a.kind === 'dir' && b.kind !== 'dir') return -1
    if (a.kind !== 'dir' && b.kind === 'dir') return 1
    return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })
  })

  return { level: 'folder', root: rootName, path: relativePath, entries }
}
