import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import type { CatalogThumbnail } from '#modules/coffre/services/catalog_source'
import CoffreCatalogThumbnail from '#modules/coffre/models/coffre_catalog_thumbnail'
import { decrypt, encrypt } from '#modules/coffre/services/vault_crypto'

/**
 * Le cache de vignettes du catalogue NAS (CC-228) — chiffré par la clé du coffre, alimenté à la
 * demande (jamais au moment de `coffre:sync-catalog`). Voir la migration
 * `coffre_catalog_thumbnails` pour la doctrine complète.
 *
 * ⚠️ **`vault_crypto.ts` chiffre des CHAÎNES, pas des octets bruts** — les octets de la vignette
 * sont donc encodés en base64 avant chiffrement, et redécodés après déchiffrement. Ce n'est pas une
 * inefficacité qu'il faudrait corriger : modifier la signature d'`encrypt`/`decrypt` pour accepter
 * un `Buffer` toucherait tous les autres appelants du module (titre, contenu, secret, UUID Immich,
 * chemin NAS) pour un gain marginal sur des vignettes bornées à 512 Ko.
 */
class CatalogThumbnailCacheService {
  /**
   * ⚠️ **Un chiffré illisible est traité comme une ABSENCE (cache-miss), jamais comme un refus** —
   * la seule exception à la doctrine du module (« illisible ≠ absent », voir `secretFor`). La
   * différence : cette ligne est une donnée DÉRIVÉE, toujours régénérable depuis le fichier NAS
   * source, contrairement à un secret d'entrée qui n'existe nulle part ailleurs. La confondre avec
   * un refus forcerait une prudence que rien ici ne justifie — l'appelant régénère simplement.
   */
  async get(catalogItemId: number, ownerId: number, key: Buffer): Promise<CatalogThumbnail | null> {
    const row = await CoffreCatalogThumbnail.query()
      .where('catalog_item_id', catalogItemId)
      .where('owner_id', ownerId)
      .first()
    if (row === null) return null

    const decoded = decrypt(row.contentCipher, key)
    if (decoded === null) return null

    return { bytes: Buffer.from(decoded, 'base64'), contentType: row.contentType }
  }

  /**
   * ⚠️ **Course bénigne acceptée, pas fermée par une transaction.** Deux requêtes concurrentes
   * pour le même élément non encore en cache régénèrent toutes deux (coût CPU doublé une fois,
   * jamais une boucle) ; la seconde écriture heurte la contrainte unique
   * (`catalog_item_id`), capturée ici et ignorée — la réponse HTTP de CHAQUE requête reste
   * correcte puisque les octets ont déjà été générés avant cet appel. Même doctrine que
   * `VaultService.createVault` : l'unicité vient de la base, pas d'un contrôle applicatif.
   *
   * ⚠️ **Le `catch` journalise avant d'ignorer.** Il couvre la course ci-dessus, mais aussi
   * n'importe quel autre échec d'écriture (panne base, bug) — sans `logger.warn`, ce second cas
   * disparaîtrait sans trace, contrairement à tous les autres échecs absorbés du module. La
   * réponse HTTP reste correcte dans les deux cas : les octets sont déjà générés avant cet appel.
   */
  async put(
    catalogItemId: number,
    ownerId: number,
    key: Buffer,
    thumbnail: CatalogThumbnail
  ): Promise<void> {
    const contentCipher = encrypt(thumbnail.bytes.toString('base64'), key)

    try {
      await CoffreCatalogThumbnail.updateOrCreate(
        { catalogItemId },
        {
          catalogItemId,
          ownerId,
          contentCipher,
          contentType: thumbnail.contentType,
          generatedAt: DateTime.now(),
        }
      )
    } catch (error) {
      logger.warn(
        { catalogItemId, error: error instanceof Error ? error.message : String(error) },
        "L'écriture du cache de vignette a échoué — course bénigne probable, la réponse HTTP " +
          'en cours reste correcte.'
      )
    }
  }
}

export default new CatalogThumbnailCacheService()
