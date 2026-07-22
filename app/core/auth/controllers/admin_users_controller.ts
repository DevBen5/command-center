import type { HttpContext } from '@adonisjs/core/http'
import User from '#core/auth/models/user'
import Role from '#core/auth/models/role'
import UserCapability from '#core/auth/models/user_capability'
import UserInvitation from '#core/auth/models/user_invitation'
import registry from '#core/auth/capabilities/registry'
import capabilityService from '#core/auth/services/capability_service'
import invitationService from '#core/auth/services/invitation_service'
import {
  createUserValidator,
  updateUserValidator,
  userCapabilitiesValidator,
} from '#core/auth/validators/admin'

export default class AdminUsersController {
  async index({ inertia }: HttpContext) {
    const users = await User.query().preload('role').orderBy('full_name', 'asc')
    const pending = await UserInvitation.query().whereNull('used_at')
    const pendingUserIds = new Set(pending.filter((one) => one.isPending).map((one) => one.userId))

    return inertia.render('core/auth/admin/users', {
      users: users.map((user) => ({
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        isAdmin: user.isAdmin,
        isActive: user.isActive,
        role: user.role ? { id: user.role.id, name: user.role.name } : null,
        awaitingInvitation: pendingUserIds.has(user.id),
      })),
      roles: await this.#roleOptions(),
    })
  }

  async show({ inertia, params, auth }: HttpContext) {
    const user = await User.findOrFail(params.id)
    await user.load('role')

    const overrides = await UserCapability.query().where('user_id', user.id)
    const fromRole = await capabilityService.capabilitiesOf(user)
    const invitation = await UserInvitation.query()
      .where('user_id', user.id)
      .whereNull('used_at')
      .orderBy('id', 'desc')
      .first()

    return inertia.render('core/auth/admin/user_show', {
      // ⚠️ **`account`, surtout pas `user`.** `config/inertia.ts` partage une prop `user` qui
      // désigne l'utilisateur **connecté**, et dont `AppLayout` se sert pour décider ce que la
      // barre latérale affiche. Une prop de page du même nom l'écrase : le layout croirait
      // alors être connecté en tant que la personne affichée, et lirait un objet qui n'a pas
      // la même forme (`capabilities` absent) — page blanche.
      //
      // Ça n'apparaissait que sur un compte **non-admin** : pour un admin, `isAdmin` court-
      // circuite le test avant que `capabilities` ne soit lu. D'où un écran qui marchait sur
      // sa propre fiche et tombait sur celle des autres.
      account: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        isAdmin: user.isAdmin,
        isActive: user.isActive,
        roleId: user.roleId,
        // Les capacités réellement en vigueur : rôle + surcharges. `is_admin` n'y figure
        // pas — un admin passe outre la vérification, il n'a pas « toutes les capacités ».
        effective: [...fromRole],
      },
      overrides: overrides.map((one) => ({ capability: one.capability, granted: one.granted })),
      roles: await this.#roleOptions(),
      catalog: registry.byModule(),
      // Le lien lui-même n'est pas ici : il ne s'obtient que par un appel explicite.
      invitation: invitation?.isPending
        ? { expiresAt: invitation.expiresAt.toISO(), issuedAt: invitation.createdAt.toISO() }
        : null,
      // Le bouton de suppression n'apparaît que là où il aboutirait. Le serveur revérifie
      // de toute façon — masquer un bouton n'a jamais fermé une route.
      deletable: user.id !== auth.user!.id && (await invitationService.hasNeverBeenUsed(user)),
    })
  }

  async store({ request, response }: HttpContext) {
    const payload = await request.validateUsing(createUserValidator)

    const user = await User.create({
      fullName: payload.fullName,
      email: payload.email,
      // ⚠️ Aucun mot de passe choisi par l'administrateur, et aucun mot de passe affiché :
      // le compte naît avec un secret inutilisable et son porteur se le donne lui-même
      // par le lien d'invitation.
      password: invitationService.unusablePassword(),
      roleId: payload.roleId ?? null,
      isAdmin: payload.isAdmin ?? false,
      isActive: true,
    })

    await invitationService.issueFor(user)

    return response.redirect(`/admin/users/${user.id}`)
  }

  async update({ request, response, params, auth }: HttpContext) {
    const user = await User.findOrFail(params.id)
    const payload = await request.validateUsing(updateUserValidator)
    const nextIsAdmin = payload.isAdmin

    // ⚠️ Un administrateur ne peut pas se retirer son propre `is_admin` : plus personne ne
    // pourrait le lui rendre depuis l'application, et la réparation ne se ferait qu'en SQL.
    if (user.id === auth.user!.id && user.isAdmin && !nextIsAdmin) {
      return response.badRequest({ error: 'Un administrateur ne peut pas se retirer ce droit.' })
    }

    user.fullName = payload.fullName
    user.roleId = payload.roleId ?? null
    user.isAdmin = nextIsAdmin
    await user.save()

    return response.redirect(`/admin/users/${user.id}`)
  }

  async updateCapabilities({ request, response, params }: HttpContext) {
    const user = await User.findOrFail(params.id)
    const { overrides } = await request.validateUsing(userCapabilitiesValidator)

    // Remplacement complet : l'écran envoie l'état voulu, pas un différentiel. Une surcharge
    // absente de l'envoi disparaît, et la capacité retombe sur ce que dit le rôle.
    await UserCapability.query().where('user_id', user.id).delete()
    if (overrides.length > 0) {
      await UserCapability.createMany(
        overrides.map((one) => ({
          userId: user.id,
          capability: one.capability,
          granted: one.granted,
        }))
      )
    }

    return response.redirect(`/admin/users/${user.id}`)
  }

  async toggleActivation({ response, params, auth }: HttpContext) {
    const user = await User.findOrFail(params.id)

    // ⚠️ Même raison que plus haut : se désactiver soi-même est un verrouillage sans retour.
    if (user.id === auth.user!.id) {
      return response.badRequest({ error: 'On ne peut pas désactiver son propre compte.' })
    }

    user.isActive = !user.isActive
    await user.save()

    return response.redirect(`/admin/users/${user.id}`)
  }

  /**
   * Supprime un compte — **uniquement s'il n'a jamais servi**.
   *
   * ⚠️ CC-71 tranchait « désactiver, jamais supprimer », et la raison reste valable : une
   * suppression pose la question des données rattachées, et CC-70 prévoit une progression
   * Leitner par personne. Ce qui manquait à cette règle, c'est le compte créé avec une faute
   * de frappe : le désactiver ne le nettoie pas, il encombre la liste pour toujours.
   *
   * D'où la restriction — un compte dont l'invitation n'a jamais été consommée n'a **jamais
   * pu se connecter**, donc ne peut rien avoir produit, ni maintenant ni après CC-72. Le
   * refus par défaut vaut ici aussi : ce qui n'est pas manifestement inutilisé est conservé.
   *
   * Les lignes de `user_capabilities` et `user_invitations` partent avec, par leur
   * `ON DELETE CASCADE` — elles n'existent que pour ce compte.
   */
  async destroy({ response, params, auth }: HttpContext) {
    const user = await User.findOrFail(params.id)

    if (user.id === auth.user!.id) {
      return response.badRequest({ error: 'On ne peut pas supprimer son propre compte.' })
    }

    if (!(await invitationService.hasNeverBeenUsed(user))) {
      return response.badRequest({
        error:
          'Ce compte a déjà servi : il se désactive, il ne se supprime pas. ' +
          'Seul un compte dont l’invitation n’a jamais été utilisée peut être supprimé.',
      })
    }

    await user.delete()

    return response.redirect('/admin/users')
  }

  /**
   * Rend le lien d'invitation **en JSON, une seule fois**, et révoque le précédent.
   *
   * ⚠️ Pas de message flash : `SESSION_DRIVER` vaut `cookie`, un flash partirait chez le
   * client. Pas de journalisation non plus. Le lien n'existe que dans cette réponse.
   *
   * ⚠️ **Sur un compte qui a déjà son mot de passe, ceci le réinitialise de fait** : le lien
   * permet d'en poser un nouveau. C'est le « mot de passe oublié » du projet — il n'y a pas
   * d'envoi d'e-mail ici, donc pas d'autre chemin. Ce n'est pas une élévation de privilège
   * (un administrateur peut déjà tout faire), mais l'écran doit le dire, et il le dit.
   */
  async issueInvitation({ response, params }: HttpContext) {
    const user = await User.findOrFail(params.id)
    const token = await invitationService.issueFor(user)

    // Un **chemin**, pas une URL absolue : la page la préfixe avec son propre `origin`.
    // Reconstruire l'origine côté serveur obligerait à faire confiance aux en-têtes
    // `X-Forwarded-*` du reverse proxy, et un lien d'invitation pointant vers un hôte
    // dicté par un en-tête de requête est exactement ce qu'on ne veut pas fabriquer.
    return response.ok({ path: `/invitation/${token}` })
  }

  async #roleOptions() {
    const roles = await Role.query().orderBy('name', 'asc')
    return roles.map((role) => ({ id: role.id, name: role.name }))
  }
}
