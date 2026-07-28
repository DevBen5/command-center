import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import type { BulkAction } from '#modules/veille/shared/bulk_actions'

/**
 * Les actions groupées sur une sélection (CC-109) — **les premières écritures de `tags` par
 * l'application, avec la capture**.
 *
 * ⚠️ **Aucune de ces actions ne touche Immich.** C'est ce qui les sépare de la suppression : pas
 * d'ordre à tenir entre deux systèmes, pas de partiel à assumer, pas de confirmation. Le seul
 * geste destructeur du module reste la suppression, et il le reste.
 *
 * ⚠️ **Un seul `UPDATE` par action, jamais un aller-retour par item.** Lire trente lignes, modifier
 * leur tableau en JS et les réécrire une par une serait trente allers-retours **et** une fenêtre de
 * concurrence à chaque ligne : une collecte qui passe entre la lecture et l'écriture verrait sa
 * modification écrasée. Postgres sait faire les deux opérations sur un tableau.
 */
export default class VeilleBulkService {
  /**
   * Applique l'action, et rend le nombre de lignes **réellement** modifiées.
   *
   * ⚠️ **Chaque requête porte deux gardes, et les deux comptent.**
   *
   * `deleted_at IS NULL` : un supprimé porte une pierre tombale et ne doit être touché par aucun
   * chemin. La liste des lectures qui l'honorent vit dans le `CLAUDE.md` du module ; celles-ci
   * sont des **écritures**, et un oubli modifierait en silence des lignes que plus rien n'affiche.
   *
   * La seconde garde est propre à l'action (`NOT (? = ANY(tags))`, `read_at IS NULL`,
   * `reading_queue = false`…) et fait d'une pierre deux coups :
   *
   * - **l'idempotence** — `array_append` **ne déduplique pas** : poser deux fois `ia` produirait
   *   `{ia,ia}`, donc deux pastilles identiques sur la ligne et un double comptage dans la barre
   *   de tags, qui agrège par `unnest`. Aucune contrainte en base ne l'empêche ;
   * - **l'honnêteté du compte** — sans elle, `rowCount` vaudrait la taille de la sélection quoi
   *   qu'il arrive, et le retour annoncerait « 30 marqués comme lus » sur trente items déjà lus.
   *   C'est ce compte qui décide du ton `info`.
   *
   * ⚠️ **`array_append` / `array_remove` en SQL paramétré**, jamais une concaténation : `tags` est
   * un `text[]` alimenté par une saisie utilisateur depuis CC-21.
   */
  async apply(ids: number[], action: BulkAction, tag: string | null): Promise<number> {
    if (ids.length === 0) return 0

    const now = DateTime.now().toSQL()

    switch (action) {
      case 'tag.add':
        return this.run(
          `UPDATE veille_items SET tags = array_append(tags, ?), updated_at = ?
             WHERE id = ANY(?) AND deleted_at IS NULL AND NOT (? = ANY(tags))`,
          [tag, now, ids, tag]
        )

      case 'tag.remove':
        return this.run(
          `UPDATE veille_items SET tags = array_remove(tags, ?), updated_at = ?
             WHERE id = ANY(?) AND deleted_at IS NULL AND ? = ANY(tags)`,
          [tag, now, ids, tag]
        )

      /**
       * ⚠️ **Un timestamp, pas un booléen** — c'est la colonne du module, et elle dit *quand*.
       * `read_at IS NULL` en garde : remarquer lu un item déjà lu ne doit pas **réécrire** sa date
       * de lecture, sinon l'historique reculerait à chaque geste groupé.
       */
      case 'read':
        return this.run(
          `UPDATE veille_items SET read_at = ?, updated_at = ?
             WHERE id = ANY(?) AND deleted_at IS NULL AND read_at IS NULL`,
          [now, now, ids]
        )

      case 'unread':
        return this.run(
          `UPDATE veille_items SET read_at = NULL, updated_at = ?
             WHERE id = ANY(?) AND deleted_at IS NULL AND read_at IS NOT NULL`,
          [now, ids]
        )

      case 'queue.add':
        return this.run(
          `UPDATE veille_items SET reading_queue = true, updated_at = ?
             WHERE id = ANY(?) AND deleted_at IS NULL AND reading_queue = false`,
          [now, ids]
        )

      case 'queue.remove':
        return this.run(
          `UPDATE veille_items SET reading_queue = false, updated_at = ?
             WHERE id = ANY(?) AND deleted_at IS NULL AND reading_queue = true`,
          [now, ids]
        )

      /**
       * ⚠️ **Le `default` affecte à `never`** — même motif que `collectByKind` : ajouter une action
       * à `BULK_ACTIONS` sans sa branche fait échouer `tsc`. Ne le remplace pas par un repli « pour
       * simplifier », ce serait un geste qui ne fait rien sans rien dire.
       */
      default: {
        const exhaustive: never = action
        throw new Error(`Action groupée inconnue : ${String(exhaustive)}`)
      }
    }
  }

  private async run(sql: string, bindings: unknown[]): Promise<number> {
    const result = await db.rawQuery(sql, bindings)
    return result.rowCount ?? 0
  }
}
