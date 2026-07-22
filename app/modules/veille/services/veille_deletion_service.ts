import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import VeilleItem from '#modules/veille/models/veille_item'
import ImmichClient from '#modules/veille/services/immich_client'
import { assetIdFromDedupKey } from '#modules/veille/services/immich_asset'

/** Ce qu'une suppression rapporte à l'écran. */
export type DeletionOutcome = {
  /** Items réellement marqués supprimés. */
  deleted: number
  /** Assets réellement partis à la corbeille d'Immich — un sous-ensemble de `deleted`. */
  trashed: number
  /** Items laissés en place parce qu'Immich a refusé ou n'a pas répondu. */
  failed: number
  /** Le message d'Immich, **tel quel**, ou `null`. */
  error: string | null
}

/**
 * La suppression d'items de veille (CC-63) — logique en base, corbeille dans Immich.
 *
 * Deux systèmes, donc deux écritures, donc une fenêtre entre les deux. **Elle n'est pas
 * symétrique, et c'est ce qui fixe l'ordre :**
 *
 * - **Immich d'abord, la base ensuite.** Un crash entre les deux laisse un asset à la corbeille
 *   et un item encore visible : la passe suivante le marque « plus dans l'album » (CC-55), et
 *   l'utilisateur peut resupprimer. Visible, rattrapable.
 * - **L'inverse serait le mauvais ordre** : item marqué supprimé, asset toujours dans l'album. La
 *   collecte ne le réinsère pas (la pierre tombale tient), mais l'asset reste dans Immich pour
 *   toujours alors que l'utilisateur croit l'avoir supprimé. Silencieux, donc inacceptable.
 *
 * ⚠️ **Un échec côté Immich ne marque RIEN en base.** C'est la règle qui produit l'invariant du
 * lot : *une ligne marquée supprimée = un asset réellement à la corbeille*. Ne l'assouplis pas
 * pour « débloquer » un item récalcitrant — voir `trashMedia` pour le raccourci écarté.
 */
@inject()
export default class VeilleDeletionService {
  constructor(private client: ImmichClient) {}

  /**
   * Supprime les items désignés, et rend ce qui s'est réellement passé.
   *
   * ⚠️ **Idempotent par le filtre `deleted_at IS NULL`** : un double-clic, un rejeu de requête ou
   * deux onglets ne rappellent pas Immich sur des assets déjà à la corbeille. Un id inconnu ou
   * déjà supprimé est simplement ignoré — jamais une erreur, il n'y a rien à signaler.
   */
  async deleteItems(ids: number[]): Promise<DeletionOutcome> {
    const items = await VeilleItem.visible().whereIn('id', ids)
    if (items.length === 0) return { deleted: 0, trashed: 0, failed: 0, error: null }

    /**
     * Un item ne relève d'Immich que s'il porte réellement un asset. `assetIdFromDedupKey` rend
     * `null` pour un article, une capture manuelle **et** un média dont la clé serait malformée :
     * les trois se suppriment sans sortir de Command Center.
     */
    const media: { item: VeilleItem; assetId: string }[] = []
    const local: VeilleItem[] = []

    for (const item of items) {
      const assetId = assetIdFromDedupKey(item.dedupKey)
      if (assetId === null) local.push(item)
      else media.push({ item, assetId })
    }

    const trash = await this.trashMedia(media)

    /**
     * ⚠️ **Partiel assumé, et sûr.** Les items sans asset partent même quand Immich a échoué :
     * ils n'ont aucune dépendance externe, et rien de ce qui les concerne ne peut diverger. Seuls
     * les médias attendent leur corbeille. Un tout-ou-rien punirait les articles pour une panne
     * qui ne les regarde pas, sur des lots où l'utilisateur en sélectionne trente.
     */
    const toMark = [...local, ...trash.trashed]
    await this.markDeleted(toMark)

    return {
      deleted: toMark.length,
      trashed: trash.trashed.length,
      failed: trash.failed,
      error: trash.error,
    }
  }

  /**
   * Met les assets à la corbeille d'Immich, et ne rend que ceux qui y sont réellement.
   *
   * ⚠️ **La corbeille est vérifiée à chaque appel, jamais au démarrage.** `trashDays: 0` fait
   * refuser : sur une instance sans corbeille, `force: false` détruit immédiatement et il n'y a
   * aucune copie des octets ailleurs. Un refus coûte un message ; une destruction est définitive.
   *
   * ⚠️ **Un raccourci a été écarté ici** : sauter l'appel pour un item déjà marqué
   * `unavailable_at`. Ça adoucirait le rattrapage après un échec à mi-chemin, mais un asset
   * seulement *sorti de l'album* resterait dans la bibliothèque d'Immich pendant que
   * l'utilisateur le croit supprimé. C'est précisément la divergence silencieuse que l'ordre des
   * opérations existe pour empêcher — un média passe toujours par Immich.
   */
  private async trashMedia(
    media: { item: VeilleItem; assetId: string }[]
  ): Promise<{ trashed: VeilleItem[]; failed: number; error: string | null }> {
    if (media.length === 0) return { trashed: [], failed: 0, error: null }

    try {
      const days = await this.client.trashDays()

      if (days <= 0) {
        return {
          trashed: [],
          failed: media.length,
          error:
            "La corbeille d'Immich est désactivée (trashDays = 0) : une suppression y serait " +
            'définitive, et Command Center ne garde aucune copie des fichiers. Aucun média n’a ' +
            'été supprimé. Active la corbeille dans Immich pour pouvoir les retirer d’ici.',
        }
      }

      await this.client.trashAssets(media.map(({ assetId }) => assetId))

      return { trashed: media.map(({ item }) => item), failed: 0, error: null }
    } catch (error) {
      /**
       * L'erreur remonte **telle quelle** — même doctrine que `last_error` sur une source. Ce que
       * l'utilisateur doit pouvoir distinguer d'un coup d'œil : Immich éteint, clé sans la
       * permission `asset.delete`, ou asset inconnu. Un message maison les rendrait identiques.
       */
      return {
        trashed: [],
        failed: media.length,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * La pierre tombale : la ligne reste, `deleted_at` la masque.
   *
   * ⚠️ **Jamais un `delete()`.** Retirer la ligne libérerait `dedup_key`, et la passe suivante
   * réinsérerait l'item — le bouton *paraîtrait* marcher, puis l'item reviendrait sans que rien
   * ne relie les deux. C'est toute la raison d'être de la colonne.
   */
  private async markDeleted(items: VeilleItem[]): Promise<void> {
    if (items.length === 0) return

    const now = DateTime.now()

    await VeilleItem.query()
      .whereIn(
        'id',
        items.map((item) => item.id)
      )
      // Une seconde garde contre un rejeu concurrent : la date de suppression est celle du
      // premier passage, pas du dernier.
      .whereNull('deleted_at')
      .update({ deleted_at: now.toSQL() })
  }
}
