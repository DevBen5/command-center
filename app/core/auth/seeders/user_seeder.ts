import { BaseSeeder } from '@adonisjs/lucid/seeders'
import logger from '@adonisjs/core/services/logger'
import env from '#start/env'
import User from '#core/auth/models/user'
import Role from '#core/auth/models/role'
import RoleCapability from '#core/auth/models/role_capability'

/** Le compte du propriétaire — le seul que ce seeder peut créer. */
const OWNER_EMAIL = 'admin@bstenger.fr'

/**
 * Aligné sur `acceptInvitationValidator` (`validators/admin.ts`), et il faut que ça le reste :
 * sans cette garde, une variable d'environnement poserait un mot de passe que le formulaire
 * de l'application aurait refusé. La règle serait vraie à l'écran et fausse en base.
 */
const MIN_PASSWORD_LENGTH = 12

export default class extends BaseSeeder {
  async run() {
    /**
     * ⚠️ **Le seeder ne produit plus de compte connectable de lui-même (CC-75).** Il posait
     * ici un mot de passe écrit en clair dans le code : commodité sur un poste de
     * développement, porte ouverte dès que l'application est joignable depuis Internet — le
     * code de la serrure étant publié avec elle.
     *
     * Le mot de passe vient donc de `ADMIN_PASSWORD`, qui n'est pas dans le dépôt. Absente,
     * aucun compte n'est créé **et aucun compte existant n'est touché** : le seul chemin vers
     * un compte utilisable passe par un geste explicite.
     */
    const password = env.get('ADMIN_PASSWORD')

    if (!password) {
      logger.warn(
        `Aucun compte administrateur créé : ADMIN_PASSWORD est absente. ` +
          `Renseigne-la dans .env (${MIN_PASSWORD_LENGTH} caractères minimum) puis relance ` +
          `« node ace db:seed » — c'est le seul moyen d'obtenir un premier compte, ` +
          `l'application n'en offre aucun.`
      )
    } else {
      /**
       * ⚠️ Présente mais invalide, c'est une **erreur**, pas un choix : quelqu'un a voulu un
       * compte et se retrouverait sans, ou avec un mot de passe plus faible que ce que
       * l'application accepte. On arrête le seed. La valeur n'apparaît jamais dans le message
       * — un secret qui traverse un journal cesse d'en être un.
       */
      if (password.length < MIN_PASSWORD_LENGTH) {
        throw new Error(
          `ADMIN_PASSWORD fait moins de ${MIN_PASSWORD_LENGTH} caractères. ` +
            `Aucun compte n'a été créé.`
        )
      }

      // `updateOrCreate` évite les doublons si le seeder est relancé (l'email est la clé de
      // recherche). Le mot de passe est haché automatiquement par le mixin AuthFinder du modèle.
      //
      // ⚠️ **Il écrase le mot de passe existant, et c'est le seul outil de rotation.** Une base
      // seedée avant CC-75 porte encore l'ancien mot de passe en clair du dépôt : changer ce
      // fichier ne l'en débarrasse pas. Reposer ADMIN_PASSWORD et relancer le seed, si.
      await User.updateOrCreate(
        { email: OWNER_EMAIL },
        {
          fullName: 'Benjamin Stenger',
          password,
          // Sans ce drapeau, le compte du propriétaire perdrait Services, Agents et l'écran
          // d'administration au premier passage du seeder — sans erreur, et sans moyen de
          // se réaccorder le droit depuis l'application.
          isAdmin: true,
          isActive: true,
        }
      )
    }

    // Un rôle de départ, pour que l'écran d'administration ne s'ouvre pas sur une liste
    // vide. Il ne donne que de la lecture : en accorder plus par défaut irait contre le
    // principe même du lot.
    //
    // ⚠️ **Hors de la branche ci-dessus, délibérément : il se crée même sans ADMIN_PASSWORD.**
    // Le rôle ne dépend pas du compte propriétaire — le faire disparaître avec lui rendrait
    // l'écran d'administration vide le jour où le propriétaire pose enfin la variable. Seul le
    // throw d'un mot de passe trop court l'empêche, et c'est voulu : ce seed-là est avorté, il
    // reprend entièrement au passage suivant avec une valeur valide.
    const lecteur = await Role.updateOrCreate({ name: 'Lecteur' }, {})

    for (const capability of ['dashboard.view', 'leitner.view', 'veille.view']) {
      await RoleCapability.updateOrCreate({ roleId: lecteur.id, capability }, {})
    }
  }
}
