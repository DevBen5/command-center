/*
|--------------------------------------------------------------------------
| Enregistrement des destinations
|--------------------------------------------------------------------------
|
| Chaque module déclare ses propres destinations dans son `destinations.ts`. Ce fichier ne
| fait que les rassembler au démarrage : il connaît la liste des **modules**, jamais celle
| des écrans. C'est le même partage des rôles que `start/capabilities.ts`.
|
| ⚠️ **L'ordre de ce fichier est l'ordre de la barre latérale ET la page d'accueil des
| comptes.** Après connexion, après acceptation d'invitation, et quand un compte déjà
| connecté rouvre `/login`, on redirige vers la **première** destination de cette liste que
| le compte peut ouvrir. Déplacer une ligne ici change donc l'écran d'arrivée de tous les
| comptes concernés — c'est voulu, et c'est le seul endroit où ça se décide.
|
| ⚠️ Un module oublié ici ne casse rien tout de suite : son entrée disparaît de la barre, et
| un compte qui n'aurait de droits que sur lui atterrit sur « aucun accès » alors qu'il a bien
| des accès. Ça ferme au lieu d'ouvrir — mais c'est mensonger, et
| `tests/functional/core/navigation_registry.spec.ts` asserte la liste attendue pour l'attraper.
|
| Services et Agents n'ont volontairement aucune capacité : leurs destinations sont marquées
| `admin`, et aucun rôle ne peut donc les ouvrir. Voir `start/capabilities.ts`.
|
*/

import registry from '#core/shared/navigation/registry'
import { DASHBOARD_DESTINATIONS } from '#core/dashboard/destinations'
import modules from '#config/modules'

registry.register('dashboard', DASHBOARD_DESTINATIONS)

// ⚠️ Un `await import()` par module, conditionné par `MODULES` (CC-137) : un module
// désactivé n'enregistre pas sa destination, exactement comme s'il avait été oublié ici
// avant ce lot — `navigation_registry.spec.ts` continue de l'attraper.
if (modules.has('services')) {
  const { SERVICES_DESTINATIONS } = await import('#modules/services/destinations')
  registry.register('services', SERVICES_DESTINATIONS)
}

if (modules.has('agents')) {
  const { AGENTS_DESTINATIONS } = await import('#modules/agents/destinations')
  registry.register('agents', AGENTS_DESTINATIONS)
}

if (modules.has('veille')) {
  const { VEILLE_DESTINATIONS } = await import('#modules/veille/destinations')
  registry.register('veille', VEILLE_DESTINATIONS)
}

if (modules.has('leitner')) {
  const { LEITNER_DESTINATIONS } = await import('#modules/leitner/destinations')
  registry.register('leitner', LEITNER_DESTINATIONS)
}
