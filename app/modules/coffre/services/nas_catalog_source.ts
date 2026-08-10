import { inject } from '@adonisjs/core'
import type {
  CatalogEnumeration,
  CatalogSource,
  CatalogThumbnail,
} from '#modules/coffre/services/catalog_source'
import NasRootsService from '#modules/coffre/services/nas_roots_service'
import { walkNasRoots } from '#modules/coffre/services/nas_directory_walker'
import { generateNasThumbnail } from '#modules/coffre/services/nas_thumbnail_generator'

/**
 * Le NAS comme source du catalogue (CC-226, lot 2 de l'épique CC-224).
 *
 * ⚠️ **Ne réimplémente RIEN du parcours** — délègue entièrement à `walkNasRoots`, qui porte tout
 * le hardening (confinement, symlinks, cycles, racine absente). Cette classe ne fait que
 * l'assembler avec les racines CONFIGURÉES (via `NasRootsService`, substituable en test) — même
 * rôle que `ImmichLockedCatalogSource` face à `ImmichSessionClient.lockedAssetsForCatalog()`.
 *
 * ⚠️ **N'attrape aucune erreur d'énumération** : une racine absente ou non configurée remonte
 * telle quelle, conformément au contrat `enumerate()` de `catalog_source.ts`.
 */
@inject()
export default class NasCatalogSource implements CatalogSource {
  readonly key = 'nas' as const

  constructor(private roots: NasRootsService) {}

  async enumerate(): Promise<CatalogEnumeration> {
    return walkNasRoots(this.roots.getRoots())
  }

  /**
   * Génère la vignette d'un élément du catalogue NAS (CC-228) — **photos seulement**, une vidéo ne
   * reçoit aucune image extraite (voir `nas_thumbnail_generator.ts`).
   *
   * ⚠️ **`reference` porte l'identifiant de sa racine depuis CC-233 (`<nom>/<chemin relatif>`) —
   * SÉPARÉ puis résolu contre CETTE racine nommée (`resolveInRoot`), jamais via `resolve()`.**
   * `resolve()` essaie les racines dans l'ordre sur un chemin relatif nu (comportement voulu pour
   * `coffre_entry_nas_file.path_cipher`, qui ne porte pas d'identité de racine) : le réutiliser
   * ici réintroduirait la collision que CC-233 a fermée pour le catalogue — un chemin relatif
   * identique sous deux racines distinctes rendrait la vignette de la MAUVAISE racine.
   */
  async thumbnailFor(reference: string): Promise<CatalogThumbnail> {
    const separatorIndex = reference.indexOf('/')
    if (separatorIndex === -1) {
      throw new Error(
        `Référence de catalogue NAS malformée (aucun identifiant de racine) : « ${reference} ».`
      )
    }

    const rootName = reference.slice(0, separatorIndex)
    const relativePath = reference.slice(separatorIndex + 1)

    const realPath = await this.roots.resolveInRoot(rootName, relativePath)
    if (realPath === null) {
      throw new Error(
        `La référence de catalogue NAS « ${reference} » ne résout sous aucune racine autorisée.`
      )
    }

    return generateNasThumbnail(realPath)
  }
}
