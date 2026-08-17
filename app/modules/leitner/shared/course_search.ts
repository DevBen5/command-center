/**
 * La requête plein texte du panneau « Approfondir » (CC-252) — dérivée du recto de la
 * carte, jamais saisie à la main.
 *
 * ⚠️ **Elle ne fait que retirer la décoration Markdown** (CC-133 en écrit dans les cartes
 * depuis CC-259 : `**gras**`, `` ` `` , `#`, `-`…). Accents, casse et mots vides restent
 * l'affaire de `plainto_tsquery('french', …)` côté Postgres — même doctrine que la
 * recherche de la veille, qui ne les normalise pas non plus côté client.
 *
 * Fichier **pur** : ni base, ni Vue. Vit dans `shared/` pour la même raison que le reste
 * du module — importable depuis `pages/index.vue` (jamais par un alias `#modules/*`,
 * que Vite ne résout pas) et testable sans compilateur Vue.
 */
export function courseSearchQuery(front: string): string {
  return front
    .replace(/^[-*]\s+/gm, ' ') // puce de liste en tête de ligne
    .replace(/-{2,}/g, ' ') // séparateur --- , jamais un tiret interne à un mot
    .replace(/[`*_#>()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
