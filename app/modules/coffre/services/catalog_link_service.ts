import { inject } from '@adonisjs/core'
import type { DateTime } from 'luxon'
import type User from '#core/auth/models/user'
import CoffreEntry, { type CoffreEntryType } from '#modules/coffre/models/coffre_entry'
import CoffreEntryMedia from '#modules/coffre/models/coffre_entry_media'
import CoffreEntryNasFile from '#modules/coffre/models/coffre_entry_nas_file'
import CoffreCatalogItem from '#modules/coffre/models/coffre_catalog_item'
import NasRootsService from '#modules/coffre/services/nas_roots_service'
import { decrypt } from '#modules/coffre/services/vault_crypto'

export interface LinkedEntryInfo {
  entryId: number
  type: CoffreEntryType
  title: string
}

export interface CatalogPresence {
  inCatalog: boolean
  missingSince: string | null
}

/**
 * Le lien catalogue ↔ entrée (CC-227, lot 3 de l'épique CC-224) — dans les DEUX sens, calculé À LA
 * VOLÉE, jamais écrit. `coffre_catalog_items.entry_id` reste `NULL` pour toujours dans ce lot :
 * décision de cadrage, pour ne pas toucher `catalog_sync_service.ts` (CC-225/226, déjà livré et
 * stable) ni ouvrir de nouveau chemin d'écriture pour un ticket qui ne demande que la consultation.
 *
 * ⚠️ **Les deux directions sont bornées par le nombre de PIÈCES JOINTES du compte, jamais par la
 * taille du catalogue.** Un catalogue porte potentiellement des milliers de lignes ; le nombre de
 * médias/fichiers NAS réellement attachés à une entrée reste, lui, de l'ordre de la dizaine à la
 * centaine sur un usage personnel. Charger tout le catalogue pour chaque page `/coffre` aurait été
 * le mode d'échec silencieux à éviter : une régression de performance qui grandit avec le
 * catalogue plutôt qu'avec le nombre d'entrées.
 *
 * ⚠️ **L'ambiguïté multi-racines NAS n'est PAS résolue ici, elle est héritée d'un choix déjà acté.**
 * `coffre_entry_nas_file.path_cipher` reste un chemin relatif NU, sans identité de racine (voir le
 * `CLAUDE.md` du module, « Collision de référence entre racines multiples » — CC-233 a corrigé le
 * catalogue, délibérément PAS `path_cipher`). Ce service essaie donc chaque racine déclarée comme
 * préfixe candidat, « premier essai qui compte » — même sémantique que `NasRootsService.resolve()`.
 * Correct à une seule racine déclarée (le cas courant, documenté ailleurs comme sans conséquence
 * pratique) ; best-effort à plusieurs.
 */
@inject()
export default class CatalogLinkService {
  constructor(private nasRoots: NasRootsService) {}

  /** Une clé candidate par racine déclarée — jamais une exception si aucune racine n'existe. */
  #nasCandidates(path: string): string[] {
    return this.nasRoots.getRoots().map((root) => `${root.name}/${path}`)
  }

  /**
   * Catalogue → entrée : une map `${source}:${reference complète}` → l'entrée qui la référence,
   * pour annoter chaque ligne d'une page de résultats (`CatalogQueryService`).
   *
   * ⚠️ **Une entrée illisible (déchiffrement raté) est exclue de la map, jamais fabriquée à moitié
   * vide** — même doctrine que le reste du module (« illisible ≠ absent » est pour l'écran qui
   * AFFICHE une entrée ; ici, une entrée qu'on ne sait pas nommer ne doit pas apparaître comme
   * « rattachée » sans titre lisible).
   */
  async linkedEntriesFor(user: User, key: Buffer): Promise<Map<string, LinkedEntryInfo>> {
    const [nasFiles, media] = await Promise.all([
      CoffreEntryNasFile.query()
        .select(['id', 'entry_id', 'path_cipher'])
        .where('owner_id', user.id),
      CoffreEntryMedia.query()
        .select(['id', 'entry_id', 'asset_id_cipher'])
        .where('owner_id', user.id),
    ])

    const entryIds = [
      ...new Set([...nasFiles.map((f) => f.entryId), ...media.map((m) => m.entryId)]),
    ]
    const map = new Map<string, LinkedEntryInfo>()
    if (entryIds.length === 0) return map

    const entries = await CoffreEntry.query()
      .select(['id', 'type', 'title_cipher'])
      .where('owner_id', user.id)
      .whereIn('id', entryIds)

    const infoById = new Map<number, LinkedEntryInfo>()
    for (const entry of entries) {
      const title = decrypt(entry.titleCipher, key)
      if (title === null) continue
      infoById.set(entry.id, { entryId: entry.id, type: entry.type, title })
    }

    for (const file of nasFiles) {
      const path = decrypt(file.pathCipher, key)
      const info = path === null ? undefined : infoById.get(file.entryId)
      if (path === null || info === undefined) continue
      for (const candidate of this.#nasCandidates(path)) {
        map.set(`nas:${candidate}`, info)
      }
    }

    for (const item of media) {
      const assetId = decrypt(item.assetIdCipher, key)
      const info = assetId === null ? undefined : infoById.get(item.entryId)
      if (assetId === null || info === undefined) continue
      map.set(`immich_locked:${assetId}`, info)
    }

    return map
  }

  /**
   * Entrée → catalogue : la présence (et l'absence) de chaque pièce jointe du compte, par `id` de
   * `coffre_entry_nas_file`/`coffre_entry_media` — pour annoter les chips déjà rendues par
   * `pages/section.vue`.
   *
   * ⚠️ **Une seule requête CIBLÉE par direction sur `coffre_catalog_items`** (`whereIn('reference',
   * candidats)`), jamais un chargement intégral du catalogue — les candidats viennent des pièces
   * jointes (petit nombre), pas du catalogue (potentiellement grand).
   */
  async catalogPresenceFor(
    user: User,
    key: Buffer
  ): Promise<{
    nasFiles: Map<number, CatalogPresence>
    media: Map<number, CatalogPresence>
  }> {
    const [nasFiles, media] = await Promise.all([
      CoffreEntryNasFile.query().select(['id', 'path_cipher']).where('owner_id', user.id),
      CoffreEntryMedia.query().select(['id', 'asset_id_cipher']).where('owner_id', user.id),
    ])

    const nasDecoded = nasFiles.map((file) => ({
      id: file.id,
      path: decrypt(file.pathCipher, key),
    }))
    const mediaDecoded = media.map((item) => ({
      id: item.id,
      assetId: decrypt(item.assetIdCipher, key),
    }))

    const nasCandidates = [
      ...new Set(
        nasDecoded.flatMap((file) => (file.path === null ? [] : this.#nasCandidates(file.path)))
      ),
    ]
    const assetIds = [
      ...new Set(mediaDecoded.flatMap((item) => (item.assetId === null ? [] : [item.assetId]))),
    ]

    const [nasRows, mediaRows] = await Promise.all([
      nasCandidates.length === 0
        ? Promise.resolve([])
        : CoffreCatalogItem.query()
            .where('owner_id', user.id)
            .where('source', 'nas')
            .whereIn('reference', nasCandidates)
            .select(['reference', 'missing_since']),
      assetIds.length === 0
        ? Promise.resolve([])
        : CoffreCatalogItem.query()
            .where('owner_id', user.id)
            .where('source', 'immich_locked')
            .whereIn('reference', assetIds)
            .select(['reference', 'missing_since']),
    ])

    const missingByNasRef = new Map<string, DateTime | null>(
      nasRows.map((row) => [row.reference, row.missingSince])
    )
    const missingByAssetId = new Map<string, DateTime | null>(
      mediaRows.map((row) => [row.reference, row.missingSince])
    )

    const nasFilesPresence = new Map<number, CatalogPresence>()
    for (const file of nasDecoded) {
      const candidates = file.path === null ? [] : this.#nasCandidates(file.path)
      const match = candidates.find((candidate) => missingByNasRef.has(candidate))
      nasFilesPresence.set(
        file.id,
        match === undefined
          ? { inCatalog: false, missingSince: null }
          : { inCatalog: true, missingSince: missingByNasRef.get(match)?.toISO() ?? null }
      )
    }

    const mediaPresence = new Map<number, CatalogPresence>()
    for (const item of mediaDecoded) {
      const found = item.assetId !== null && missingByAssetId.has(item.assetId)
      mediaPresence.set(
        item.id,
        found
          ? {
              inCatalog: true,
              missingSince: missingByAssetId.get(item.assetId as string)?.toISO() ?? null,
            }
          : { inCatalog: false, missingSince: null }
      )
    }

    return { nasFiles: nasFilesPresence, media: mediaPresence }
  }
}
