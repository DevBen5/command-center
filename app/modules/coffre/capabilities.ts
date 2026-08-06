/**
 * Les capacités du module Coffre (CC-178).
 *
 * ⚠️ **Elles ne suffisent à rien toutes seules, et c'est le point du module.** Une capacité ouvre
 * la porte ; l'élévation de session (`vault_unlocked_middleware`) ouvre le mur. Un compte qui
 * porte `coffre.view` sans avoir ouvert le coffre reçoit un 403 sur chaque route murée, `curl`
 * muni d'un cookie de session parfaitement valide compris.
 *
 * `coffre.view` couvre la porte (`/coffre/ouvrir`, la création du coffre, le verrouillage) **et**
 * la lecture du contenu. Les deux vont ensemble : ouvrir un coffre qu'on n'aurait pas le droit de
 * lire n'a pas de sens, et l'inverse non plus.
 *
 * `coffre.write` est séparée pour la raison habituelle du dépôt — voir `leitner.cards.write` :
 * consulter n'est pas écrire, et un compte peut légitimement avoir l'un sans l'autre.
 */
export const COFFRE_CAPABILITIES = ['coffre.view', 'coffre.write'] as const
