/**
 * Les capacités du module corpus (CC-275, extrait de Leitner — anciennement
 * `leitner.courses.view`/`leitner.courses.write`).
 *
 * - `corpus.view` — consulter le corpus de cours (`/corpus`), et le pont que Leitner en
 *   tire quand les deux modules sont présents (provenance, glossaire, recherche
 *   « Approfondir »). Séparée de l'écriture sur le patron déjà en place côté Leitner
 *   (`stats.view`/`view`, `taxonomy.write`/`cards.write`).
 * - `corpus.write` — ajouter, remplacer, supprimer un cours.
 */
export const CORPUS_CAPABILITIES = ['corpus.view', 'corpus.write'] as const
