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

function toCatalogItem(asset: ImmichLockedCatalogAsset): CatalogSourceItem {
  return {
    reference: asset.assetId,
    nature: asset.nature,
    displayName: asset.displayName,
    capturedAt: asset.capturedAt,
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
