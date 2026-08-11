/**
 * La borne de transcodages simultanés (CC-241) — un compteur en **mémoire du process**, sur le
 * patron d'`immich_session_state.ts` et de `vault_keyring.ts`.
 *
 * ⚠️ **L'état vit ici, dans un singleton de module, PAS sur le service.** `VideoTranscoder` est
 * résolu par le conteneur IoC, donc reconstruit à chaque injection : un compteur porté par
 * l'instance repartirait à zéro à chaque requête et ne bornerait donc **rien du tout**, sans que
 * rien ne le signale — la classe de défaut la plus coûteuse de ce dépôt (un mécanisme qui paraît
 * en place et n'a aucun effet).
 *
 * ⚠️ **Pourquoi une borne, et pourquoi si basse.** Un ré-encodage logiciel 4K sature les quatre
 * cœurs d'un Celeron J3455 (la cible de déploiement réelle, cf. le ticket) : deux lectures
 * concurrentes suffisent à mettre la machine à genoux, et la troisième ne dégrade pas — elle rend
 * les trois injouables. Refuser proprement la troisième vaut mieux que les servir toutes mal.
 *
 * ⚠️ **Même hypothèse mono-instance que le trousseau du coffre** : à plusieurs processus, chacun
 * porterait sa propre borne. C'est la même hypothèse que fait déjà tout le module (la clé du coffre
 * vit en mémoire), pas une nouvelle.
 */

/**
 * ⚠️ **Le ré-empaquetage (`remux`) compte aussi**, alors qu'il ne ré-encode rien. Il coûte peu de
 * CPU mais il tient un processus et un tube ouverts pour toute la durée de la lecture : ne pas le
 * compter laisserait un nombre non borné de processus vivre en parallèle, ce qui est l'autre moitié
 * du problème que cette borne existe pour fermer.
 */
export const MAX_TRANSCODAGES_SIMULTANES = 2

let enCours = 0

/**
 * Réserve un créneau — `false` si la borne est déjà atteinte. L'appelant DOIT alors répondre au
 * client plutôt que d'attendre : une file d'attente sur une requête HTTP de vidéo se traduirait par
 * un lecteur figé sans message, ce qui est exactement l'échec muet qu'on cherche à supprimer.
 */
export function reserverCreneau(): boolean {
  if (enCours >= MAX_TRANSCODAGES_SIMULTANES) return false
  enCours += 1
  return true
}

/**
 * Rend un créneau.
 *
 * ⚠️ **Idempotent par construction (`Math.max(0, …)`)**, et ce n'est pas de la coquetterie : le
 * créneau est rendu depuis la terminaison du processus ET depuis la fermeture de la réponse HTTP,
 * deux événements qui arrivent tous les deux, dans un ordre non garanti. Sans cette borne basse, un
 * double relâchement rendrait le compteur négatif et la borne cesserait d'exister.
 */
export function libererCreneau(): void {
  enCours = Math.max(0, enCours - 1)
}

/** Le nombre de transcodages en cours — lecture seule, pour les tests et le journal. */
export function creneauxOccupes(): number {
  return enCours
}

/**
 * Remet le compteur à zéro. ⚠️ **Réservé aux tests** : un état de module survit d'un test à l'autre
 * dans le même process, donc un test qui laisse un créneau pris ferait échouer le suivant pour une
 * raison sans rapport avec ce qu'il vérifie.
 */
export function reinitialiserCreneaux(): void {
  enCours = 0
}
