import { inject } from '@adonisjs/core'
import type {
  CatalogEnumeration,
  CatalogSource,
  CatalogSourceItem,
  CatalogThumbnail,
} from '#modules/coffre/services/catalog_source'
import ImmichSessionClient, {
  type ImmichLockedCatalogAsset,
} from '#modules/coffre/services/immich_session_client'

/**
 * ⚠️ **`capturedAt` traverse ici, et c'est le seul endroit du chemin Immich qui change (CC-244).**
 * `CatalogSourceItem.capturedAt` porte désormais un epoch, pour une raison qui appartient au
 * parcours NAS (une énumération tout-ou-rien de 126 023 éléments, où Luxon pesait 80 Mo sur 113) —
 * mais le contrat est PARTAGÉ, donc cette source le suit. C'est le prix de l'abstraction de
 * CC-225, assumé par le ticket, pas un dégât collatéral.
 *
 * ⚠️ **`ImmichLockedCatalogAsset` garde son `DateTime`, et `immich_session_client.ts` n'a pas
 * bougé d'une ligne** : c'est un fichier sensible (session partagée, élévation PIN, reprise sur
 * expiration) qu'on ne remanie pas pour une conversion qui tient sur une expression. Le pic
 * mémoire du chemin Immich ne s'en trouve pas aggravé : ce `map` copiait déjà la *référence* du
 * `DateTime`, il copie désormais un nombre, et les `DateTime` restent tenus par le tableau
 * `assets` exactement comme avant.
 */
function toCatalogItem(asset: ImmichLockedCatalogAsset): CatalogSourceItem {
  return {
    reference: asset.assetId,
    nature: asset.nature,
    displayName: asset.displayName,
    capturedAt: asset.capturedAt?.toMillis() ?? null,
    sizeBytes: asset.sizeBytes,
  }
}

/**
 * Le dossier verrouillé Immich comme source du catalogue (CC-225, lot 1 de l'épique CC-224).
 *
 * ⚠️ **Ne réimplémente RIEN de la session/auth/pagination** — délègue entièrement à
 * `ImmichSessionClient.lockedAssetsForCatalog()`, qui porte déjà tout le hardening (login,
 * élévation PIN, retry unique sur expiration, plafond dédié). Cette classe ne fait que traduire
 * son vocabulaire vers celui de l'abstraction (`CatalogSourceItem`) — c'est tout ce qu'une
 * implémentation de `CatalogSource` doit faire.
 *
 * ⚠️ **N'attrape aucune erreur d'énumération** : une panne Immich (session expirée, réseau,
 * réponse malformée) remonte telle quelle, conformément au contrat `enumerate()` de
 * `catalog_source.ts` — c'est `catalog_sync_service.ts` qui décide de n'écrire rien en base.
 */
@inject()
export default class ImmichLockedCatalogSource implements CatalogSource {
  readonly key = 'immich_locked' as const

  constructor(private client: ImmichSessionClient) {}

  async enumerate(): Promise<CatalogEnumeration> {
    const { assets, truncated } = await this.client.lockedAssetsForCatalog()

    return { items: assets.map(toCatalogItem), truncated }
  }

  async thumbnailFor(reference: string): Promise<CatalogThumbnail> {
    return this.client.thumbnail(reference)
  }
}
