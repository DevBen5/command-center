import db from '@adonisjs/lucid/services/db'
import User from '#core/auth/models/user'

/**
 * Clé du verrou consultatif Postgres qui sérialise la création du premier compte. Valeur
 * arbitraire mais fixe : tout ce qui compte est que les deux transactions concurrentes
 * demandent la même.
 */
const INSTALLATION_LOCK_KEY = 138_000_001

export interface OwnerAttributes {
  fullName: string
  email: string
  password: string
}

/**
 * La création du premier compte (CC-138) — et la garde qui rend l'écran sûr.
 *
 * ⚠️ **Le contrôle « aucun compte » et l'insertion tiennent dans LA MÊME transaction, et la
 * transaction ne suffit pas** : dans une table vide il n'y a aucune ligne à verrouiller, et
 * sous READ COMMITTED deux transactions simultanées verraient toutes deux zéro compte puis
 * inséreraient toutes deux — deux administrateurs, sans erreur. D'où
 * `pg_advisory_xact_lock` en tête : la seconde transaction attend la première, relit le
 * compte après son commit, et ressort sans écrire. Le verrou est libéré au commit/rollback,
 * jamais à la main — pas de fuite possible.
 *
 * ⚠️ **La fermeture de l'écran se lit dans l'état de la base, jamais dans un drapeau** posé à
 * côté (fichier, variable, colonne de configuration) : un drapeau se désynchronise, et le
 * jour où il ment, il ment dans le sens qui rouvre la porte.
 */
export class InstallationService {
  /** `true` tant que la table `users` est vide — l'unique condition d'ouverture de l'écran. */
  async isOpen(): Promise<boolean> {
    const premier = await User.query().select('id').first()
    return premier === null
  }

  /**
   * Crée le compte propriétaire si — et seulement si — la base n'en porte encore aucun.
   * Rend `null` quand un compte existe déjà : le perdant de la course ne reçoit pas une
   * erreur, il découvre une installation déjà faite.
   *
   * ⚠️ Le compte est administrateur, et ce n'est pas un choix d'ergonomie : sans le drapeau,
   * personne ne pourrait ensuite atteindre l'écran qui distribue les droits.
   */
  async createOwner(attributes: OwnerAttributes): Promise<User | null> {
    return db.transaction(async (trx) => {
      await trx.rawQuery('select pg_advisory_xact_lock(?)', [INSTALLATION_LOCK_KEY])

      const existant = await trx.from('users').select('id').first()
      if (existant) {
        return null
      }

      const user = new User()
      user.useTransaction(trx)
      user.merge({
        fullName: attributes.fullName,
        email: attributes.email,
        // Haché par le mixin AuthFinder du modèle, comme partout ailleurs.
        password: attributes.password,
        isAdmin: true,
        isActive: true,
      })
      await user.save()

      return user
    })
  }
}

export default new InstallationService()
