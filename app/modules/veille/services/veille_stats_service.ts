import db from '@adonisjs/lucid/services/db'

export type VeilleStats = {
  total: number
  articles: number
  queue: number
  unread: number
  tags: number
}

/**
 * La bande d'indicateurs et la liste des tags, **calculées en SQL**.
 *
 * Avant CC-54, `index()` faisait un `VeilleItem.all()` — toute la table hydratée en modèles Lucid
 * pour produire quatre entiers, en plus de la requête filtrée. C'était assumé à volumétrie de
 * saisie manuelle ; ça ne l'est plus dès que des flux remplissent la table tout seuls
 * (CC-22 tranché : on corrige).
 *
 * Les tags viennent de la base et non des items affichés : dérivés côté page, ils s'effondraient
 * au tag sélectionné dès le premier clic — impossible d'en choisir un second sans repasser par
 * « Tout », et le compteur global affiché juste à côté disait autre chose.
 */
export default class VeilleStatsService {
  async fetchStats(): Promise<VeilleStats> {
    const result = await db.rawQuery(`
      SELECT
        count(*)                                        AS total,
        count(*) FILTER (WHERE type = 'article')         AS articles,
        count(*) FILTER (WHERE reading_queue)            AS queue,
        count(*) FILTER (WHERE read_at IS NULL)          AS unread,
        count(DISTINCT tag)                              AS tags
      FROM veille_items
      LEFT JOIN LATERAL unnest(tags) AS tag ON true
      -- ⚠️ CC-63 : un item supprimé sort des compteurs comme il sort de la liste. Sans ce filtre,
      -- la bande d'indicateurs annoncerait des éléments que l'écran ne montre nulle part — et
      -- rien, à part le désaccord entre deux nombres, ne dirait pourquoi.
      WHERE deleted_at IS NULL
    `)

    const row = result.rows[0] ?? {}

    // ⚠️ Postgres rend les `count()` en `bigint`, que le driver `pg` remonte en **chaîne** pour
    // ne pas perdre de précision. Sans ce `Number`, la page afficherait `"7"` et les additions
    // deviendraient des concaténations.
    return {
      total: Number(row.total ?? 0),
      articles: Number(row.articles ?? 0),
      queue: Number(row.queue ?? 0),
      unread: Number(row.unread ?? 0),
      tags: Number(row.tags ?? 0),
    }
  }

  /** Toutes les valeurs de tags existantes, triées — sans rapatrier une seule ligne d'item. */
  async fetchTags(): Promise<string[]> {
    const result = await db.rawQuery(`
      SELECT DISTINCT unnest(tags) AS tag
      FROM veille_items
      -- ⚠️ CC-63 : sans ce filtre, un tag ne vivant que sur des items supprimés resterait dans la
      -- barre — et le cliquer donnerait une liste vide, sans explication.
      WHERE deleted_at IS NULL
      ORDER BY tag
    `)

    return result.rows.map((row: { tag: string }) => row.tag)
  }
}
