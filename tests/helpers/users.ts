import User from '#core/auth/models/user'
import Role from '#core/auth/models/role'
import RoleCapability from '#core/auth/models/role_capability'

/**
 * Fabriques de comptes pour les tests.
 *
 * ⚠️ **Pourquoi `createUserWith` plutôt que « tout le monde est admin ».** Depuis CC-71,
 * un compte nu n'a accès à rien : les suites qui créaient un `User.create()` et attendaient
 * un 200 échoueraient toutes. La correction facile serait de les passer `isAdmin: true` —
 * et alors plus aucun test métier ne traverserait la vérification de capacité, qui
 * pourrait casser sans que rien ne rougisse.
 *
 * Chaque suite déclare donc les capacités dont son module a besoin. Un renommage de
 * capacité ou une route mal déclarée fait échouer la suite du module concerné, là où on
 * la lira. `createAdmin()` est réservé à ce qui est réellement réservé aux
 * administrateurs : Services, Agents et l'écran d'administration.
 */

let sequence = 0

function nextEmail(): string {
  sequence += 1
  return `test-${sequence}@example.com`
}

/** Un compte administrateur : passe outre toute capacité. */
export async function createAdmin(): Promise<User> {
  return User.create({
    fullName: 'Administrateur Test',
    email: nextEmail(),
    password: 'secret123',
    isAdmin: true,
    isActive: true,
  })
}

/** Un compte non-admin porteur exactement des capacités demandées, via un rôle dédié. */
export async function createUserWith(capabilities: string[]): Promise<User> {
  sequence += 1
  const role = await Role.create({ name: `Rôle test ${sequence}` })

  if (capabilities.length > 0) {
    await RoleCapability.createMany(
      capabilities.map((capability) => ({ roleId: role.id, capability }))
    )
  }

  return User.create({
    fullName: 'Utilisateur Test',
    email: nextEmail(),
    password: 'secret123',
    isAdmin: false,
    isActive: true,
    roleId: role.id,
  })
}

/** Un compte non-admin sans rôle ni surcharge : il n'a accès à rien, et c'est le défaut. */
export async function createUserWithoutAccess(): Promise<User> {
  return createUserWith([])
}
