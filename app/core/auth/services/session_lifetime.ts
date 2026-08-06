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

/**
 * Cette session a-t-elle été révoquée en bloc (CC-176) ?
 *
 * `validFrom` est `users.sessions_valid_from` : la borne posée par un geste volontaire —
 * bouton de `/reglages`, changement de mot de passe, `auth:reset-account`. Toute session
 * connectée **avant** elle est morte.
 *
 * ⚠️ **La comparaison est strictement `<`, et ce n'est pas un détail de style.** Le geste
 * repose le tampon de la session qui le déclenche à la borne exacte : un `<=` la ferait
 * s'auto-expulser au rechargement suivant — symptôme « le bouton me déconnecte », cause
 * invisible. C'est le test qui porte le lot, et il rougit si cette ligne bouge.
 *
 * ⚠️ **Un tampon absent est révoqué, alors qu'il est toléré par `isStampExpired`.** C'est le
 * trou par lequel la révocation fuirait : `AuthMiddleware` *repose* le tampon quand il manque
 * (décision de CC-78, pour ne déconnecter personne au déploiement), donc une session sans
 * tampon se verrait offrir une date postérieure à la borne et y survivrait — le geste
 * paraîtrait fonctionner sans rien fermer. Traiter l'absence comme une révocation est sûr
 * **parce que `validFrom` est renseigné** : toute session ouverte depuis CC-78 porte un
 * tampon, et la borne ne peut être que postérieure à ce déploiement. Quand `validFrom` est
 * `null`, on retombe sur la tolérance d'origine, intacte.
 */
export function isSessionRevoked(stamp: unknown, validFrom: DateTime | null): boolean {
  if (validFrom === null) return false
  if (typeof stamp !== 'string') return true

  const loginAt = DateTime.fromISO(stamp)
  if (!loginAt.isValid) return true

  return loginAt < validFrom
}
