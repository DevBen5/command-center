/*
|--------------------------------------------------------------------------
| Enregistrement des capacités
|--------------------------------------------------------------------------
|
| Chaque module déclare ses propres capacités dans son `capabilities.ts`. Ce fichier ne
| fait que les rassembler au démarrage : il connaît la liste des **modules**, jamais celle
| des actions. C'est le même partage des rôles que `config/database.ts` avec les migrations.
|
| ⚠️ Un module oublié ici va vers le refus, pas vers l'ouverture : ses capacités n'entrent
| pas au registre, donc l'écran d'administration ne les propose pas, donc personne ne peut
| les accorder — et le test d'énumération des routes rougit sur les routes qui les citent.
|
| Services et Agents n'ont volontairement aucune capacité : ils sont réservés à `is_admin`,
| et c'est le seul chemin. Leur donner des capacités permettrait à un rôle d'y ouvrir
| l'accès, alors que ces deux modules exécutent des commandes sur la machine hôte.
|
*/

import registry from '#core/auth/capabilities/registry'
import { DASHBOARD_CAPABILITIES } from '#core/dashboard/capabilities'
import modules from '#config/modules'

registry.register('dashboard', DASHBOARD_CAPABILITIES)

// ⚠️ Services et Agents n'ont pas de capabilities.ts (voir plus haut) : rien à conditionner
// pour eux. Veille et Leitner passent par un `await import()` — un module désactivé (CC-137)
// n'entre donc pas au registre, exactement comme s'il avait été oublié ici avant ce lot.
if (modules.has('veille')) {
  const { VEILLE_CAPABILITIES } = await import('#modules/veille/capabilities')
  registry.register('veille', VEILLE_CAPABILITIES)
}

if (modules.has('leitner')) {
  const { LEITNER_CAPABILITIES } = await import('#modules/leitner/capabilities')
  registry.register('leitner', LEITNER_CAPABILITIES)
}

// ⚠️ **Le coffre enregistre bien ses capacités** (CC-178), contrairement à ce qu'on pourrait
// déduire de son absence de `start/navigation.ts` : le rideau ne concerne que la **navigation**.
// Sans cette ligne, ses routes citeraient des capacités inconnues du registre — donc fermées à
// tout non-admin, sans que `is_admin` s'en aperçoive, et `capabilities_routes.spec.ts` rougirait.
if (modules.has('coffre')) {
  const { COFFRE_CAPABILITIES } = await import('#modules/coffre/capabilities')
  registry.register('coffre', COFFRE_CAPABILITIES)
}
