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
import { SERVICES_DESTINATIONS } from '#modules/services/destinations'
import { AGENTS_DESTINATIONS } from '#modules/agents/destinations'
import { VEILLE_DESTINATIONS } from '#modules/veille/destinations'
import { LEITNER_DESTINATIONS } from '#modules/leitner/destinations'

registry.register('dashboard', DASHBOARD_DESTINATIONS)
registry.register('services', SERVICES_DESTINATIONS)
registry.register('agents', AGENTS_DESTINATIONS)
registry.register('veille', VEILLE_DESTINATIONS)
registry.register('leitner', LEITNER_DESTINATIONS)
