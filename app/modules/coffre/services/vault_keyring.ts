import { randomBytes } from 'node:crypto'
import { DateTime } from 'luxon'
import { VAULT_UNLOCK_MINUTES } from '#modules/coffre/services/vault_session'

/**
 * Le trousseau : où vit la clé dérivée pendant une session élevée (CC-178).
 *
 * ## En mémoire du process, et nulle part ailleurs
 *
 * Les trois emplacements possibles, et pourquoi les deux autres ont été écartés :
 *
 * - **la session** — le store est `cookie` : la clé serait chiffrée par `APP_KEY` et voyagerait
 *   chez le client à chaque requête. C'est exactement ce que le chiffrement du coffre existe pour
 *   éviter ; voir l'en-tête de `vault_crypto.ts` ;
 * - **la base** — une clé rangée à côté de ce qu'elle déchiffre n'est pas une clé ;
 * - **la mémoire** — retenue. Elle ne touche ni le disque, ni le cookie, donc n'entre dans aucun
 *   `npm run db:backup` et ne part jamais au miroir.
 *
 * ⚠️ **Trois contreparties, toutes assumées, aucune silencieuse** :
 *
 * 1. **un redémarrage referme tous les coffres.** C'est même une propriété : le `keyId` que porte
 *    le cookie ne désigne plus rien, et l'élévation tombe d'elle-même ;
 * 2. **mono-instance.** À plusieurs processus, une requête servie par le second ne trouverait pas
 *    la clé ouverte par le premier — le coffre paraîtrait se refermer au hasard. L'application est
 *    mono-instance (même hypothèse que la garde anti-chevauchement de `veille_scheduler`), mais
 *    c'est une hypothèse, pas une garantie du code ;
 * 3. **une clé survit à la révocation de la session qui l'a ouverte**, jusqu'à son échéance. Elle
 *    est alors **inatteignable** : le cookie qui portait son `keyId` est mort, et `AuthMiddleware`
 *    expulse la session avant qu'aucune route du coffre ne soit atteinte. Purger depuis
 *    `session_revocation.ts` ferait dépendre le **noyau** d'un module détachable — exactement ce
 *    que le point 7 du `CLAUDE.md` racine interdit.
 *
 * ## Pas de minuteur, et c'est délibéré
 *
 * La purge est **paresseuse** : chaque accès nettoie ce qui a expiré. Un `setInterval` retiendrait
 * le processus (il faudrait `unref()`, cf. `veille_scheduler`) pour nettoyer une `Map` qui compte
 * au plus quelques entrées. Le seul effet d'une purge tardive est une clé qui vit un peu plus
 * longtemps en mémoire sans que rien ne puisse la réclamer — `keyFor` vérifie l'échéance avant de
 * rendre quoi que ce soit.
 */
interface OpenVault {
  userId: number
  key: Buffer
  expiresAt: DateTime
}

class VaultKeyring {
  #ouverts = new Map<string, OpenVault>()

  /**
   * Range une clé et rend son pointeur.
   *
   * ⚠️ **Le `keyId` est tiré au sort, jamais dérivé de la passphrase ni du compte.** Dérivé, il
   * serait un oracle : le même identifiant réapparaîtrait à chaque ouverture, et sa présence dans
   * un cookie dirait quelque chose du secret qui l'a produit.
   */
  open(userId: number, key: Buffer, now: DateTime = DateTime.now()): string {
    this.#purge(now)

    const keyId = randomBytes(16).toString('hex')
    this.#ouverts.set(keyId, {
      userId,
      key,
      expiresAt: now.plus({ minutes: VAULT_UNLOCK_MINUTES }),
    })

    return keyId
  }

  /**
   * La clé de ce pointeur, ou `null`.
   *
   * ⚠️ **`userId` est revérifié ici, en plus de l'être dans le marqueur.** Le marqueur vit dans un
   * cookie chiffré, donc infalsifiable — mais cette redondance ne coûte rien et ferme le cas d'un
   * appelant qui passerait le `keyId` d'ailleurs que du marqueur. Sécurité en profondeur, même
   * motif que le contrôle `!user.isActive` de `can_middleware`.
   */
  keyFor(keyId: string, userId: number, now: DateTime = DateTime.now()): Buffer | null {
    this.#purge(now)

    const ouvert = this.#ouverts.get(keyId)
    if (!ouvert) return null
    if (ouvert.userId !== userId) return null

    // ⚠️ **Aucun contrôle d'échéance ici, et c'est volontaire : `#purge(now)` vient de le faire,
    // avec le même `now`.** Une seconde vérification serait *structurellement inatteignable* —
    // mesuré en la retirant, `coffre_keyring.spec.ts` restait vert. Une ligne qu'aucun test ne
    // peut faire rougir se lit comme une garde alors qu'elle n'en est pas une, et la prochaine
    // relecture croirait l'échéance tenue à deux endroits. Elle l'est à **un** : la purge.
    return ouvert.key
  }

  /** Referme un coffre — le bouton « verrouiller », et la reprise d'une ouverture. */
  close(keyId: string): void {
    this.#oublier(keyId)
  }

  /**
   * Referme tout ce qui appartient à ce compte.
   *
   * Appelé à la **ré-ouverture** : sans ça, une seconde ouverture laisserait la clé précédente
   * vivre jusqu'à son échéance sans que plus aucun marqueur ne la désigne.
   */
  closeAllFor(userId: number): void {
    for (const [keyId, ouvert] of this.#ouverts) {
      if (ouvert.userId === userId) this.#oublier(keyId)
    }
  }

  #purge(now: DateTime): void {
    for (const [keyId, ouvert] of this.#ouverts) {
      if (ouvert.expiresAt <= now) this.#oublier(keyId)
    }
  }

  /**
   * ⚠️ **La clé est écrasée avant d'être lâchée.** Le ramasse-miettes ne promet pas quand il
   * libérera le tampon ; d'ici là, ses octets restent lisibles dans un vidage mémoire. Geste
   * modeste et honnête — il ne protège pas d'un attaquant qui lit la mémoire du processus **au
   * moment où le coffre est ouvert**, ce que rien ici ne prétend faire.
   */
  #oublier(keyId: string): void {
    this.#ouverts.get(keyId)?.key.fill(0)
    this.#ouverts.delete(keyId)
  }
}

export default new VaultKeyring()
export { VaultKeyring }
