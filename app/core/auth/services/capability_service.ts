import type { HttpContext } from '@adonisjs/core/http'
import type User from '#core/auth/models/user'
import RoleCapability from '#core/auth/models/role_capability'
import UserCapability from '#core/auth/models/user_capability'

/**
 * La résolution des droits d'un utilisateur.
 *
 * L'ordre est fixe et il n'a qu'une lecture possible :
 *
 * 1. compte désactivé → refus, quoi qu'il porte par ailleurs ;
 * 2. `is_admin` → accord, sans consulter la moindre liste ;
 * 3. sinon : les capacités du rôle, **puis** les surcharges de l'utilisateur, qui
 *    l'emportent dans les deux sens (accorder comme retirer) ;
 * 4. tout le reste → refus.
 *
 * ⚠️ Le point 4 est l'invariant du lot, et c'est le seul qu'il ne faut jamais retourner
 * « pour simplifier ». Une capacité inconnue — celle d'un module écrit dans six mois, ou
 * une chaîne inventée à l'instant — tombe dedans **sans qu'aucune ligne ne l'ait interdite**.
 * Un modèle par exclusion aurait la propriété inverse : chaque ajout ouvrirait une porte,
 * et il faudrait s'en souvenir à chaque fois.
 */
class CapabilityService {
  /**
   * Les capacités effectivement accordées à cet utilisateur : rôle + surcharges.
   *
   * ⚠️ Ne tient **pas** compte de `is_admin` : un admin n'a pas « toutes les capacités »,
   * il passe outre la vérification. La distinction compte — sinon il faudrait matérialiser
   * quelque part la liste de tout, et la tenir à jour à chaque ajout.
   */
  async capabilitiesOf(user: User): Promise<Set<string>> {
    const granted = new Set<string>()

    // Les deux absences comptent : une instance qu'on vient de créer sans lui passer
    // `roleId` porte `undefined`, là où une instance rechargée depuis la base porte `null`.
    // Ne tester que `null` laisserait `undefined` filer jusqu'au `where`, qui le refuse.
    if (user.roleId !== null && user.roleId !== undefined) {
      const fromRole = await RoleCapability.query().where('role_id', user.roleId)
      for (const one of fromRole) granted.add(one.capability)
    }

    const overrides = await UserCapability.query().where('user_id', user.id)
    for (const one of overrides) {
      if (one.granted) granted.add(one.capability)
      else granted.delete(one.capability)
    }

    return granted
  }

  /** Cet utilisateur peut-il faire cette action ? */
  async allows(user: User, capability: string): Promise<boolean> {
    if (!user.isActive) return false
    if (user.isAdmin) return true

    const granted = await this.capabilitiesOf(user)
    return granted.has(capability)
  }
}

const capabilityService = new CapabilityService()
export default capabilityService

/**
 * Les capacités de l'utilisateur de la requête courante, chargées **une seule fois**.
 *
 * Trois appelants les veulent sur une même requête (le middleware `can`, le partage Inertia,
 * les compteurs de la barre latérale) ; sans cette mémoïsation, chacun rejouerait les deux
 * requêtes SQL. Le cache est porté par le contexte HTTP, donc il meurt avec la requête :
 * une modification des droits est prise en compte à la requête suivante, jamais après un
 * délai qu'il faudrait deviner.
 */
const perRequest = new WeakMap<HttpContext, Set<string>>()

export async function capabilitiesFor(ctx: HttpContext): Promise<Set<string>> {
  const cached = perRequest.get(ctx)
  if (cached) return cached

  const user = ctx.auth?.user
  const granted =
    user && user.isActive ? await capabilityService.capabilitiesOf(user) : new Set<string>()

  perRequest.set(ctx, granted)
  return granted
}
