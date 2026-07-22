import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import type { VeilleItemType } from '#modules/veille/models/veille_item'

/**
 * L'écriture d'items collectés — **le seul endroit** où la déduplication est tranchée.
 *
 * Extrait de `veille_collector_service` au lot 2 (CC-55), quand un second collecteur est apparu.
 * Ce n'est pas une abstraction de confort : deux listes de colonnes et deux `ON CONFLICT` auraient
 * divergé, et une divergence sur la dédup ne se voit pas — elle se lit six mois plus tard, dans une
 * liste pleine de doublons.
 */

/** Une ligne à écrire. Ce que chaque collecteur produit, quelle que soit sa provenance. */
export type NewItem = {
  type: VeilleItemType
  sourceId: number
  /** Sous index UNIQUE : c'est **elle** qui empêche le doublon, pas un `if` applicatif. */
  dedupKey: string
  url: string | null
  title: string
  content: string | null
  tags: string[]
  metadata: Record<string, unknown>
  publishedAt: DateTime | null
}

/**
 * Les colonnes écrites par une collecte. Littéral figé dans le code — **jamais** une entrée
 * utilisateur : c'est ce qui rend l'interpolation ci-dessous sûre. Les valeurs, elles, passent
 * toutes par des bindings.
 */
const INSERT_COLUMNS = [
  'type',
  'veille_source_id',
  'dedup_key',
  'url',
  'title',
  'content',
  'tags',
  'metadata',
  'reading_queue',
  'published_at',
  'created_at',
  'updated_at',
] as const

/**
 * Écrit les items neufs, et rend combien l'étaient réellement.
 *
 * Deux niveaux de déduplication, et les deux sont nécessaires :
 *
 * - le `Set` élimine les répétitions **à l'intérieur d'une même passe** (un flux qui liste deux
 *   fois la même entrée, une pagination qui rend un asset à cheval sur deux pages) ;
 * - `ON CONFLICT (dedup_key) DO NOTHING` tranche **contre la base**, y compris entre deux
 *   collectes concurrentes — un rafraîchissement manuel pendant un tick automatique. Un `if`
 *   applicatif ne les couvrirait pas : les deux lisent avant que l'une n'écrive.
 *
 * ⚠️ **Le compte vient du `RETURNING id`**, jamais de `rows.length` : les doublons ignorés n'y
 * sont pas. C'est ce qui fait qu'une seconde collecte annonce honnêtement « 0 ajouté ».
 */
export async function insertNewItems(items: NewItem[]): Promise<number> {
  const now = DateTime.now().toSQL()
  const seen = new Set<string>()
  const rows: unknown[][] = []

  for (const item of items) {
    if (seen.has(item.dedupKey)) continue
    seen.add(item.dedupKey)

    rows.push([
      item.type,
      item.sourceId,
      item.dedupKey,
      item.url,
      item.title,
      item.content,
      // `tags` est un `text[]` Postgres : le driver `pg` prend le tableau JS tel quel.
      item.tags,
      JSON.stringify(item.metadata),
      false,
      item.publishedAt?.toSQL() ?? null,
      now,
      now,
    ])
  }

  if (rows.length === 0) return 0

  const placeholders = rows.map(() => `(${INSERT_COLUMNS.map(() => '?').join(', ')})`).join(', ')

  const result = await db.rawQuery(
    `INSERT INTO veille_items (${INSERT_COLUMNS.join(', ')})
     VALUES ${placeholders}
     ON CONFLICT (dedup_key) DO NOTHING
     RETURNING id`,
    rows.flat()
  )

  return result.rows.length
}
