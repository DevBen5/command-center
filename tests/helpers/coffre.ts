import { DateTime } from 'luxon'
import type { SessionData } from '@adonisjs/session/types'
import type User from '#core/auth/models/user'
import { LOGIN_STAMP_KEY } from '#core/auth/services/session_lifetime'
import CoffreVault from '#modules/coffre/models/coffre_vault'
import keyring from '#modules/coffre/services/vault_keyring'
import { deriveKey, generateSalt, sealVerifier } from '#modules/coffre/services/vault_crypto'
import { VAULT_UNLOCK_KEY, unlockMarkerFor } from '#modules/coffre/services/vault_session'

/** La passphrase des tests — assez longue pour passer `MIN_PASSWORD_LENGTH`. */
export const PASSPHRASE = 'passphrase-de-test'

/**
 * Pose un coffre pour ce compte, sans passer par la route.
 *
 * ⚠️ **Écrit les colonnes directement, comme `enrollTotp` le fait pour le second facteur** : un
 * test qui doit fabriquer un code TOTP valide *et* ouvrir un coffre pour poser son décor
 * testerait son propre décor avant d'atteindre ce qu'il vient vérifier.
 */
export async function createVault(user: User, passphrase = PASSPHRASE): Promise<CoffreVault> {
  const kdfSalt = generateSalt()

  return CoffreVault.create({
    userId: user.id,
    kdfSalt,
    verifier: sealVerifier(deriveKey(passphrase, kdfSalt)),
  })
}

/**
 * L'état de session d'un coffre **ouvert**, à passer à `withSession()`.
 *
 * ⚠️ **Le tampon de connexion est forgé lui aussi, et sans lui le test rougirait pour la mauvaise
 * raison.** `loginAs` ne pose aucun tampon ; `AuthMiddleware` en pose donc un à *maintenant* dès
 * la première requête (décision de CC-78). Un marqueur d'élévation daté d'avant serait alors rejeté
 * par la règle « une élévation ne survit pas à une reconnexion » — on chercherait un bug dans le
 * mur alors que c'est le décor qui ment. On antidate donc la connexion.
 *
 * ⚠️ **Le trousseau vit en mémoire du process, lui, et n'est PAS rollbacké** par la transaction
 * globale des tests. C'est justement ce qui rend cette fabrique possible : la clé ouverte ici est
 * la même que celle que la requête HTTP retrouvera.
 */
export async function unlockedSession(
  user: User,
  vault: CoffreVault,
  passphrase = PASSPHRASE
): Promise<SessionData> {
  const keyId = keyring.open(user.id, deriveKey(passphrase, vault.kdfSalt))

  return {
    [LOGIN_STAMP_KEY]: DateTime.now().minus({ hours: 1 }).toISO(),
    [VAULT_UNLOCK_KEY]: unlockMarkerFor(user.id, keyId, DateTime.now().minus({ minutes: 1 })),
  }
}

/** Une session **connectée** mais coffre fermé — le cas que le mur doit refuser. */
export function lockedSession(): SessionData {
  return { [LOGIN_STAMP_KEY]: DateTime.now().minus({ hours: 1 }).toISO() }
}
