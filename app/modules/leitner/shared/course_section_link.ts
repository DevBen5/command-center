/**
 * Le lien vers une section du cours (CC-273) — ancre par `id`, pas par slug : stable,
 * déjà présent dans les deux charges utiles (provenance, recherche), aucun encodage.
 *
 * ⚠️ Le hash natif du navigateur ne défile PAS sur cette application : le conteneur
 * défilant est le panneau `overflow-y-auto` d'`AppLayout`, pas `window`. `cours_show.vue`
 * lit cet id à la main et appelle `scrollIntoView` lui-même — ce fichier ne fait que
 * construire la cible, jamais le défilement.
 */

export function sectionAnchorId(sectionId: number): string {
  return `section-${sectionId}`
}

export function courseSectionHref(courseId: number, sectionId: number): string {
  return `/revision/cours/${courseId}#${sectionAnchorId(sectionId)}`
}
