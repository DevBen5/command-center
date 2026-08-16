/**
 * Le **régime d'entretien** : à quel rythme revient une carte qu'on a acquise (CC-261).
 *
 * ⚠️ **Ce fichier est PUR** — ni base, ni horloge, ni modèle : le réglage et le rang sont
 * des paramètres, comme `now` dans `leitner_mastery.ts`. C'est ce qui rend l'échelle
 * prouvable sur ses trois réglages extrêmes sans attendre un an.
 *
 * Le défaut qu'il corrige : une carte maîtrisée revenait **indéfiniment** tous les
 * `box5Days` (30 j par défaut), mélangée aux cartes qu'on est en train d'apprendre. La
 * file ne rétrécissait jamais, et rien ne distinguait « acquis » de « en cours ».
 */

/**
 * Les paliers, en jours, dans l'ordre où on les gravit. **Croissants et plafonnés.**
 *
 * - **Croissants**, parce que c'est le principe même du module : un intervalle d'entretien
 *   fixe serait une régression par rapport à ce que les boîtes font déjà.
 * - **Plafonnés à 365**, donc au moins une vérification par an : c'est ce qui empêche
 *   « maîtrisée » de devenir une affirmation que plus rien ne contrôle. Le dernier palier
 *   se répète indéfiniment, il ne s'échappe pas.
 */
export const MAINTENANCE_LADDER_DAYS = [90, 180, 365] as const

/**
 * L'intervalle d'entretien pour le rang `rank`, jamais sous l'intervalle réglé de la
 * boîte 5.
 *
 * ⚠️ **Le `Math.max(box5Days, …)` n'est pas cosmétique.** `box5Days` se règle de 1 à 365
 * jours depuis `/revision/settings` : à 365 (la borne haute), un palier fixe à 90 ferait
 * revenir une carte **maîtrisée** quatre fois plus souvent qu'une carte encore en cours
 * d'apprentissage. Absurde, et parfaitement invisible tant que personne ne pousse le
 * réglage — il n'y a ni erreur ni log, juste une file d'entretien qui se remplit sans
 * raison.
 *
 * ⚠️ **Un `box5Days × 12` a été écarté pour la raison symétrique** : au même réglage de
 * 365 jours, il donnerait un intervalle de **douze ans**. Le plancher relatif et le
 * plafond absolu ne sont pas deux façons de dire la même chose ; ils bornent des dérives
 * opposées.
 *
 * @param rank Combien de paliers ont déjà été consommés depuis l'acquisition. **Écrêté
 *   des deux côtés** : au-delà du dernier palier on y reste, et une valeur négative — qui
 *   ne devrait jamais arriver — ne doit pas rendre `undefined`, ce qu'un
 *   `plus({ days: undefined })` de Luxon transformerait en « +0 jour », donc en une carte
 *   due aujourd'hui, indéfiniment. Même piège que la boîte 12 de l'import.
 * @param box5Days L'intervalle réglé pour la boîte 5, **lu en base** (`boxIntervals()[5]`),
 *   jamais la constante de départ.
 */
export function maintenanceIntervalDays(rank: number, box5Days: number): number {
  const step = Math.min(Math.max(Math.trunc(rank), 0), MAINTENANCE_LADDER_DAYS.length - 1)
  return Math.max(box5Days, MAINTENANCE_LADDER_DAYS[step])
}
