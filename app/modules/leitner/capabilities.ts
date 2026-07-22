/**
 * Les capacités du module Leitner.
 *
 * Le découpage suit ce que les routes font réellement, pas la découpe des écrans :
 *
 * - `leitner.view` — regarder la file et les statistiques. C'est ce que CC-72 accordera
 *   aux collègues en lecture seule.
 * - `leitner.review` — **noter une carte**, donc écrire `box` et `next_review`. Séparée de
 *   la lecture parce que ces deux colonnes sont celles de la carte, pas d'une progression
 *   par personne : une note donnée par quelqu'un d'autre déplace le planning du propriétaire.
 * - `leitner.cards.read` — le catalogue, et l'export JSON qui l'emporte en entier. Qui voit
 *   les cartes peut les copier ; autant que ce soit dit ici plutôt que découvert.
 * - `leitner.cards.write` — la saisie : cartes, catégories, thèmes, et l'import (qui n'ajoute
 *   que ce qui manque, mais ajoute).
 * - `leitner.ingest` — l'ingestion d'un cours par le LLM.
 * - `leitner.settings` — les intervalles des boîtes et la configuration du LLM. La plus
 *   fermée : les routes `/revision/llm*` font émettre au serveur des requêtes vers une URL
 *   saisie, et la liste blanche des validateurs est le seul rempart SSRF.
 */
export const LEITNER_CAPABILITIES = [
  'leitner.view',
  'leitner.review',
  'leitner.cards.read',
  'leitner.cards.write',
  'leitner.ingest',
  'leitner.settings',
] as const
