import { inject } from '@adonisjs/core'
import type {
  CatalogEnumeration,
  CatalogSource,
  CatalogThumbnail,
} from '#modules/coffre/services/catalog_source'
import NasRootsService from '#modules/coffre/services/nas_roots_service'
import { walkNasRoots } from '#modules/coffre/services/nas_directory_walker'

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
   * ⚠️ **Non pris en charge dans ce lot, délibérément.** Il n'existe aucune génération de
   * vignette pour les médias NAS (voir le `CLAUDE.md` du module, « La liste n'affiche aucun
   * aperçu ») — et rien n'appelle encore cette méthode (aucune route dans ce lot). Lire le
   * fichier NAS entier en mémoire sans plafond établi, pour un usage qui n'existe pas encore,
   * serait un piège latent (un fichier NAS peut peser plusieurs Go). Le lot 3 décidera comment
   * prévisualiser un média NAS — probablement en réutilisant le proxy de streaming existant.
   */
  async thumbnailFor(reference: string): Promise<CatalogThumbnail> {
    throw new Error(
      `Les vignettes de fichiers NAS ne sont pas prises en charge par le catalogue (« ${reference} ») : ` +
        'aucune génération de vignette côté serveur pour cette source (voir CC-226).'
    )
  }
}
