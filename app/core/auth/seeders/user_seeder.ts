import { BaseSeeder } from '@adonisjs/lucid/seeders'
import User from '#core/auth/models/user'
import Role from '#core/auth/models/role'
import RoleCapability from '#core/auth/models/role_capability'

export default class extends BaseSeeder {
  async run() {
    // Compte d'accès unique au tableau de bord. `updateOrCreate` évite les
    // doublons si le seeder est relancé (l'email est la clé de recherche).
    // Le mot de passe est haché automatiquement par le mixin AuthFinder du modèle.
    //
    // ⚠️ **Le mot de passe par défaut reste une dette ouverte — voir CC-34.** Sur une
    // application exposée ce n'en serait plus une, ce serait une porte : à traiter avant
    // toute mise en ligne (CC-73/CC-74), pas après.
    await User.updateOrCreate(
      { email: 'admin@bstenger.fr' },
      {
        fullName: 'Benjamin Stenger',
        password: 'motdepasse',
        // Sans ce drapeau, le compte du propriétaire perdrait Services, Agents et l'écran
        // d'administration au premier passage du seeder — sans erreur, et sans moyen de
        // se réaccorder le droit depuis l'application.
        isAdmin: true,
        isActive: true,
      }
    )

    // Un rôle de départ, pour que l'écran d'administration ne s'ouvre pas sur une liste
    // vide. Il ne donne que de la lecture : en accorder plus par défaut irait contre le
    // principe même du lot.
    const lecteur = await Role.updateOrCreate({ name: 'Lecteur' }, {})

    for (const capability of ['dashboard.view', 'leitner.view', 'veille.view']) {
      await RoleCapability.updateOrCreate({ roleId: lecteur.id, capability }, {})
    }
  }
}
