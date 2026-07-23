# Leitner — ce que couvre la suite

Sorti de `CLAUDE.md` pour ne pas être chargé à chaque fois qu'on touche au module. À lire **avant de
modifier un test**, pas avant de modifier le module. Les règles qui doivent rester présentes en
permanence sont dans `CLAUDE.md`, section « Tests ».

## Tests de composant (Vitest, `components/__tests__/`)

- `leitner_tabs.spec.ts` — l'onglet actif : query string, slash final, `/revision/ingest/42`, et
  surtout **un seul** onglet allumé (`/revision` étant préfixe des quatre autres).
- `ingestion_title.spec.ts` — les deux gardes de `save()` : titre vide et titre inchangé n'envoient
  **aucune** requête.
- `taxonomy_combobox.spec.ts` — l'invariant `filtering` : rouvrir la liste après avoir tapé remontre
  **toute** la taxonomie. ⚠️ Il ne prouve quelque chose que parce qu'il **tape d'abord** :
  `filtering` vaut déjà `false` au montage, donc ouvrir sans saisie passerait même si la remise à
  zéro disparaissait. C'est le piège de tout test de composant — voir le `CLAUDE.md` racine.

⚠️ **`LeitnerScopeSearch.vue` n'a pas de test de composant** : seuls `LeitnerTabs`, `IngestionTitle`
et `TaxonomyCombobox` sont couverts. Câbler celui-ci est possible et souhaitable ; en attendant, son
interaction (focus/blur, chevron, ↑↓ Entrée Échap, le clic qui ouvre la session) se vérifie au
navigateur.

## La règle métier et la file

- `tests/unit/leitner_service.spec.ts` — la règle des boîtes : une note = une assertion sur la boîte
  **et** sur `next_review`.
- `tests/unit/leitner_due_cards.spec.ts` — la **file et son paquet** (`all` · `theme` · `category`
  via ses thèmes · `unclassified`), l'ordre à l'intérieur d'un paquet, une carte `again` qui y reste,
  et le **refus** d'un id inexistant — le repli muet sur « tout » est le mode d'échec que ce lot
  existe pour éviter.
- `tests/functional/modules/leitner_scope.spec.ts` — l'écran de choix et ses **comptes dus**, la fin
  d'un paquet (distincte d'un paquet vide dès le départ), et surtout que **noter une carte conserve
  le paquet** : le piège n° 1, celui du `withQs()`. Il **assert l'en-tête `location` brut** —
  `assertRedirectsTo` ne compare que le chemin et laisserait passer la régression.
- `tests/unit/leitner_scope_search.spec.ts` — le **filtrage de la barre de recherche**, dont
  `securite` qui trouve « Sécurité » (le test qui compte), le chemin `Catégorie · Thème`, et un
  paquet à 0 trouvé mais **non sélectionnable**. Du code pur : il ne voit ni le focus/blur, ni le
  chevron, ni ↑↓ Entrée Échap, ni qu'un clic ouvre bien la session.
- `tests/functional/modules/leitner_review.spec.ts` — la file de révision (une carte ratée reste due
  le jour même et repart en fin de file), visant `?scope=all` qui doit se comporter **exactement**
  comme `/revision` d'avant le ciblage. Plus les deux garanties du juge — un `verdict: 'faux'`
  **n'empêche pas** un clic sur `easy` d'appliquer `easy` (+2 boîtes), et un juge éteint rend **200**
  avec `verdict: null` au lieu de casser le dévoilement — et le **branchement** de la fluence, que
  l'unitaire ne peut pas voir : la référence lue en base fait proposer `easy` sur une réponse juste
  et rapide, la même mesure sur une carte notée `again` le jour même retombe sur `good`, une mesure
  écartée s'écrit `null` là où `total_ms` s'écrit toujours, et une **première** présentation
  historise bien la sienne — le test qui tient l'ordre « compter les révisions du jour AVANT
  d'insérer la nouvelle ».

## Les statistiques

- `tests/unit/leitner_sessions.spec.ts` — l'**inférence de session**, du code pur sans base ni
  horloge, donc le test qui compte du lot : 31 min → deux sessions, 29 min → une seule, exactement
  30 → une seule (la coupure est sur « **plus de** »), une carte isolée → durée 0, le temps par carte
  sur une grappe, et surtout **une entrée désordonnée qui donne le même résultat qu'une entrée
  triée** — le mode d'échec silencieux du lot. Plus la médiane : son tri numérique (`[9, 10, 100]`,
  qui attrape le tri lexicographique) et son `null` sur l'absence de mesure.
  Ce qu'il ne voit **pas** : l'agrégation par fenêtre du service (glu triviale) et tout le rendu (le
  formatage des durées, le `—` sur base vide) — `pages/stats.vue` n'a pas de test de composant.

## Le juge et la fluence

- `tests/unit/leitner_judge_service.spec.ts` — le **juge de la réponse écrite**, test qui compte du
  lot : le court-circuit (l'assertion qui porte le test est `calls.length === 0`, pas le verdict :
  c'est l'**absence d'appel** qui est l'objet), les accents, la réponse vide qui ne juge rien, le
  mapping verdict → bouton, et surtout **le repli** — serveur éteint *et* sortie illisible, sans
  jamais lever.
- `tests/unit/leitner_llm_client.spec.ts` — ce qui part **réellement sur le fil** (`fetch` remplacé,
  aucun réseau) : `0.2` par défaut, `0` quand le juge le demande. Le faux client enregistre les
  options reçues, il ne prouve pas ce que le vrai en fait.
- `tests/unit/leitner_fluency.spec.ts` — la **fluence de rappel**, code pur sans base ni horloge :
  les deux bornes relatives, le choix carte-vs-boîte, et les trois cas qui font la valeur du ticket —
  une carte **re-présentée** n'est jamais proposée `easy` sur sa vitesse, une **interruption** (dont
  un dépassement du plafond) écarte la mesure au lieu de proposer `hard`, et **sans référence** on
  rend exactement ce que le juge proposait. Plus la borne du lot : la fluence **ne remonte jamais**
  un verdict `partiel` ou `faux`. Ce qu'il ne voit **pas** : le chronométrage lui-même (`Date.now()`,
  `visibilitychange`, `blur`, la remise à zéro entre deux cartes).
- `tests/unit/leitner_review_page.spec.ts` — ce que CC-60 a sorti de `index.vue` : l'écrêtage (dont
  **une durée négative rendue `null`, jamais `0`**), le dévoilement qui **fige** le temps total, les
  libellés d'échéance qui régressent en silence, et le **garde-fou anti-copie** de `MEASURE_MAX_MS`
  — il relit `index.vue` et rougit si le littéral y réapparaît, y compris en commentaire.

## Le catalogue et la sauvegarde

- `tests/unit/leitner_catalog_service.spec.ts` — les filtres, la suppression multiple, le
  reclassement et les cascades de la taxonomie.
- `tests/functional/modules/leitner_backup.spec.ts` — l'**aller-retour** (export → base vidée →
  import → base identique), le seul test qui valide la promesse de l'export. ⚠️ **Sa valeur tient
  entièrement dans son `snapshot()`** : une colonne que cette fonction ne lit pas peut être perdue
  par l'export sans qu'un seul test ne rougisse — c'est exactement ce qui a laissé passer CC-51.
  L'aller-retour porte une révision **jugée** et une **jamais jugée** (`null` doit se relire `null`,
  jamais `0` ni `''`), plus une troisième aux valeurs falsy (`answer: ''`, `thinkingMs: 0`) qui sont
  des mesures et non des absences.

## L'ingestion

- `tests/unit/leitner_ingestion_service.spec.ts` et
  `tests/functional/modules/leitner_ingest.spec.ts` — parsing, découpage, déduplication, promotion,
  échecs du LLM, **contre un faux client** ; plus l'**asynchrone** : le POST rend la main avant le
  modèle (le faux client est *retenu* le temps de le vérifier), un échec laisse `failed` avec son
  message et jamais `running`, et un travail orphelin est bien balayé.
- `tests/unit/leitner_ingestion_title.spec.ts` — la **déduction du titre**, code pur, donc le test
  qui compte de ce lot.
- `tests/unit/leitner_draft_review.spec.ts` — les prédicats de relecture des brouillons, dont le
  pendant exact du piège `isScheduleDirty` de veille : la base stocke `null` là où la copie éditable
  manipule `''`, et comparer les deux valeurs brutes laisserait *Enregistrer* allumé en permanence
  sur tout brouillon non classé.
- `tests/unit/leitner_pdf_service.spec.ts` — l'extraction et **ses six refus, un par un** (les
  confondre est la faute que ce lot évite), plus le nettoyage. Le fonctionnel vérifie que la route
  d'extraction **n'écrit rien** et que le flux complet PDF → texte relu → travail tient.

⚠️ **`tests/fixtures/*.pdf` sont des binaires versionnés**, générés une fois : `cours.pdf` (deux
pages de texte, avec des césures), `scan.pdf` (quatre pages sans couche texte, mais numérotées —
c'est le piège du seuil global), `epais.pdf` (250 pages de vrai texte : seul le plafond de **pages**
peut le refuser), `protege.pdf` (RC4, mot de passe `secret`). Ne les fabrique pas à la volée, et
**ne les télécharge jamais**. Un fichier qui n'est pas un vrai PDF (tronqué, mentant sur son
extension) se fabrique en revanche à la volée : il n'y a pas de binaire à versionner.

## Le LLM et sa liste blanche

- `tests/unit/leitner_llm_url.spec.ts` — la **liste blanche SSRF**, le test qui compte.
- `tests/unit/leitner_llm_redirect.spec.ts` — ce qui la **complète** : un `302` depuis un hôte
  autorisé n'est pas suivi. L'assertion qui porte le test est le **compteur de requêtes de la cible**
  (`hits === 0`), pas l'erreur : la cible rend une réponse *valide*, donc un test qui n'asserterait
  que « ça lève » passerait à tort. C'est le seul test du dépôt qui fasse émettre au vrai client une
  requête (deux serveurs jetables sur `127.0.0.1:0`, fermés en teardown — sans quoi
  `forceExit: false` fige `npm test`).
- `tests/functional/modules/leitner_llm.spec.ts` — l'écran de configuration, dont le fait que **la
  base est inchangée après un test de génération**.

Le faux client (`tests/fakes/fake_llm_client.ts`) simule aussi le **diagnostic** (`ping`,
`listModels`) : sans lui, les tests de `/revision/llm` iraient sonder de vrais ports de la machine
qui les exécute.
