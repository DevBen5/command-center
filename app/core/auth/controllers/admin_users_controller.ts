import type { HttpContext } from '@adonisjs/core/http'
import User from '#core/auth/models/user'
import Role from '#core/auth/models/role'
import UserCapability from '#core/auth/models/user_capability'
import UserInvitation from '#core/auth/models/user_invitation'
import registry from '#core/auth/capabilities/registry'
import capabilityService from '#core/auth/services/capability_service'
import invitationService from '#core/auth/services/invitation_service'
import twoFactor from '#core/auth/services/two_factor_service'
import modules from '#config/modules'
import { ownedSharedContentTable } from '#modules/leitner/services/leitner_account_deletion_guard'
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
        // ⚠️ L'**état** du second facteur, jamais le secret ni un code (CC-114). Un
        // administrateur a besoin de savoir si ce compte est protégé et s'il lui reste des
        // codes ; lui montrer de quoi s'y connecter serait une autre affaire.
        twoFactor: {
          enabled: user.hasTotp,
          remainingCodes: user.hasTotp ? await twoFactor.remainingRecoveryCodes(user) : 0,
        },
      },
      overrides: overrides.map((one) => ({ capability: one.capability, granted: one.granted })),
      roles: await this.#roleOptions(),
      catalog: registry.byModule(),
      // Le lien lui-même n'est pas ici : il ne s'obtient que par un appel explicite.
      invitation: invitation?.isPending
        ? { expiresAt: invitation.expiresAt.toISO(), issuedAt: invitation.createdAt.toISO() }
        : null,
      // Le bouton de suppression n'apparaît que là où il aboutirait. **Mêmes prédicats que
      // `destroy`** — sinon l'UI proposerait une action que le serveur refuse (ou l'inverse) :
      // pas soi-même, et pas le dernier administrateur actif. Le serveur revérifie de toute
      // façon — masquer un bouton n'a jamais fermé une route.
      deletable:
        user.id !== auth.user!.id && !(user.isAdmin && !(await this.#otherActiveAdminExists(user))),
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
   * Supprime un compte — dès lors qu'il n'a **aucune dépendance bloquante** (CC-80, revu
   * par CC-139).
   *
   * CC-71 tranchait « désactiver, jamais supprimer » par anticipation de données rattachées.
   * Vérification faite (CC-80), les seules références directes à `users.id` hors contenu —
   * `user_capabilities`, `user_invitations` — sont en `ON DELETE CASCADE` et n'existent que
   * pour ce compte.
   *
   * ⚠️ **Ce n'est plus vrai du contenu Leitner depuis CC-139**, et c'est le changement le
   * plus significatif du lot : `leitner_cards`, `leitner_categories`, `leitner_themes` et
   * `leitner_ingestions` portent désormais un `owner_id`. La sûreté ne vient donc plus du
   * **schéma seul** (CC-77) mais d'une combinaison : la FK est en `ON DELETE SET NULL` — le
   * contenu **survit toujours**, jamais de CASCADE dessus — et ce contrôleur refuse la
   * suppression tant que le compte possède encore du contenu **partagé** (`is_shared =
   * true`). Le contenu **privé** restant, lui, ne bloque jamais : il devient orphelin
   * (`owner_id = null`), visible du seul administrateur — voir le `CLAUDE.md` du module
   * Leitner pour le détail complet de l'arbitrage.
   *
   * ⚠️ **Aucune impasse** : le propriétaire (ou un admin, qui peut éditer tout contenu)
   * peut décocher « Partagé » sur ses cartes/catégories/thèmes/ingestions avant de
   * supprimer le compte — voir `ownedSharedContentTable`. Aucune fonctionnalité de
   * transfert de propriété n'est nécessaire.
   *
   * Restent, comme avant, deux verrous « sans retour » — ce qu'ils ferment ne se rouvre
   * qu'en SQL :
   *
   * - **le dernier administrateur actif** ne se supprime pas — sinon plus personne n'atteint
   *   l'administration. On le vérifie **avant** « pas soi-même » : c'est l'invariant le plus
   *   fort, et le seul cas où il mord aujourd'hui est l'unique admin qui se supprime — d'où
   *   ce message plutôt que celui du self-delete. Il reste un garde-fou : il tiendra le jour
   *   où la route ne serait plus réservée aux admins.
   * - **son propre compte** ne se supprime pas (verrouillage sans retour, comme la
   *   désactivation de soi).
   *
   * ⚠️ Compter les admins **actifs**, pas le total : ne laisser qu'un admin *désactivé*
   * derrière soi fermerait l'accès tout autant.
   */
  async destroy({ response, params, auth }: HttpContext) {
    const user = await User.findOrFail(params.id)

    if (user.isAdmin && !(await this.#otherActiveAdminExists(user))) {
      return response.badRequest({
        error: 'Impossible de supprimer le dernier administrateur actif.',
      })
    }

    if (user.id === auth.user!.id) {
      return response.badRequest({ error: 'On ne peut pas supprimer son propre compte.' })
    }

    // ⚠️ `modules.has(...)`, pas `isModuleEnabled` importé séparément — même patron que
    // `HomeController`/`NavStatsService` (CLAUDE.md racine, point 7) : un module éteint
    // n'a pas sa migration jouée, la requête planterait sur une table absente.
    if (modules.has('leitner')) {
      const blockingTable = await ownedSharedContentTable(user.id)
      if (blockingTable) {
        return response.badRequest({
          error:
            `Ce compte possède encore du contenu Leitner partagé (${blockingTable}). ` +
            `Décochez « Partagé » sur ce contenu — le propriétaire ou un administrateur ` +
            `peut le faire depuis /revision/settings — avant de supprimer le compte.`,
        })
      }
    }

    await user.delete()

    return response.redirect('/admin/users')
  }

  /**
   * Retire le second facteur d'un compte (CC-114).
   *
   * ⚠️ **C'est la seule porte quand le téléphone ET les codes de secours ont disparu**, et
   * c'est pour ça qu'elle existe : sans elle, la seule réparation serait un `UPDATE` en SQL.
   * Elle ne vaut pas élévation de privilège — un administrateur peut déjà réémettre une
   * invitation, donc reposer le mot de passe de n'importe qui (voir `issueInvitation`).
   *
   * ⚠️ **Aucun verrou « pas le dernier admin » ici**, contrairement à la suppression et à la
   * désactivation : retirer un second facteur n'enlève l'accès à personne, ça le rend
   * seulement plus simple. Le compte visé reste entier, et se réenrôle depuis son écran de
   * sécurité — sous la contrainte de `ADMIN_2FA_REQUIRED` s'il est administrateur.
   */
  async resetTwoFactor({ response, params, logger }: HttpContext) {
    const user = await User.findOrFail(params.id)

    await twoFactor.disable(user)

    // Le dépôt n'a pas de journal d'audit ; une ligne de log est le seul endroit où ce geste
    // laisse une trace. L'identifiant, jamais l'email : les journaux se lisent à plusieurs.
    logger.info({ userId: user.id }, 'Second facteur réinitialisé par un administrateur')

    return response.redirect(`/admin/users/${user.id}`)
  }

  /** Existe-t-il un **autre** administrateur actif que celui-ci ? */
  async #otherActiveAdminExists(user: User): Promise<boolean> {
    const other = await User.query()
      .where('is_admin', true)
      .where('is_active', true)
      .whereNot('id', user.id)
      .first()

    return other !== null
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
