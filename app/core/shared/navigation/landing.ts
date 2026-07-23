import type User from '#core/auth/models/user'
import navigation from '#core/shared/navigation/registry'
import capabilityService from '#core/auth/services/capability_service'

/** L'écran d'un compte actif à qui aucun droit n'a encore été attribué. */
export const NO_ACCESS_URL = '/aucun-acces'

/**
 * Où envoyer ce compte quand aucune page n'a été demandée.
 *
 * ⚠️ **Les trois portes de l'application redirigeaient vers `/` en dur** — connexion,
 * acceptation d'invitation, et compte déjà connecté rouvrant `/login`. Or `/` exige
 * `dashboard.view` : un collègue sans cette capacité recevait `{"error":"Accès refusé."}`
 * comme tout premier écran, juste après avoir choisi son mot de passe (CC-81).
 *
 * ⚠️ **On relit les capacités en base plutôt que de passer par `capabilitiesFor(ctx)`.** Ce
 * dernier mémoïse par requête, et deux de ces appels arrivent **après** un `auth.login()` : un
 * cache rempli plus tôt dans la même requête, quand l'utilisateur n'était pas encore connu,
 * contiendrait un ensemble vide — et l'atterrissage enverrait sur « aucun accès » un compte
 * qui a des droits, sans erreur ni journal. Une requête SQL par connexion est le bon prix.
 *
 * Un administrateur n'en déclenche même pas une : il passe outre les capacités, il n'en porte
 * aucune (voir `CapabilityService`).
 *
 * ⚠️ **Elle ne rend JAMAIS `/login`.** `guest_middleware` l'appelle depuis `/login` même : y
 * renvoyer boucherait indéfiniment. Un compte désactivé tombe donc sur `NO_ACCESS_URL`, et
 * c'est `auth_middleware` qui le déconnecte à cette requête-là — le chemin qui existait déjà.
 */
export async function landingUrlFor(user: User): Promise<string> {
  if (!user.isActive) return NO_ACCESS_URL

  const capabilities = user.isAdmin
    ? new Set<string>()
    : await capabilityService.capabilitiesOf(user)

  return navigation.landingFor({ isAdmin: user.isAdmin, capabilities })?.href ?? NO_ACCESS_URL
}
