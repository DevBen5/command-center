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
import { VEILLE_CAPABILITIES } from '#modules/veille/capabilities'
import { LEITNER_CAPABILITIES } from '#modules/leitner/capabilities'

registry.register('dashboard', DASHBOARD_CAPABILITIES)
registry.register('veille', VEILLE_CAPABILITIES)
registry.register('leitner', LEITNER_CAPABILITIES)
