import { DateTime } from 'luxon'

/**
 * Expiration absolue des sessions (CC-78, décision actée sur le ticket).
 *
 * Le store est `cookie` : le serveur ne garde aucune liste de sessions, donc
 * aucun moyen d'invalider *un* cookie volé. L'expiration d'inactivité (2 h,
 * `config/session.ts`) ne borne rien pour un voleur qui rejoue le cookie
 * régulièrement. D'où ce tampon : l'heure de connexion, posée **dans** la
 * session — chiffrée et signée avec `APP_KEY`, donc infalsifiable et
 * inséparable du cookie — au-delà de laquelle `auth_middleware` expulse,
 * quelle que soit l'activité.
 */
export const LOGIN_STAMP_KEY = 'login_stamp'

/** Au-delà, re-connexion obligatoire, même en pleine activité. */
export const MAX_SESSION_DAYS = 7

/**
 * Un tampon illisible est **expiré**, pas ignoré : la seule façon d'en avoir
 * un, c'est un bug de notre code — personne ne peut écrire dans une session
 * chiffrée. Expulser est le sens sûr ; ignorer rendrait la borne contournable
 * par le bug qui l'aurait produit.
 */
export function isStampExpired(stamp: unknown, now: DateTime = DateTime.now()): boolean {
  if (typeof stamp !== 'string') return true

  const loginAt = DateTime.fromISO(stamp)
  if (!loginAt.isValid) return true

  return now.diff(loginAt, 'days').days > MAX_SESSION_DAYS
}
