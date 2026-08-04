/**
 * La règle de longueur d'un mot de passe, choisie par `acceptInvitationValidator`
 * (`validators/auth.ts`) — celle que rencontre l'utilisateur, à l'invitation comme au
 * changement de mot de passe (CC-147). Le seeder et `commands/reset_account.ts` la relisent
 * ici plutôt que de la recopier (CC-138) : sans cette source unique, aucun test ne rougirait
 * si le validateur changeait pendant que les portes de service continueraient d'accepter ce
 * que le formulaire refuse.
 */
export const MIN_PASSWORD_LENGTH = 12
export const MAX_PASSWORD_LENGTH = 180
