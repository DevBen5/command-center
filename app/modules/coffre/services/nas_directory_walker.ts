import { realpath, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { isWithinRoot } from '#modules/coffre/services/nas_roots_service'
import { nasFileKindFor } from '#modules/coffre/services/nas_file_format'
import type { CoffreNasRoot } from '#config/coffre_nas'
import type { CatalogEnumeration, CatalogSourceItem } from '#modules/coffre/services/catalog_source'

/**
 * Le parcours récursif des racines NAS (CC-226) — le renversement de `NasRootsService` : celui-ci
 * répond à « ce chemin est-il autorisé ? » (question fermée), ce fichier répond à « que contient
 * cette racine ? » (question ouverte). ⚠️ **Il ne devient jamais l'autorité de l'accès** :
 * `NasRootsService.resolve()` reste le seul juge au moment de servir un fichier, confinement
 * revérifié après `realpath`. Une ligne produite ici est un index, jamais un laissez-passer.
 */

/**
 * ⚠️ **Garde-fou anti-boucle-infinie, PAS une borne réaliste** — même doctrine que
 * `MAX_CATALOG_PAGES` côté Immich. Un NAS familial porte des dizaines de milliers de fichiers ;
 * cette valeur est plusieurs ordres de grandeur au-dessus, au cas où une structure de dossiers
 * pathologique (ou un bug de cette fonction) ferait dériver le parcours.
 */
export const MAX_NAS_WALK_ITEMS = 200_000

/**
 * ⚠️ **Dossiers spéciaux Synology, au-delà des quatre pièges du ticket — décision propre à ce
 * lot.** Synology (DSM) crée automatiquement `@eaDir` (cache de vignettes) dans CHAQUE dossier
 * d'un partage, et `#recycle`/`@tmp` à la racine des partages. Sans cette garde, le catalogue se
 * remplirait de milliers d'entrées internes non pertinentes (`@eaDir/SYNOPHOTO_THUMB_XL.jpg`),
 * à l'exact opposé de la promesse de l'épique (« le coffre contient déjà tout ce qui compte »).
 *
 * ⚠️ **Exportée depuis CC-239** : réutilisée telle quelle par `nas_folder_browser.ts` (navigation
 * par dossier, question « que contient CE dossier » — un seul niveau) pour ne pas dupliquer cette
 * liste sur un second filtre qui pourrait diverger.
 */
export const SKIPPED_ENTRY_NAMES = new Set(['@eaDir', '#recycle', '@tmp'])

/** Dotfiles/dotdirs (`.DS_Store`, `.@__thumb`…) et les dossiers spéciaux Synology ci-dessus. */
export function shouldSkipEntry(name: string): boolean {
  if (name.startsWith('.')) return true
  return SKIPPED_ENTRY_NAMES.has(name)
}

interface WalkState {
  items: CatalogSourceItem[]
  truncated: boolean
  maxItems: number
}

/**
 * `natureSourcePath` classe la nature (photo/vidéo/other) — c'est le fichier RÉEL pour un lien
 * symbolique (voir l'appelant), le chemin lui-même sinon. `relativePath` (jamais résolu, jamais
 * normalisé) porte le nom affiché ; la référence stockée porte EN PLUS l'identifiant de la racine
 * (CC-233) — sans lui, deux racines portant chacune un fichier de même chemin relatif produiraient
 * la même référence, et la seconde écraserait la première en base sans qu'aucune contrainte ne le
 * signale (voir `catalog_sync_service.ts`).
 *
 * ⚠️ **`mtime.getTime()`, jamais `stats.mtimeMs` (CC-244).** Les deux paraissent interchangeables :
 * ils ne le sont pas. `mtimeMs` porte des fractions de milliseconde que `Date` tronque — donc que
 * le `DateTime.fromJSDate(mtime)` d'avant ce lot n'a jamais vues. Le prendre décalerait les
 * valeurs écrites en base pour tout le catalogue existant, sans qu'aucun test ne le dise.
 */
function toCatalogItem(
  rootName: string,
  relativePath: string,
  natureSourcePath: string,
  mtime: Date,
  size: number
): CatalogSourceItem {
  const name = relativePath.split(/[\\/]/).pop() ?? relativePath

  return {
    reference: `${rootName}/${relativePath}`,
    nature: nasFileKindFor(natureSourcePath) ?? 'other',
    displayName: name,
    capturedAt: mtime.getTime(),
    sizeBytes: size,
  }
}

/**
 * Parcourt un dossier et ses sous-dossiers, en préservant `visited` (l'ensemble des chemins réels
 * DÉJÀ SUR LE CHEMIN DE RÉCURSION COURANT — ajouté en entrant dans un dossier, retiré en en
 * ressortant). ⚠️ **Un ensemble « sur le chemin », jamais global** : un ensemble global
 * interdirait à tort deux liens légitimes distincts pointant vers le même dossier physique (pas
 * un cycle, juste un alias) — voir le test « alias d'un dossier légitime, indexé deux fois ».
 *
 * ⚠️ **`visited` doit tracer AUSSI les dossiers ordinaires, pas seulement ceux rejoints par un
 * lien.** Un cycle peut se fermer par un seul lien pointant vers un ANCÊTRE atteint sans aucun
 * lien (`a/vers_a -> a`, où `a` est un dossier ordinaire) : sans cette trace, la vérification
 * `visited.has(cible du lien)` ne trouverait jamais l'ancêtre, et le parcours boucle
 * indéfiniment. Un dossier ordinaire ne peut jamais être son propre ancêtre par construction du
 * filesystem — le tracer ne produit donc aucun faux positif.
 *
 * ⚠️ **Une erreur `readdir` sur un sous-dossier n'est JAMAIS avalée** — contrairement à un fichier
 * disparu entre le listing et sa lecture, qui est un cas normal. Un dossier illisible signifie
 * qu'on ne sait pas ce qu'il contient : le traiter comme vide risquerait de faire marquer absent
 * tout ce qu'il porte réellement. L'erreur remonte donc jusqu'à faire échouer tout `enumerate()`
 * — cohérent avec le contrat tout-ou-rien de `catalog_source.ts`.
 */
async function walkDirectory(
  rootName: string,
  absoluteDir: string,
  relativeDir: string,
  realRoot: string,
  visited: Set<string>,
  state: WalkState
): Promise<void> {
  if (state.truncated) return

  const entries = await readdir(absoluteDir, { withFileTypes: true })

  for (const entry of entries) {
    if (state.truncated) return
    if (shouldSkipEntry(entry.name)) continue

    const absolutePath = join(absoluteDir, entry.name)
    const relativePath = relativeDir === '' ? entry.name : join(relativeDir, entry.name)

    if (entry.isSymbolicLink()) {
      const real = await realpath(absolutePath).catch(() => null)
      if (real === null) continue // lien cassé : ignoré, pas une erreur
      if (!isWithinRoot(real, realRoot)) continue // sort de la racine : jamais indexé

      const stats = await stat(real).catch(() => null)
      if (stats === null) continue

      if (stats.isDirectory()) {
        if (visited.has(real)) continue // cycle : ce dossier est déjà sur le chemin courant
        visited.add(real)
        await walkDirectory(rootName, real, relativePath, realRoot, visited, state)
        visited.delete(real)
      } else if (stats.isFile()) {
        // ⚠️ `real`, PAS `absolutePath` : la nature (photo/vidéo/other) doit se classer sur
        // l'extension du fichier RÉEL, pas sur celle du nom du lien — même doctrine que le
        // streaming existant (`coffre_nas_controller.ts` classe sur `realPath`, le résultat de
        // `resolve()`). Un lien nommé `alias.txt` pointant vers `photo.jpg` reste une photo ;
        // `relativePath` seul (le nom du lien) continue de porter le nom affiché.
        pushItem(state, rootName, relativePath, real, stats)
      }
      continue
    }

    if (entry.isDirectory()) {
      if (visited.has(absolutePath)) continue // ne peut arriver que via un lien déjà traité plus haut
      visited.add(absolutePath)
      await walkDirectory(rootName, absolutePath, relativePath, realRoot, visited, state)
      visited.delete(absolutePath)
      continue
    }

    if (entry.isFile()) {
      const stats = await stat(absolutePath).catch(() => null)
      if (stats === null) continue // disparu entre le listing et la lecture : cas normal

      pushItem(state, rootName, relativePath, absolutePath, stats)
    }
    // autre type (socket, fifo, périphérique) : ignoré silencieusement.
  }
}

function pushItem(
  state: WalkState,
  rootName: string,
  relativePath: string,
  natureSourcePath: string,
  stats: { mtime: Date; size: number }
): void {
  if (state.items.length >= state.maxItems) {
    state.truncated = true
    return
  }

  state.items.push(toCatalogItem(rootName, relativePath, natureSourcePath, stats.mtime, stats.size))
}

export interface NasWalkOptions {
  maxItems?: number
}

/**
 * Parcourt toutes les racines configurées. ⚠️ **Tout-ou-rien, comme le contrat d'`enumerate()` de
 * `catalog_source.ts` l'exige** : aucune racine configurée, ou une seule racine non montée parmi
 * plusieurs, fait LEVER — jamais un résultat partiel qui ferait conclure à tort que son contenu a
 * disparu.
 */
export async function walkNasRoots(
  roots: readonly CoffreNasRoot[],
  options: NasWalkOptions = {}
): Promise<CatalogEnumeration> {
  if (roots.length === 0) {
    throw new Error(
      'Aucune racine NAS configurée (COFFRE_NAS_ROOTS) : la source « nas » du catalogue ' +
        "n'est pas utilisable."
    )
  }

  const state: WalkState = {
    items: [],
    truncated: false,
    maxItems: options.maxItems ?? MAX_NAS_WALK_ITEMS,
  }

  for (const root of roots) {
    const realRoot = await realpath(root.path).catch(() => null)
    if (realRoot === null) {
      throw new Error(
        `La racine NAS « ${root.name} » (${root.path}) n'a pas pu être résolue (non montée, ou ` +
          "chemin invalide) : l'énumération du catalogue s'arrête pour ne marquer aucun élément " +
          'absent à tort.'
      )
    }

    await walkDirectory(root.name, realRoot, '', realRoot, new Set([realRoot]), state)
  }

  return { items: state.items, truncated: state.truncated }
}
