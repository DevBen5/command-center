import { BaseSeeder } from '@adonisjs/lucid/seeders'
import User from '#models/user'

export default class extends BaseSeeder {
  async run() {
    // Compte d'accès unique au tableau de bord. `updateOrCreate` évite les
    // doublons si le seeder est relancé (l'email est la clé de recherche).
    // Le mot de passe est haché automatiquement par le mixin AuthFinder du modèle.
    await User.updateOrCreate(
      { email: 'admin@bstenger.fr' },
      {
        fullName: 'Benjamin Stenger',
        password: 'motdepasse',
      }
    )
  }
}
