/**
 * Le lien vers une section du cours (CC-273) — ancre par `id`, pas par slug : stable,
 * déjà présent dans les deux charges utiles (provenance, recherche), aucun encodage.
 *
 * ⚠️ Le hash natif du navigateur ne défile PAS sur cette application : le conteneur
 * défilant est le panneau `overflow-y-auto` d'`AppLayout`, pas `window`. `corpus/pages/show.vue`
 * lit cet id à la main et appelle `scrollIntoView` lui-même — ce fichier ne fait que
 * construire la cible, jamais le défilement.
 *
 * ⚠️ **Logé dans `core/shared` depuis CC-275, pas dans Leitner.** Deux consommateurs de
 * part et d'autre de la frontière du corpus : `leitner/components/CourseSectionView.vue`
 * (le panneau de provenance/Approfondir, resté côté Leitner) et `corpus/pages/show.vue`
 * (l'écran du cours lui-même) — patron CC-133/CC-180, brique neutre dans le noyau.
 */

export function sectionAnchorId(sectionId: number): string {
  return `section-${sectionId}`
}

export function courseSectionHref(courseId: number, sectionId: number): string {
  return `/corpus/${courseId}#${sectionAnchorId(sectionId)}`
}
