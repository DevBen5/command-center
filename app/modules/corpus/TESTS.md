# Tests — module corpus

Extrait de Leitner en module détachable séparé (CC-275). Voir `app/modules/leitner/CLAUDE.md`,
section « Le corpus de cours (CC-251) », pour l'historique du contenu ; ce fichier ne référence
que ce qui, depuis CC-275, vit physiquement dans `app/modules/corpus/`.

⚠️ **Lu par `tests/unit/tests_index.spec.ts` (CC-112)** : toute spec citée ici doit exister sur le
disque, et toute spec de `tests/` préfixée `corpus_` ou de `app/modules/corpus/**` doit être citée
ici — les deux sens sont vérifiés, jamais un seul.

⚠️ **Trois fichiers de test seulement, et c'est le périmètre réel du module tel qu'extrait** — le
reste de la couverture du corpus de cours (recherche « Approfondir », glossaire du recto, provenance
d'ingestion) exerce des routes qui sont **restées côté Leitner** (le pont) et reste donc indexé dans
`app/modules/leitner/TESTS.md`, pas ici. Ne duplique pas ces entrées.

## Le découpage et l'empreinte (pur)

- `tests/unit/corpus_course_sections.spec.ts` — le découpeur pur (`splitCourseIntoSections`) et
  l'empreinte (`hashCourseMarkdown`). Le test qui compte : **aucun chevauchement**, chaque section
  ne porte que son propre contenu, contrairement à `chunkCourse` (ingestion, resté côté Leitner)
  qui, lui, chevauche exprès. Plus l'accumulation du chemin de titres (un titre de niveau 2 ferme
  tout ce qui est de niveau ≥ 2 sous lui, jamais ses ancêtres), le préambule sans titre →
  `introduction` (et un préambule vide ne produit **aucune** section fantôme), la désambiguïsation
  d'homonymes par suffixe numérique (`resume`, `resume-2`) — dans un même chemin de parenté **et**
  entre deux chemins différents —, la stabilité du slug quand seul le corps change, la
  slugification (accents, ponctuation), le glossaire `> notion: X, Y` (présent et absent), et
  l'égalité/différence de l'empreinte SHA-256 (normalisation CRLF→LF comprise).

## Le cycle de vie d'un cours, par les routes

- `tests/functional/modules/corpus_courses.spec.ts` — le cycle de vie d'un cours **par les
  routes** (`/corpus`). Cinq groupes : la **déduplication**, avec ses deux détections distinctes
  (même empreinte → rattachement silencieux, même titre → les 3 issues du dialogue de conflit —
  remplacer, créer un second avec suffixe `" (2)"`, annuler sans rien écrire —, scopée par
  propriétaire) ; les **pierres tombales**, où le test qui compte est la mutation vérifiée qu'un
  slug disparu du markdown remplaçant se voit poser `obsolete_at` sur la **même ligne** (jamais
  recréée), qu'un slug qui réapparaît ressuscite (`obsolete_at = null`) sans doublon, et que la
  purge ne supprime que les lignes tombées ; la **visibilité** (privé invisible + 403 à la
  consultation, partagé visible, écriture refusée à un non-propriétaire avec la base laissée
  intacte) ; les **capacités** (`corpus.view` sans `corpus.write` refuse la création) ; et la
  **garde de suppression de compte** (un cours partagé bloque, un cours privé seul laisse
  supprimer et devient orphelin — `ownedSharedCorpusContentTable`, scindée de la garde Leitner à
  l'extraction).
  ⚠️ **Le dernier groupe** (« sections écrites dans la transaction du cours ») ne passe **jamais**
  par `withGlobalTransaction()`, et c'est délibéré : voir le commentaire en tête de ce groupe dans
  le fichier — la transaction globale masquerait un `Model.create()` posé hors du `{ client: trx }`
  reçu par le service, exactement le bug mesuré en direct sur ce poste le 2026-08-19.

## Le dialogue de conflit (Vitest)

- `app/modules/corpus/components/__tests__/course_conflict_dialog.spec.ts` — le dialogue à 3
  issues de la dédup « même titre, texte différent » (CC-251) : chaque bouton
  (`replace`/`createSecond`/`cancel`) émet l'événement attendu, et lui seul, plus le clic hors du
  panneau (fermeture du chassis `AppModal`) qui vaut aussi `cancel`.

## Ce qui n'est PAS ici

- La recherche plein texte (`GET /revision/:id/course-search`), le glossaire du recto
  (`frontNodes`) et la provenance d'ingestion (`leitner_card_sections`) restent des routes/tables
  **Leitner** consommant les données du corpus (le pont, CC-275) — indexées dans
  `app/modules/leitner/TESTS.md`, sous « La provenance d'ingestion (CC-253) » et « Le bouton
  « Je ne sais pas » et la recherche du corpus (CC-252) ».
- `tests/unit/course_section_link.spec.ts` (`sectionAnchorId`/`courseSectionHref`) a suivi
  `course_section_link.ts` dans `core/shared` — transverse, déclaré dans `SPECS_TRANSVERSES` de
  `tests/unit/tests_index.spec.ts`, pas ici.
- `app/modules/leitner/components/__tests__/course_section_view.spec.ts` reste côté Leitner : le
  composant `CourseSectionView.vue` n'a pas suivi le corpus (aucun second consommateur au moment
  de l'extraction — voir le `CLAUDE.md` racine, « Le seul `v-html` du dépôt », et la décision
  CC-275 sur ce point).

## Limites connues — ne les fais pas passer pour couvertes

- **Aucun navigateur n'a affiché `/corpus`** (liste, page de détail, dialogue de conflit) depuis
  l'extraction — même limite déjà actée côté Leitner avant CC-275. Le cycle de vie est prouvé par
  les routes ; l'allure de l'écran, le rendu du markdown, et le défilement vers l'ancre de section
  restent un passage navigateur pour le propriétaire.
- **Le contrat de détachabilité** (le module fonctionne seul, Leitner fonctionne sans lui) n'est
  prouvé par AUCUN test automatisé — `.env.test` active tous les modules connus ensemble
  (doctrine CC-137). Il se prouve en faisant tourner un vrai serveur avec `MODULES` réduit, dans
  les deux sens — voir le compte rendu de livraison de CC-275.
