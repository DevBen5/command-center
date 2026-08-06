import { DateTime } from 'luxon'
import type { Session } from '@adonisjs/session'
import User from '#core/auth/models/user'
import { LOGIN_STAMP_KEY } from '#core/auth/services/session_lifetime'

/**
 * Fermer toutes les sessions de ce compte **sauf celle qui le demande** (CC-176).
 *
 * Le store est `cookie` : il n'existe aucune liste de sessions côté serveur, donc aucune
 * révocation à l'unité. Ce qui existe, c'est la borne `users.sessions_valid_from`, relue par
 * `AuthMiddleware` à chaque requête et comparée au tampon de connexion posé par CC-78. La poser
 * à maintenant tue d'un coup tout ce qui s'est connecté avant.
 *
 * ## Pourquoi une seule fonction fait les DEUX écritures
 *
 * ⚠️ **Le mode d'échec de ce lot est un bug d'appelant, pas de logique.** Écrire la colonne
 * dans le contrôleur puis re-tamponner la session juste après revient à appeler `now` deux
 * fois : le second instant est postérieur au premier de quelques microsecondes… ou l'inverse
 * selon l'arrondi de la base, et l'utilisateur qui vient de cliquer se retrouve déconnecté au
 * rechargement suivant. Aucun appelant n'a donc à connaître l'instant : il passe sa session, ou
 * rien s'il n'en a pas (`auth:reset-account`).
 *
 * ⚠️ **Le tampon reposé vient de la valeur RELUE en base, jamais du `DateTime` fabriqué ici.**
 * « Le même instant » ne suffit pas si l'aller-retour Postgres ne rend pas exactement ce qu'on a
 * écrit — type de colonne, précision, fuseau. En relisant, l'égalité entre le tampon et la borne
 * devient vraie *par construction*, quoi que fasse le driver, et la comparaison strictement `<`
 * d'`isSessionRevoked` laisse passer cette session-là. Le prix est un SELECT sur une action rare.
 *
 * ## Ce que ça ne fait pas
 *
 * ⚠️ **Aucune liste d'appareils, aucune révocation à l'unité.** Le serveur ne sait ni combien de
 * sessions existent, ni depuis où. C'est une révocation **en bloc** — tout sauf celle qui la
 * déclenche. Un écran « Appareils » demanderait de passer le store en base : autre ticket.
 */
export async function revokeSessions(user: User, session?: Session): Promise<void> {
  user.sessionsValidFrom = DateTime.now()
  await user.save()

  // La borne telle que la base la porte vraiment — voir plus haut. L'ordre compte :
  // écrire, relire, puis seulement tamponner.
  await user.refresh()

  const borne = user.sessionsValidFrom?.toISO()

  /**
   * ⚠️ **Lever, jamais tamponner à vide.** Ne rien poser déconnecterait la personne qui vient de
   * cliquer, à la requête suivante et sans un mot — le symptôme exact que ce fichier existe pour
   * empêcher. Une borne illisible après écriture ne peut venir que d'un bug d'ici ; une exception
   * le montre, un tampon manquant le déguiserait en « le bouton me déconnecte ». La colonne, elle,
   * est déjà écrite : l'échec va donc vers la fermeture, pas vers l'ouverture.
   */
  if (borne === undefined || borne === null) {
    throw new Error(
      'sessions_valid_from est illisible après écriture : la session courante ne peut pas être ' +
        're-tamponnée, et serait expulsée sans raison visible.'
    )
  }

  session?.put(LOGIN_STAMP_KEY, borne)
}
