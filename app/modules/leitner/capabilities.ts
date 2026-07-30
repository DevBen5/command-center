/**
 * Les capacités du module Leitner.
 *
 * Le découpage suit ce que les routes font réellement, pas la découpe des écrans (voir
 * `start/routes.ts`, où le préfixe `/revision` ne dit rien de la capacité : `POST
 * /revision/cards` appartient à la gestion, pas à la révision).
 *
 * - `leitner.view` — voir la file de révision, le catalogue des cartes (`/revision/settings`
 *   en lecture) et la taxonomie. C'est ce que CC-72 accorde aux collègues en lecture seule.
 * - `leitner.stats.view` — l'onglet Stats (`/revision/stats`), lecture pure de l'effort.
 *   Séparée de `view` : on peut vouloir montrer les cartes sans le tableau d'effort, ou
 *   l'inverse. Accordée à l'invité, elle aussi.
 * - `leitner.review` — **noter une carte** (`leitner_card_progress`, `leitner_reviews`) et
 *   **juger** une réponse écrite. Le juge n'écrit rien mais consomme le LLM local : il suit
 *   la note, pas la lecture.
 *   ⚠️ **Sa raison d'être a changé avec CC-119, et il faut le savoir avant de l'accorder.**
 *   Elle était séparée parce que `box` et `next_review` étaient des colonnes de la **carte** :
 *   une note donnée par quelqu'un d'autre déplaçait le planning du propriétaire. Ce n'est
 *   plus vrai — la progression et l'historique sont désormais par personne, et noter
 *   n'atteint plus rien de partagé. Elle reste séparée pour ce qu'elle coûte encore : le
 *   juge fait travailler le LLM local. **C'est CC-121 qui l'accorde au rôle invité**, et
 *   c'est le geste qui ouvre enfin la révision aux collègues.
 * - `leitner.cards.write` — la saisie des cartes : créer, éditer, supprimer, reclasser.
 * - `leitner.taxonomy.write` — les catégories et les thèmes. Séparée de `cards.write` : ce
 *   sont deux gestes d'écriture distincts, l'un sur le contenu, l'autre sur son classement.
 * - `leitner.settings` — les intervalles des boîtes (`/revision/settings/intervals`). Une
 *   ligne unique et partagée (`leitner_settings`, contrainte `id = 1` en base) : un réglage
 *   d'installation, pas de personne.
 *   ⚠️ **Décision explicite de CC-119, tranchée et non un reste** : au moment de rendre la
 *   progression personnelle, la question s'est posée de faire de même pour les intervalles.
 *   Non — ils décrivent la **méthode** de répétition espacée, pas la personne qui la suit.
 *   La ligne unique reste, et cette capacité reste fermée à l'invité même après CC-121 :
 *   c'est la dernière écriture du module qui touche du partagé sans être du contenu.
 * - `leitner.ingest` — l'ingestion d'un cours par le LLM local (extraction, brouillons,
 *   promotion). Elle fait sortir des requêtes et écrit en base : c'est déclencher, pas
 *   consulter.
 * - `leitner.llm` — l'écran de configuration du LLM (`/revision/llm*`). La plus proche d'une
 *   SSRF du dépôt : ces routes font émettre au serveur des requêtes vers une URL saisie, et
 *   la liste blanche des validateurs (loopback + plages privées) est le seul rempart.
 *   Séparée de `settings` parce que le risque n'est pas le même : régler un intervalle
 *   n'atteint aucun réseau.
 * - `leitner.backup` — l'export **et** l'import JSON. L'export est en lecture, donc tentant à
 *   accorder — mais il rend l'intégralité du contenu en un fichier, réponses écrites
 *   comprises. Séparé de `view` pour exactement ça : voir les cartes n'est pas repartir avec
 *   la base. L'import n'ajoute que ce qui manque, mais il ajoute.
 */
export const LEITNER_CAPABILITIES = [
  'leitner.view',
  'leitner.stats.view',
  'leitner.review',
  'leitner.cards.write',
  'leitner.taxonomy.write',
  'leitner.settings',
  'leitner.ingest',
  'leitner.llm',
  'leitner.backup',
] as const
