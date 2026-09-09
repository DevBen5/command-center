import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { StrictValues } from '@adonisjs/lucid/types/querybuilder'
import CoffreCatalogItem from '#modules/coffre/models/coffre_catalog_item'
import type { CatalogEnumeration, CatalogSourceKey } from '#modules/coffre/services/catalog_source'

/**
 * L'UNIQUE point de conversion de `CatalogSourceItem.capturedAt` (CC-244) — les sources portent un
 * epoch, la base porte un `DateTime`, et la traduction n'a lieu qu'ici, au moment de l'écriture.
 *
 * ⚠️ **`=== null`, jamais `item.capturedAt ? … : null`.** `0` est un epoch parfaitement légitime
 * (1ᵉʳ janvier 1970) et il est *falsy* : un `mtime` cassé à l'epoch 0 — ce qu'un NAS produit sans
 * prévenir — deviendrait `captured_at NULL` en base, sans erreur et sans test rouge. Le type
 * précédent (`DateTime | null`) ne pouvait pas produire ce mode d'échec, un objet étant toujours
 * *truthy* ; celui-ci, si. C'est la seule ligne de ce lot qui casse en silence.
 */
function capturedAtFor(epochMs: number | null): DateTime | null {
  return epochMs === null ? null : DateTime.fromMillis(epochMs)
}

const MAX_POSTGRES_PARAMETERS = 65_535
const UPSERT_PARAMETERS_PER_ROW = 10
const UPSERT_BATCH_SIZE = Math.floor(MAX_POSTGRES_PARAMETERS / UPSERT_PARAMETERS_PER_ROW)

export interface CatalogSyncOutcome {
  discovered: number
  updated: number
  markedAbsent: number
  truncated: boolean
}

/**
 * Le diff transactionnel du catalogue (CC-225) — découvre le neuf, met à jour ce qui a changé,
 * marque absent ce qui a disparu. Reçoit une `CatalogEnumeration` déjà obtenue par l'appelant :
 * ce service ne sait pas parler à une source, il ne fait qu'appliquer son résultat en base — voir
 * `commands/coffre_sync_catalog.ts` pour l'orchestration (une énumération par source, appliquée à
 * chaque compte).
 */
class CatalogSyncService {
  /**
   * ⚠️ **Une transaction PAR APPEL (donc par compte), jamais une seule englobant tous les
   * comptes.** Un compte doit ressortir entièrement à jour ou entièrement inchangé — jamais à
   * moitié, avec certaines lignes marquées absentes et d'autres non. Mais un échec sur UN compte
   * (ex. contrainte unique violée par une synchro concurrente) ne doit pas défaire ce qui a déjà
   * été committé pour un autre.
   */
  async applyEnumeration(
    ownerId: number,
    sourceKey: CatalogSourceKey,
    enumeration: CatalogEnumeration
  ): Promise<CatalogSyncOutcome> {
    const now = DateTime.now()

    return db.transaction(async (trx) => {
      let discovered = 0
      let updated = 0
      const seenReferences: string[] = []
      const knownReferences = new Set<string>()
      const nowSql = now.toSQL()

      for (let offset = 0; offset < enumeration.items.length; offset += UPSERT_BATCH_SIZE) {
        const batch = enumeration.items.slice(offset, offset + UPSERT_BATCH_SIZE)
        const existing = await trx.rawQuery(
          `select reference
           from coffre_catalog_items
           where owner_id = ?
             and source = ?
             and reference = any(?::text[])`,
          [ownerId, sourceKey, batch.map((item) => item.reference)]
        )

        for (const row of existing.rows as Array<{ reference: string }>) {
          knownReferences.add(row.reference)
        }

        const rowsByReference = new Map<string, (typeof batch)[number]>()
        for (const item of batch) {
          seenReferences.push(item.reference)

          if (knownReferences.has(item.reference)) {
            updated++
          } else {
            discovered++
            knownReferences.add(item.reference)
          }

          // Une référence répétée garde la dernière métadonnée, comme la boucle historique.
          rowsByReference.set(item.reference, item)
        }

        if (rowsByReference.size === 0) continue

        const rows = [...rowsByReference.values()].map((item) => [
          ownerId,
          sourceKey,
          item.reference,
          item.nature,
          item.displayName,
          capturedAtFor(item.capturedAt)?.toSQL() ?? null,
          item.sizeBytes,
          nowSql,
          nowSql,
          null,
        ])
        const placeholders = rows
          .map(() => `(${Array.from({ length: UPSERT_PARAMETERS_PER_ROW }, () => '?').join(', ')})`)
          .join(', ')

        // Lucid omet null de StrictValues alors que PostgreSQL l’accepte pour les colonnes nullable.
        const bindings = rows.flat() as unknown as StrictValues[]
        await trx.rawQuery(
          `insert into coffre_catalog_items (
             owner_id, source, reference, nature, display_name, captured_at, size_bytes,
             discovered_at, last_seen_at, missing_since
           )
           values ${placeholders}
           on conflict (owner_id, source, reference) do update set
             nature = excluded.nature,
             display_name = excluded.display_name,
             captured_at = excluded.captured_at,
             size_bytes = excluded.size_bytes,
             last_seen_at = excluded.last_seen_at,
             missing_since = null`,
          bindings
        )
      }

      const markedAbsent = await this.#markAbsent(
        trx,
        ownerId,
        sourceKey,
        seenReferences,
        enumeration.truncated,
        now
      )

      return { discovered, updated, markedAbsent, truncated: enumeration.truncated }
    })
  }

  /**
   * ⚠️ **Ne marque RIEN si l'énumération est tronquée** — voir `catalog_source.ts` : ce que le
   * plafond de pages n'a pas atteint ne doit pas être pris pour disparu. C'est distinct d'une
   * énumération qui LÈVE : celle-là n'atteint même pas cette méthode, l'appelant ne reçoit jamais
   * de `CatalogEnumeration` à appliquer.
   *
   * ⚠️ **Sélectionne d'abord les identifiants à marquer, puis met à jour par lot** — plutôt que de
   * se fier au décompte de lignes rendu par `.update()` (dont la forme exacte dépend du driver) :
   * le nombre rendu est celui des identifiants effectivement sélectionnés, sans ambiguïté.
   *
   * ⚠️ **`<> all(?::text[])`/`= any(?::int[])`, jamais `whereNotIn`/`whereIn` (CC-243).** Chacun
   * de ces deux passe UNE liaison SQL par élément de son tableau ; le protocole étendu de
   * PostgreSQL plafonne le nombre de paramètres d'une requête à 65 535 (compteur 16 bits). Au-delà,
   * le compteur DÉBORDE en silence — le driver ne lève pas « trop de paramètres », il envoie un
   * nombre tronqué et Postgres répond par un message de bind absurde, sans rapport avec la cause
   * réelle. Un tableau lié comme UN SEUL paramètre (casté) n'a pas cette limite : `reference` est
   * `NOT NULL`, donc `<> ALL` est ici équivalent à `NOT IN` sans le piège du `NULL`.
   */
  async #markAbsent(
    trx: TransactionClientContract,
    ownerId: number,
    sourceKey: CatalogSourceKey,
    seenReferences: string[],
    truncated: boolean,
    now: DateTime
  ): Promise<number> {
    if (truncated) return 0

    const query = CoffreCatalogItem.query({ client: trx })
      .select(['id'])
      .where('owner_id', ownerId)
      .where('source', sourceKey)
      .whereNull('missing_since')

    if (seenReferences.length > 0) {
      query.whereRaw('reference <> all(?::text[])', [seenReferences])
    }

    const toMark = await query
    if (toMark.length === 0) return 0

    await CoffreCatalogItem.query({ client: trx })
      .whereRaw('id = any(?::int[])', [toMark.map((row) => row.id)])
      .update({ missing_since: now })

    return toMark.length
  }
}

export default new CatalogSyncService()
