import { DateTime } from 'luxon'

/**
 * L'élévation de session du coffre (CC-178) — **code pur**, testé sans passer par HTTP.
 *
 * C'est le pendant exact de `two_factor_challenge.ts` (CC-114) : un marqueur de session qui expire,
 * hors de tout contrôleur. Même raison que `session_lifetime.ts` — ce qui reste dans un contrôleur
 * n'est atteignable par aucun test.
 *
 * ## Ce que le marqueur porte, et ce qu'il ne porte PAS
 *
 * ⚠️ **Aucun matériel cryptographique n'entre ici.** Le store de session est `cookie`
 * (`config/session.ts:39-49`) : tout ce qu'on y écrit est chiffré par `APP_KEY` et **voyage chez le
 * client à chaque requête**. Y ranger la clé dérivée la rendrait fonction d'`APP_KEY` — précisément
 * ce que `vault_crypto.ts` existe pour éviter. Le marqueur ne porte qu'un **pointeur** (`keyId`)
 * vers une clé qui vit en mémoire du process, et ce pointeur ne vaut rien hors de ce process.
 *
 * ## Trois conditions, et chacune ferme un trou distinct
 *
 * 1. **l'âge** — au-delà de `VAULT_UNLOCK_MINUTES`, le marqueur ne vaut plus rien ;
 * 2. **le compte** — un marqueur ne vaut que pour le compte qui l'a posé (cf. point 3) ;
 * 3. **la connexion** — ⚠️ `auth.logout()` **ne détruit pas la session**, il oublie la clé du
 *    guard (`SessionGuard.logout` fait un `session.forget` sur sa seule clé). Sans la comparaison
 *    au tampon de connexion de CC-78, un marqueur survivrait à une déconnexion : se reconnecter
 *    dans les quinze minutes rouvrirait le coffre **sans passphrase**. La borne existe déjà et
 *    CC-176 la manipule ; on la lit, on n'en fabrique pas une seconde.
 */
export const VAULT_UNLOCK_KEY = 'coffre_unlock'

/**
 * Au-delà, il faut ressaisir code et passphrase.
 *
 * Quinze minutes : le temps d'écrire quelques entrées, pas celui de laisser un coffre ouvert
 * derrière soi sur un écran qu'on a quitté. C'est plus long que les cinq minutes du demi-tour de
 * connexion (`PENDING_2FA_MINUTES`), parce qu'on y **travaille** au lieu d'y passer.
 *
 * ⚠️ **La même constante borne le trousseau en mémoire** (`vault_keyring.ts`). Deux TTL qui
 * divergeraient laisseraient une des deux moitiés ouverte : un marqueur encore valide devant une
 * clé purgée donne un 403 incompréhensible, et l'inverse laisse une clé vivre sans que rien ne la
 * réclame.
 */
export const VAULT_UNLOCK_MINUTES = 15

export interface VaultUnlockMarker {
  userId: number
  /** Le pointeur vers la clé en mémoire — inutile hors du process qui l'a émis. */
  keyId: string
  at: string
}

/**
 * Ce qu'on écrit en session quand le coffre s'ouvre.
 *
 * Le type de retour est **annoté** pour la même raison que `pendingChallengeFor` : `toISO()` rend
 * `string | null` en luxon, et sans l'annotation la forme écrite divergerait en silence de celle
 * que la relecture attend.
 */
export function unlockMarkerFor(
  userId: number,
  keyId: string,
  now: DateTime = DateTime.now()
): VaultUnlockMarker {
  return { userId, keyId, at: now.toISO()! }
}

/**
 * Le pointeur de clé utilisable pour ce compte, ou `null` si rien ne l'est.
 *
 * ⚠️ **Un marqueur illisible est traité comme absent**, comme le demi-tour de connexion de CC-114
 * et le tampon de CC-78 : le sens sûr est de refermer le coffre, jamais de deviner.
 *
 * ⚠️ **`loginStamp` absent ferme aussi.** Ça peut surprendre — `isStampExpired` le tolère, lui —
 * mais l'asymétrie est voulue et va dans le bon sens : un marqueur d'élévation ne se pose qu'après
 * une connexion, donc après que `AuthMiddleware` a posé le tampon. Un tampon manquant devant un
 * marqueur présent n'est pas un état légitime.
 */
export function unlockedKeyId(
  value: unknown,
  userId: number,
  loginStamp: unknown,
  now: DateTime = DateTime.now()
): string | null {
  if (typeof value !== 'object' || value === null) return null

  const marker = value as Partial<VaultUnlockMarker>
  if (typeof marker.userId !== 'number' || typeof marker.keyId !== 'string') return null
  if (typeof marker.at !== 'string' || marker.keyId.length === 0) return null

  if (marker.userId !== userId) return null

  const posedAt = DateTime.fromISO(marker.at)
  if (!posedAt.isValid) return null
  if (now.diff(posedAt, 'minutes').minutes > VAULT_UNLOCK_MINUTES) return null

  // La connexion en cours est-elle celle qui a ouvert le coffre ? Voir la condition 3 en tête.
  if (typeof loginStamp !== 'string') return null
  const loggedAt = DateTime.fromISO(loginStamp)
  if (!loggedAt.isValid) return null
  if (posedAt < loggedAt) return null

  return marker.keyId
}
