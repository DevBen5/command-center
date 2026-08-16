/**
 * L'écran de gestion (`pages/settings.vue`) — le recalage du défilement après un import JSON.
 *
 * ⚠️ **Ce fichier vit ici parce qu'une inversion de signe est invisible à la relecture.**
 * `settings.vue` n'a longtemps rien eu à extraire : ses vingt fonctions sont des gestionnaires
 * d'action, pures ni en entrée ni en sortie. Celle-ci est l'exception — de l'arithmétique, dont
 * le mauvais signe **double** le saut qu'elle prétend annuler, en produisant exactement le bug
 * qu'on corrige, en plus gros. Les lectures et écritures du DOM, elles, restent dans le `.vue`.
 *
 * ⚠️ **N'importe jamais par un alias `#modules/*` depuis ce dossier.** L'alias mappe vers
 * `./app/modules/*.js`, des fichiers qui n'existent qu'après un build : Vite ne les résout pas,
 * et la page casserait. Seuls le relatif et les paquets npm purs sont permis. Le garde-fou est
 * `npm run build` ; `tsc` ne lit pas les `.vue`.
 *
 * Ce fichier est **pur** : ni base, ni horloge, ni DOM, ni Vue.
 */

/**
 * Les trois mesures du recalage — **trois nombres du même type, donc jamais positionnels**.
 * En positionnel, intervertir `topBefore` et `topAfter` compilerait, passerait le lint, et
 * rendrait le saut deux fois plus grand qu'avant le correctif.
 */
export interface AnchorShift {
  /** Le défilement du conteneur **au moment de la correction**, pas celui d'avant la requête. */
  scrollTop: number
  /** `getBoundingClientRect().top` de l'ancre, relevé **avant** la requête. */
  topBefore: number
  /** Le même, relevé **après** que Vue a écrit le DOM (donc après `nextTick`). */
  topAfter: number
}

/**
 * Le défilement qui redonne à l'ancre **la position qu'elle occupait à l'écran**.
 *
 * Deux mouvements distincts aboutissent ici, et le même delta les annule tous les deux :
 *
 * - l'ancrage de défilement du navigateur (`overflow-anchor`) a remonté `scrollTop` parce que des
 *   lignes se sont insérées **en tête** du tableau, au-dessus de la ligne sur laquelle il s'était
 *   ancré — l'ancre descend dans le document sans bouger, mais remonte à l'écran ;
 * - le bloc a réellement été poussé vers le bas par un voisin qui a grandi au-dessus de lui
 *   (l'import a créé des catégories, donc allongé la taxonomie).
 *
 * Dans les deux cas la correction est `scrollTop + (topAfter − topBefore)` : on suit l'ancre.
 *
 * ⚠️ **Le plancher à 0 n'est pas de la coquetterie** : un défilement négatif n'existe pas, le
 * navigateur l'écrêterait de toute façon, et rendre une valeur négative ferait mentir la
 * fonction sur ce qu'elle produit. Il ne masque aucune erreur de signe — une inversion se voit
 * sur les deux cas nominaux, loin de ce bord.
 */
export function scrollTopKeepingAnchor({ scrollTop, topBefore, topAfter }: AnchorShift): number {
  return Math.max(0, scrollTop + (topAfter - topBefore))
}

/**
 * Le catalogue en **deux sections** : ce qui est en cours d'apprentissage, et ce qui est
 * acquis (CC-262).
 *
 * ⚠️ **C'est un partage, jamais un filtre.** Les deux moitiés s'affichent, l'une sous
 * l'autre, dans le même tableau et avec les mêmes actions : une carte maîtrisée doit rester
 * éditable et supprimable, sans quoi l'écran de correction du module cesserait de pouvoir
 * corriger ce qu'on connaît le mieux. C'est aussi pour ça que le filtre « boîte 5 »
 * continue de la trouver, pendant que la tuile « boîte 5 » de `/revision` annonce 0 — les
 * deux écrans ne répondent pas à la même question (contenu / file), arbitrage de CC-261.
 *
 * ⚠️ **L'ordre reçu du serveur est conservé dans chaque section** (`id desc`), et il ne
 * faut pas retrier ici : c'est lui que le recalage de défilement ci-dessus suppose, les
 * cartes importées s'insérant en tête.
 */
export function splitByMastery<T extends { masteredAt: string | null }>(
  cards: T[]
): { inProgress: T[]; mastered: T[] } {
  return {
    inProgress: cards.filter((card) => card.masteredAt === null),
    mastered: cards.filter((card) => card.masteredAt !== null),
  }
}
