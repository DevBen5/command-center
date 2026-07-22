import { createHash, randomBytes } from 'node:crypto'
import { DateTime } from 'luxon'
import UserInvitation from '#core/auth/models/user_invitation'
import type User from '#core/auth/models/user'

/** Au-delà, le lien ne vaut plus rien et il faut en redemander un. */
const VALIDITY_DAYS = 7

/**
 * Les liens d'invitation par lesquels un compte se donne son premier mot de passe.
 *
 * ⚠️ **Le mot de passe d'un nouveau compte ne s'affiche jamais dans une page, et le lien
 * n'est jamais journalisé.** Le jeton en clair n'existe qu'une fois : dans la réponse HTTP
 * faite à l'admin qui le demande explicitement. Il ne passe ni par un message flash
 * (`SESSION_DRIVER` vaut `cookie` : un flash part chez le client), ni par les journaux.
 * La base n'en connaît que l'empreinte — une fuite du dump ne donne aucun lien utilisable.
 */
class InvitationService {
  #hash(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }

  /**
   * Émet un lien pour cet utilisateur et **révoque les précédents**.
   *
   * La révocation n'est pas un détail : sans elle, chaque clic sur « obtenir un lien »
   * laisserait derrière lui un jeton toujours valide, et « je regénère parce que j'ai des
   * doutes sur le premier » ne fermerait rien du tout.
   *
   * Retourne le jeton **en clair** — la seule et unique fois où il existe.
   */
  async issueFor(user: User): Promise<string> {
    await UserInvitation.query().where('user_id', user.id).whereNull('used_at').delete()

    const token = randomBytes(32).toString('hex')

    await UserInvitation.create({
      userId: user.id,
      tokenHash: this.#hash(token),
      expiresAt: DateTime.now().plus({ days: VALIDITY_DAYS }),
      usedAt: null,
    })

    return token
  }

  /**
   * L'invitation utilisable derrière ce jeton, ou `null`.
   *
   * La recherche se fait sur l'empreinte : aucun secret n'est comparé en mémoire, donc pas
   * de question de comparaison en temps constant. Un jeton consommé ou expiré rend `null`
   * exactement comme un jeton inventé — l'appelant n'a qu'un seul cas d'échec à traiter,
   * et ne peut pas distinguer les trois par la réponse.
   */
  async findPending(token: string): Promise<UserInvitation | null> {
    const invitation = await UserInvitation.findBy('token_hash', this.#hash(token))
    if (!invitation || !invitation.isPending) return null
    return invitation
  }

  /**
   * Ce compte n'a-t-il **jamais** servi ?
   *
   * Vrai quand une invitation lui a été émise et qu'**aucune** n'a été consommée : son mot de
   * passe est donc toujours celui, inutilisable, posé à la création — personne n'a jamais pu
   * s'y connecter, et rien ne peut y être rattaché.
   *
   * ⚠️ **C'est la seule condition sous laquelle un compte se supprime** (voir
   * `AdminUsersController.destroy`). Le ticket CC-71 tranchait « désactiver, jamais
   * supprimer », parce qu'une suppression poserait la question des données rattachées le jour
   * où il y en aura (CC-70 prévoit une progression Leitner par personne). Un compte jamais
   * utilisé échappe à cette question — aujourd'hui comme après CC-72.
   *
   * ⚠️ **Exiger qu'une invitation existe n'est pas un détail.** Le compte seedé
   * (`admin@bstenger.fr`) n'en a aucune et possède pourtant un vrai mot de passe : un critère
   * « aucune invitation consommée » le rendrait supprimable. Ici, l'absence totale
   * d'invitation rend `false`.
   */
  async hasNeverBeenUsed(user: User): Promise<boolean> {
    const invitations = await UserInvitation.query().where('user_id', user.id)
    if (invitations.length === 0) return false
    return invitations.every((one) => one.usedAt === null)
  }

  /** Marque l'invitation comme consommée. Le mot de passe est posé par l'appelant. */
  async consume(invitation: UserInvitation): Promise<void> {
    invitation.usedAt = DateTime.now()
    await invitation.save()
  }

  /**
   * Le mot de passe d'un compte qui n'en a pas encore.
   *
   * ⚠️ On ne rend pas `users.password` nullable : `verifyCredentials` passerait alors `null`
   * à `hash.verify` et le formulaire de connexion rendrait une **500** au lieu de
   * « identifiants invalides ». On pose 32 octets aléatoires qu'aucune saisie ne peut
   * satisfaire ; l'état « invitation en attente » se lit sur `user_invitations`, pas ici.
   */
  unusablePassword(): string {
    return randomBytes(32).toString('hex')
  }
}

export default new InvitationService()
