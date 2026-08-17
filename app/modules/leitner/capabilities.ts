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
 *   ⚠️ **Sa raison d'être a changé avec CC-119.** Elle était séparée parce que `box` et
 *   `next_review` étaient des colonnes de la **carte** : une note donnée par quelqu'un
 *   d'autre déplaçait le planning du propriétaire. Ce n'est plus vrai — la progression et
 *   l'historique sont par personne, et noter n'atteint plus rien de partagé. Elle reste
 *   séparée pour ce qu'elle coûte encore : le juge fait travailler le LLM local.
 *   ⚠️ **Elle est accordée au rôle invité depuis CC-121**, et c'est le geste qui a ouvert
 *   la révision aux collègues. Le rôle lui-même n'existe **nulle part dans le dépôt** :
 *   les rôles sont des lignes en base, réglées depuis `/admin/roles`. Rien ici ne l'accorde
 *   ni ne peut le vérifier — ce que la suite tient, c'est que le profil
 *   (`view` + `stats.view` + `review`) déroule une session entière sans rien atteindre
 *   d'autre : `leitner_guest.spec.ts` et `leitner_readonly.spec.ts`, à lire ensemble.
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
 * - `leitner.backup` — l'export **et** l'import JSON. Deux raisons de la garder fermée, et
 *   ce ne sont plus celles qu'on croyait (question tranchée en CC-121) :
 *   ⚠️ **L'import est la raison décisive, et elle ne se devine pas depuis le mot
 *   « sauvegarde ».** Il *crée* des cartes et de la taxonomie (`LeitnerBackupService.import`),
 *   donc accorder cette capacité contournerait `leitner.cards.write` **et**
 *   `leitner.taxonomy.write` d'un seul geste. Une capacité qui en ouvre deux autres par la
 *   bande est le genre de porte qu'on n'ouvre pas par commodité.
 *   Côté export, il rend l'intégralité du **contenu communal** en un fichier : voir les
 *   cartes n'est pas repartir avec la base — c'est ce qui le sépare de `view`.
 *   ⚠️ **En revanche il ne divulgue les réponses écrites de personne d'autre**, contrairement
 *   à ce que ce commentaire a dit jusqu'à CC-121 : depuis la v2 (CC-119) `export(userId)`
 *   filtre `reviews` et `progress` sur `user_id`, le fichier ne porte que la progression et
 *   l'historique de celui qui exporte.
 * - `leitner.courses.view` — consulter le corpus de cours (`/revision/cours`). Séparée de
 *   `view` sur le patron de `stats.view` : on peut vouloir montrer les cours sans le
 *   catalogue de cartes, ou l'inverse.
 * - `leitner.courses.write` — ajouter, remplacer, supprimer un cours. Séparée de
 *   `courses.view` sur le patron de `taxonomy.write`/`cards.write` : deux gestes
 *   distincts, l'un de lecture, l'autre d'écriture sur du contenu.
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
  'leitner.courses.view',
  'leitner.courses.write',
] as const
