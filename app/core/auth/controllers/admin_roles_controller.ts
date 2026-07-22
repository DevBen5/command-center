import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import Role from '#core/auth/models/role'
import RoleCapability from '#core/auth/models/role_capability'
import User from '#core/auth/models/user'
import registry from '#core/auth/capabilities/registry'
import { roleValidator } from '#core/auth/validators/admin'

export default class AdminRolesController {
  async index({ inertia }: HttpContext) {
    const roles = await Role.query().preload('capabilities').orderBy('name', 'asc')
    const counts = await User.query()
      .whereNotNull('role_id')
      .count('* as total')
      .groupBy('role_id')
      .select('role_id')

    const usersByRole = new Map(
      counts.map((row) => [Number(row.$extras.role_id), Number(row.$extras.total)])
    )

    return inertia.render('core/auth/admin/roles', {
      roles: roles.map((role) => ({
        id: role.id,
        name: role.name,
        capabilities: role.capabilities.map((one) => one.capability),
        userCount: usersByRole.get(role.id) ?? 0,
      })),
      // Le catalogue vient du registre, donc du code de chaque module : l'écran ne peut
      // proposer que des capacités qui existent réellement.
      catalog: registry.byModule(),
    })
  }

  async store({ request, response }: HttpContext) {
    const payload = await request.validateUsing(roleValidator)

    await db.transaction(async (trx) => {
      const role = await Role.create({ name: payload.name }, { client: trx })
      await this.#replaceCapabilities(role.id, payload.capabilities, trx)
    })

    return response.redirect('/admin/roles')
  }

  async update({ request, response, params }: HttpContext) {
    const role = await Role.findOrFail(params.id)
    const payload = await request.validateUsing(roleValidator)

    // Une transaction, parce que l'état intermédiaire est un rôle **sans aucune capacité** :
    // sans elle, une requête concurrente pourrait tomber dessus et se voir tout refuser.
    await db.transaction(async (trx) => {
      role.useTransaction(trx)
      role.name = payload.name
      await role.save()
      await this.#replaceCapabilities(role.id, payload.capabilities, trx)
    })

    return response.redirect('/admin/roles')
  }

  async destroy({ response, params }: HttpContext) {
    const role = await Role.findOrFail(params.id)

    // Les utilisateurs qui le portaient repassent à `role_id = null` (contrainte
    // `ON DELETE SET NULL`), donc **sans aucune capacité**. Supprimer un rôle ferme
    // des accès, il n'en ouvre jamais : c'est le bon sens du défaut.
    await role.delete()

    return response.redirect('/admin/roles')
  }

  async #replaceCapabilities(
    roleId: number,
    capabilities: string[],
    trx: TransactionClientContract
  ) {
    await RoleCapability.query({ client: trx }).where('role_id', roleId).delete()
    if (capabilities.length === 0) return

    await RoleCapability.createMany(
      capabilities.map((capability) => ({ roleId, capability })),
      { client: trx }
    )
  }
}
