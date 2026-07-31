import { DateTime } from 'luxon'

/**
 * Le demi-tour de connexion : mot de passe accepté, second facteur encore dû (CC-114).
 *
 * ⚠️ **Ce marqueur n'est pas une identité.** Il ne porte qu'un identifiant et une heure ; rien
 * dans l'application ne l'interroge pour décider d'un accès — `auth_middleware` ne connaît que
 * le guard de session, qui n'a rien reçu. Un compte à ce stade est exactement aussi peu
 * connecté qu'avant d'avoir saisi son mot de passe.
 *
 * Il vit dans la session, donc chiffré et signé avec APP_KEY : personne ne peut s'en fabriquer
 * un. Ce fichier est **pur** — la même raison que `session_lifetime.ts`, dont il est le
 * pendant : ce qui reste dans un contrôleur n'est atteignable par aucun test.
 */
export const PENDING_2FA_KEY = 'pending_two_factor'

/**
 * Au-delà, il faut ressaisir son mot de passe.
 *
 * Cinq minutes : le temps de sortir son téléphone, pas celui de laisser un demi-tour de
 * connexion traîner dans une session. Sans borne, un marqueur posé le matin resterait
 * consommable le soir sur une machine partagée.
 */
export const PENDING_2FA_MINUTES = 5

export interface PendingChallenge {
  userId: number
  at: string
}

/**
 * Ce qu'on écrit en session à la fin de l'étape « mot de passe ».
 *
 * Le type de retour est **annoté** : `toISO()` rend `string | null` en luxon, et sans cette
 * annotation la forme écrite en session divergerait en silence de celle que `pendingUserId`
 * relit. Le `!` est sûr — `DateTime.now()` est toujours valide — et c'est justement ce qu'on
 * veut voir échouer à la compilation si quelqu'un passe une date d'une autre provenance.
 */
export function pendingChallengeFor(
  userId: number,
  now: DateTime = DateTime.now()
): PendingChallenge {
  return { userId, at: now.toISO()! }
}

/**
 * L'identifiant du compte en attente, ou `null` si rien d'utilisable.
 *
 * ⚠️ **Un marqueur illisible est traité comme absent**, comme le tampon de session de CC-78
 * traite l'illisible comme expiré : le sens sûr est de renvoyer au formulaire de connexion,
 * jamais de deviner de qui il s'agissait.
 */
export function pendingUserId(value: unknown, now: DateTime = DateTime.now()): number | null {
  if (typeof value !== 'object' || value === null) return null

  const { userId, at } = value as Partial<PendingChallenge>
  if (typeof userId !== 'number' || typeof at !== 'string') return null

  const posedAt = DateTime.fromISO(at)
  if (!posedAt.isValid) return null
  if (now.diff(posedAt, 'minutes').minutes > PENDING_2FA_MINUTES) return null

  return userId
}
