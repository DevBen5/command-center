# Leitner — ce que couvre la suite

Sorti de `CLAUDE.md` pour ne pas être chargé à chaque fois qu'on touche au module. À lire **avant de
modifier un test**, pas avant de modifier le module. Les règles qui doivent rester présentes en
permanence sont dans `CLAUDE.md`, section « Tests ».

⚠️ **Les fabriques du module vivent dans `tests/helpers/leitner.ts`, et `makeCard` ne pose AUCUNE
progression.** C'est délibéré : une carte neuve n'a pas de ligne, l'absence *est* « boîte 1, due
aujourd'hui » pour tout le monde. Un helper qui en sèmerait une par commodité ferait passer au vert
des tests qui ne prouvent alors plus rien du cas réel — celui d'un compte qui découvre le paquet.
Pour un autre état, il faut dire **pour qui** : `setProgress(userId, cardId, …)`, et les lectures
`boxOf` / `nextReviewOf` prennent le même couple.

⚠️ **Ce qu'aucun runner ne voit, et ne verra pas : le backfill des migrations de CC-119.**
`app_test` est migrée à neuf puis déroulée à chaque exécution — jamais une base peuplée ne traverse
ces migrations sous Japa. La vérification est **manuelle, sur la base de dev**, et elle a été faite :
empreinte `md5` de (carte, boîte, échéance) relevée avant, après, puis après un aller-retour
`rollback` → `run` — identique aux trois états sur 224 cartes et 25 révisions réelles. À refaire
**avant tout `migration:run` sur une base qui porte du contenu**, c'est le seul endroit du lot où
une erreur se paie en planning perdu.

⚠️ **Même angle mort pour le backfill de CC-260 (`box5_entered_at = updated_at`), et il n'a PAS été
levé.** Mesuré, pas déduit : supprimer le `defer` entier de
`1786600000005_add_mastery_marks_to_leitner_tables.ts` laisse la suite **verte** — `app_test` est
vide, l'`update ... where box = 5` touche zéro ligne. L'empreinte avant/après modèle CC-119 **n'a
pas pu être faite** : la base de dev de ce poste portait 2 cartes et **0 en boîte 5** le 2026-08-13,
donc il n'y avait rien à empreindre. Elle reste à faire sur une base qui porte du contenu réel, et
ce lot ne doit pas être lu comme si elle l'avait été. Le backfill de `kind`, lui, n'a rien à
prouver : le `default` de la colonne est exactement vrai (l'entretien n'existait pas).

## Tests de composant (Vitest, `components/__tests__/`)

- `app/modules/leitner/components/__tests__/leitner_tabs.spec.ts` — l'onglet actif : query string,
  slash final, `/revision/ingest/42`, et surtout **un seul** onglet allumé (`/revision` étant
  préfixe des quatre autres).
- `app/modules/leitner/components/__tests__/ingestion_title.spec.ts` — les deux gardes de `save()` :
  titre vide et titre inchangé n'envoient **aucune** requête.
- `app/modules/leitner/components/__tests__/markdown_preview.spec.ts` — l'aperçu du rendu
  (CC-257), côté page. ⚠️ **Il ne teste aucun rendu, et c'est le point** : le HTML vient du
  serveur, ce composable ne décide que de la **politique de requête**. Trois assertions portent le
  lot, chacune sur une régression muette : **replié, taper n'émet rien** (c'est ce qui laisse la
  saisie en série aussi silencieuse qu'avant le lot — le coût mesuré n'est pas la latence mais le
  nombre de requêtes) ; **la requête en vol est annulée** quand une plus récente part — le premier
  `fetch` du test ne se résout **jamais**, sans quoi il n'y aurait plus rien à annuler et le test
  passerait au vert sans exercer l'annulation du tout ; et **les deux en-têtes** (`x-xsrf-token`,
  `accept: application/json`) sans lesquels une réponse d'erreur devient une redirection que le
  `fetch` suit. Plus les deux cas qui n'atteignent jamais le réseau (champs vides, contenu
  au-delà de la borne) et la distinction `tooLong` / `failed`.
  Il monte aussi `MarkdownPreviewPanel` pour une **subtilité de Vue** que rien d'autre
  n'attraperait : le composable rend un objet plat portant des `ref`, qui voyage en **prop** — les
  props n'étant que superficiellement réactives, ça s'écrit `preview.open.value`, et un
  `preview.open` nu (l'écriture qui *paraît* juste, puisque Vue déballe partout ailleurs) rendrait
  un objet toujours truthy : le panneau s'afficherait **en permanence, y compris replié**, avec
  les trois gates au vert. Le montage porte en prime l'assertion sur la classe `markdown` **au
  rendu**, là où `leitner_card_preview.spec.ts` ne peut la lire que dans la source.
- `app/modules/leitner/components/__tests__/taxonomy_combobox.spec.ts` — l'invariant `filtering` :
  rouvrir la liste après avoir tapé remontre **toute** la taxonomie. ⚠️ Il ne prouve quelque chose
  que parce qu'il **tape d'abord** : `filtering` vaut déjà `false` au montage, donc ouvrir sans
  saisie passerait même si la remise à zéro disparaissait. C'est le piège de tout test de composant — voir le `CLAUDE.md` racine.

⚠️ **`LeitnerScopeSearch.vue` n'a pas de test de composant** : seuls `LeitnerTabs`, `IngestionTitle`
et `TaxonomyCombobox` sont couverts. Câbler celui-ci est possible et souhaitable ; en attendant, son
interaction (focus/blur, chevron, ↑↓ Entrée Échap, le clic qui ouvre la session) se vérifie au
navigateur.

## Le cloisonnement par propriétaire (CC-139)

- `tests/functional/modules/leitner_ownership.spec.ts` — distinct du cloisonnement par
  **personne** ci-dessous : ici, qui peut **voir** du contenu et qui peut l'**écrire**,
  selon `owner_id`/`is_shared`. Trois groupes. **Lecture** : une carte privée d'un autre
  compte est invisible du catalogue, de la file de révision et de l'arbre de choix — y
  compris son thème/catégorie, même à 0 carte due ; une carte partagée reste visible ; le
  compte « dû » d'un thème partagé n'additionne jamais les cartes privées d'un autre
  compte (le test qui compte du groupe — c'est le mode d'échec le plus plausible : un
  chiffre qui gonfle sans jamais lever). **Écriture** : éditer/supprimer le contenu d'un
  autre compte est refusé — `is_shared` compris, il n'ouvre que la lecture jamais
  l'écriture — et l'assertion porte sur l'état en base, pas seulement le 403 (même
  doctrine que `leitner_readonly.spec.ts`) ; un reclassement en lot s'arrête net (tout ou
  rien) si une seule carte du lot n'est pas possédée ; un admin, lui, passe. **Suppression
  de compte** : refusée tant qu'il possède du contenu `is_shared = true`, réussie sinon —
  le contenu privé restant devient orphelin (`owner_id = null`), visible du seul admin ;
  décocher « Partagé » débloque la suppression, prouvant qu'il n'y a pas d'impasse.

## Le cloisonnement par personne (CC-119)

- `tests/functional/modules/leitner_multi_user.spec.ts` — le principe directeur de CC-77, éprouvé
  **par les routes**, des deux côtés de la ligne de partage. Côté cloisonnement : noter ne déplace
  la file de personne d'autre (**le test qui compte** — c'est l'invariant qui a rendu sûr d'ouvrir
  `leitner.review` au rôle invité en CC-121), un compte neuf voit tout le paquet sans qu'on lui ait
  rien semé, une
  carte créée après lui lui est due aussitôt, `again` repart en fin de **sa** file, « terminé,
  bravo » ne se déclenche pas sur le travail d'un autre, série/journée/rétention et l'onglet Stats
  ne comptent que les siennes, la pastille de la barre latérale et la carte d'accueil suivent sa
  file, le catalogue est commun mais la colonne « boîte » ne l'est pas. Côté contenu : supprimer un
  compte emporte sa progression et son historique, **jamais** une carte, un thème ni une catégorie —
  et sans aucune vérification de dépendances, ce qui est tout l'intérêt.
  ⚠️ **Un test multi-utilisateur passe très bien sans cloisonnement** dès lors que les deux comptes
  ne se marchent jamais dessus. Les trois gardes du lot ont donc été cassées une à une pour
  vérifier qu'elles rougissent : le `user_id` de la condition de jointure (5 rouges), l'`updated_at`
  de la progression dans l'ordre de file (3 rouges, dont les deux tests d'ordre pré-existants), et
  le `select('leitner_cards.*')` (17 rouges — sans lui `ucp.id` écrase `leitner_cards.id`).

## La règle métier et la file

- `tests/unit/leitner_service.spec.ts` — la règle des boîtes : une note = une assertion sur la boîte
  **et** sur `next_review`, désormais lus sur la progression de la personne. Depuis CC-119 il porte
  aussi **la règle du 2ᵉ `hard` qui ne traverse pas deux comptes** — le test qui prouve que le
  cloisonnement de l'historique n'était pas séparable de celui de la progression —, la première
  note d'une carte jamais vue (l'absence de ligne vaut boîte 1), et le fait que les intervalles
  restent un réglage d'**installation**, partagé.
- `tests/unit/leitner_mastery.spec.ts` — le **critère de maîtrise** (CC-260), code pur sans base ni
  horloge : c'est ce qui permet d'éprouver « trente jours se sont écoulés » sans attendre trente
  jours. Les deux cas qui portent le lot sont les **extrêmes du réglage** — à `box5Days = 1` le
  plancher de 30 jours mord (sans lui, deux jours suffiraient), à `365` c'est le réglage qui domine :
  le défaut étant 30, un test au défaut seul n'éprouverait ni l'un ni l'autre. Plus la borne des 30
  jours dans les **deux sens** (exactement 30 valide, 29 non — un seul des deux cas passerait sur une
  comparaison trop laxiste), `hard` qui ne valide pas **et** ne réarme pas (l'arbitrage contestable,
  et le test qui rougirait s'il bascule), `again` qui réarme et démaîtrise, le 2ᵉ `hard` d'affilée
  qui efface tout, la carte qui vient d'arriver en boîte 5, la carte importée sans horloge qui la
  reçoit **sans être maîtrisée pour autant**, et la date d'acquisition qui **ne dérive pas**.
- `tests/unit/leitner_service.spec.ts`, groupe « marques de maîtrise » — ce que le pur ne peut pas
  dire : que le critère est **branché**, sur l'état lu avant la note et sur l'intervalle lu **en
  base** (à `box5Days = 365`, 40 jours en boîte 5 ne suffisent plus — la seule chose qui prouve que
  `boxIntervals()[5]` arrive jusqu'au critère). ⚠️ **Le test qui porte le lot** est la révision
  **ratée** d'entretien : `kind: 'maintenance'` alors que la carte en ressort non maîtrisée — calculé
  après la mutation, l'historique affirmerait qu'aucun entretien n'a jamais échoué, sans symptôme.
  ⚠️ Et « la première note d'une carte jamais révisée est `normal` » est le seul qui attrape le piège
  de l'`undefined` : `firstOrNew` rend un modèle neuf dont `masteredAt` vaut `undefined`, pas `null`,
  et un `!== null` naïf classerait **toute première note** en `'maintenance'`.
- `tests/functional/modules/leitner_intervals.spec.ts` — les intervalles **lus en base**, pas dans
  la constante. Le test qui porte le lot enchaîne les deux moitiés dans la **même** exécution :
  boîte 3 réglée à 10 jours, puis une carte notée `good` dont `next_review` tombe à +10. Asserter
  la persistance seule laisserait passer un `updateBoxIntervals` qui écrit sans que
  `boxIntervals()` relise — la valeur serait en base et la règle continuerait sur les défauts. Plus
  le refus d'un intervalle à **0**, vérifié sur l'**état de la ligne** et non sur le code HTTP : à
  0 jour, une carte réussie resterait due le jour même, donc éternellement en session — le
  privilège de `again`, et de lui seul.
- `tests/unit/leitner_due_cards.spec.ts` — la **file et son paquet** (`all` · `theme` · `category`
  via ses thèmes · `unclassified`), l'ordre à l'intérieur d'un paquet, une carte `again` qui y reste,
  et le **refus** d'un id inexistant — le repli muet sur « tout » est le mode d'échec que ce lot
  existe pour éviter. Depuis CC-119 il tient aussi la jointure de progression : une carte **jamais
  notée est due** (sans aucune ligne), les comptes de l'écran de choix suivent la personne, et
  **la carte porte SON id, jamais celui de la ligne de progression** — le pire piège du lot, où un
  `select *` fait afficher des cartes plausibles dont noter l'une écrit sur une autre. Depuis
  CC-139, `resolveScope` porte aussi qu'**un thème privé chez un autre compte est refusé comme
  inexistant** — jamais un troisième cas qui distinguerait « existe mais caché », la même doctrine
  que le refus d'un id inexistant.
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
- `tests/unit/leitner_habits.spec.ts` — les mesures d'**habitude**, du code pur dont le jour courant
  est un paramètre. Les séries d'abord : **une série passée plus longue que la courante est retenue**,
  un trou d'un jour coupe, l'ensemble vide rend 0, un jour isolé rend 1, et la contiguïté **traverse
  un changement de mois** (le piège d'une comparaison de chaînes). Puis le fait que la série en cours
  vaut toujours 0 tant que rien n'a été noté aujourd'hui — le comportement d'origine, gardé comme
  témoin du refactor de `streakDays()`. La heatmap ensuite : **la première case est un lundi** (le
  calage sans lequel chaque jour tombe sur la mauvaise ligne), la dernière est aujourd'hui, aucune
  case ne dépasse aujourd'hui, un jour sans révision existe à 0, les comptes atterrissent sur la
  bonne date, les paliers suivent le maximum de la fenêtre et un historique vide ne divise pas par
  zéro. Enfin **l'index 0 des jours de semaine est le lundi** (Luxon numérote de 1 à 7) et les
  fenêtres écartent bien ce qui les précède.
  Ce qu'il ne voit **pas**, et personne d'autre non plus : que les classes de la heatmap soient
  réellement **générées** par Tailwind. Une table de classes construites laisserait la grille grise
  avec toute la suite verte — ça se vérifie à `npm run build`, en greppant le CSS produit.
- `tests/unit/leitner_weakness.spec.ts` — les **points faibles**, code pur sans base : la doctrine de
  rétention (`hard` ne fait **pas** chuter, `again` oui, l'absence rend `null` jamais 0), la remontée
  thème → catégorie dont **un `themeId` null tombe dans « Non classées »** et le **total d'une
  catégorie qui somme sans concaténer** — les `count` sont fournis en **chaîne** (le `bigint` de
  Postgres) et `assert.strictEqual` refuse `'66'`. Plus le tri décroissant et le drapeau `enoughData`
  au seuil. C'est le test qui compte du lot.
- `tests/unit/leitner_stats_service.spec.ts` — ce que le pur ne voit pas : le **SQL**. Il touche la
  base et prouve le **fenêtrage `toSQL()`** (les fenêtres 7/30/90 cumulent, une révision au-delà de
  90 j n'entre nulle part), la **jointure reviews → cards** du taux d'`again` avec sa remontée à la
  catégorie et « Non classées », et les **deux requêtes de cartes** (le plus d'`again` classé
  décroissant, les coincées en boîte 1-2 filtrées par le plancher de tentatives). Depuis CC-119 il
  porte aussi le cloisonnement de cet écran : la rétention ignore les révisions des autres, un
  collègue qui pilonne un thème d'`again` ne fabrique pas mon point faible, et « coincées » croise
  **deux** filtres distincts — ma boîte (jointure de progression) et mes tentatives (`withCount`
  filtré) — dont l'un oublié désignerait des cartes que je n'ai jamais vues. Ce qu'il ne voit
  **pas** : le rendu de `stats.vue` (formatage, liens, table dépliable) — pas de test de composant.

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
  reclassement et les cascades de la taxonomie. Plus, depuis CC-119 : une carte créée **ne sème
  aucune progression**, le catalogue montre la boîte de celui qui regarde, et le filtre « boîte 1 »
  trouve bien les cartes **sans** ligne — sinon il ne remonterait jamais une carte neuve, le cas le
  plus fréquent de l'écran. ⚠️ **Toutes les cartes y sont créées `isShared: true`** (le fichier ne
  teste pas le cloisonnement par propriétaire, c'est `leitner_ownership.spec.ts` qui le fait) ; un
  test dédié, **« deux comptes peuvent chacun avoir une catégorie du même nom »**, prouve depuis
  CC-139 que `unique(owner_id, name)` a bien remplacé `unique(name)`.
- `tests/functional/modules/leitner_cards.spec.ts` — le cycle de vie d'une carte **par les routes
  HTTP** : ce qui atterrit en base est bien ce qui a été saisi. Le module n'ayant aucun seeder,
  c'est le seul endroit qui prouve les défauts d'une carte créée depuis l'écran (boîte 1, due le
  jour même, non classée). Deux tests portent le lot : **l'édition ne rejoue pas la progression**
  — corriger un verso laisse la boîte 3 et son échéance intactes, ce qu'aucun écran ne montre —,
  et **la taxonomie ne descend plus à
  `/revision`** alors que le thème de la carte en cours, lui, y est toujours : l'assertion tient
  les deux moitiés, l'absence seule serait verte sur un preload cassé. Plus le recto vide refusé
  **sans rien écrire**, et la suppression.
- `tests/unit/leitner_settings_page.spec.ts` — **CC-67**, le recalage du défilement après un import
  (`scrollTopKeepingAnchor`). ⚠️ Les deux cas nominaux vont dans des sens **opposés** et sont tous
  deux **asymétriques** : un signe inversé rendrait le bon résultat sur un delta nul, donc un seul
  cas — ou deux cas symétriques — ne prouverait rien. Plus le cas témoin (import entièrement
  dédupliqué : rien ne bouge, surtout pas « un peu ») et l'écrêtage à zéro. Ce qu'il ne voit
  **pas** : tout le reste du correctif — jsdom ne fait aucun layout, donc ni la hauteur du tableau,
  ni `scrollTop`, ni le `nextTick` avant la mesure, ni le choix du conteneur défilant.
- `tests/functional/modules/leitner_backup.spec.ts` — l'**aller-retour** (export → base vidée →
  import → base identique), le seul test qui valide la promesse de l'export. ⚠️ **Sa valeur tient
  entièrement dans son `snapshot()`** : une colonne que cette fonction ne lit pas peut être perdue
  par l'export sans qu'un seul test ne rougisse — c'est exactement ce qui a laissé passer CC-51.
  L'aller-retour porte une révision **jugée** et une **jamais jugée** (`null` doit se relire `null`,
  jamais `0` ni `''`), plus une troisième aux valeurs falsy (`answer: ''`, `thinkingMs: 0`) qui sont
  des mesures et non des absences. Depuis CC-119 le `snapshot()` lit la progression **de
  l'exportateur** (jointe par `preload` filtré) ; depuis CC-139 il porte aussi `shared` ; depuis
  CC-260, `kind`, `boxBefore`/`boxAfter` et les deux marques de maîtrise — et l'aller-retour porte
  désormais une **carte maîtrisée avec sa révision d'entretien**, sans laquelle les cinq colonnes
  du lot traverseraient à `null` des deux côtés et la comparaison serait verte en n'éprouvant rien.
  ⚠️ Vérifié en retirant chaque clé de l'export une à une : `kind`, la paire `boxBefore`/`boxAfter`
  et les deux marques font rougir l'aller-retour, chacune séparément. Le format
  est en **v4**, et quatre tests dédiés couvrent ce qui protège les sauvegardes existantes dans les
  deux sens : **un fichier v1 reste importable** et son contenu **redevient partagé**
  (`resolveShared`) — sa progression et son historique devenant ceux de celui qui importe ; **un
  fichier v3 écrit à la main, sans `shared`, importe une carte privée** — le défaut du contenu
  neuf, pas celui des vieux fichiers. Depuis CC-260, le même couple pour `kind` : **un fichier v3
  importe des révisions `normal`** (avec ses boîtes laissées **inconnues**, jamais reconstituées, et
  aucune marque de maîtrise inventée sur une carte importée en boîte 5) et **un fichier v4 qui
  déclare `maintenance` le conserve** — sans ce second test, un `resolveReviewKind` qui rendrait
  toujours `'normal'` passerait au vert. ⚠️ Le cas « version inconnue » de la liste des fichiers
  invalides est passé de `2` à `99` puis à nouveau `99` après les bumps CC-139 et CC-260 — laissé à
  une valeur devenue valide, il aurait viré au vert en n'éprouvant plus rien. **À revérifier à
  chaque bump.** Un test dédié, **« exclut le
  contenu privé des autres comptes »**, couvre le correctif de confidentialité de CC-139 :
  `export()` chargeait auparavant tout `leitner_cards` sans filtre.

## Le rendu Markdown des cartes (CC-133)

⚠️ **La brique elle-même n'est pas indexée ici, et c'est volontaire** : `renderMarkdown` vit dans
`app/core/shared/services/markdown_renderer.ts` (hors module — voir le `CLAUDE.md` du module), donc
sa spec est `tests/unit/markdown_renderer.spec.ts`, déclarée **transverse** dans
`tests_index.spec.ts`. C'est elle qui porte les deux mutations du lot ; lis son en-tête avant d'y
toucher, le résultat n'est pas celui qu'on attend.

- `tests/functional/modules/leitner_markdown.spec.ts` — le **branchement**, ce que l'unitaire ne
  peut pas dire. Son mode d'échec est muet : un `frontHtml` que le contrôleur oublierait de poser
  rend une carte **vide** à l'écran (`v-html` sur `undefined` n'affiche rien, sans erreur, et
  `tsc` ne lit pas les `.vue`). Trois tests : la file de révision porte le HTML **et** la source
  (⚠️ l'assertion sur la source est celle qui compte — l'édition, l'export, la dédup `(recto,
  thème)` et le prompt du juge travaillent tous dessus, et un contrôleur qui remplacerait `front`
  par son HTML les casserait tous les quatre d'un geste) ; une carte hostile ressort assainie
  jusque dans les props, **sans** que la base soit réécrite ; et **les écrans de liste ne
  reçoivent aucun HTML** — c'est le pendant, et il vaut autant, le recto y étant une *clé*
  (`cardLink`, `confirmDeleteCard`).
- `tests/functional/modules/leitner_llm.spec.ts` porte depuis CC-133 le seul cas du module où le
  HTML voyage dans un **JSON** (`fetch`) et non dans une prop Inertia : l'aperçu de génération.
  Aucun autre test ne couvrirait ce branchement-là.

## L'aperçu du rendu pendant la saisie (CC-257)

- `tests/functional/modules/leitner_preview.spec.ts` — **le test qui porte le lot est le premier** :
  le `frontHtml` que `/revision` pose en prop et celui que la route d'aperçu rend sont comparés par
  **égalité stricte**, sur la même source. C'est la seule chose qui tienne la promesse « l'aperçu
  montre ce que la révision montrera » — une option ajoutée d'un seul côté, une enveloppe
  intercalée, une couche d'assainissement retirée, et il rougit. ⚠️ Son témoin (`include` d'un
  `<strong>`) n'est pas décoratif : sans lui, un contrôleur qui rendrait `''` des deux côtés
  passerait l'égalité au vert. Le reste : les **deux** routes rendent la même chose, un contenu
  hostile ressort assaini (et **visible en texte**, `&lt;img`), un corps vide rend 200, la borne
  est éprouvée **des deux côtés du seuil** — trop serrée, elle refuserait ce que l'écran laisse
  écrire —, chaque route est fermée à qui a la capacité de l'**autre** écran, et l'aperçu n'écrit
  rien.
  ⚠️ **Toutes ses requêtes portent `accept: application/json`, et ce n'est pas de la décoration** :
  sans lui, un 422 devient un `redirect().back()` que le client de test **suit** jusqu'à `/`, qui
  répond 403 à un compte sans `dashboard.view`. Mesuré sur le premier jet du fichier — on croit à
  un défaut de capacité et on part corriger une route qui n'a rien.
- `tests/unit/leitner_card_preview.spec.ts` — les deux régressions que rien d'autre ne verrait.
  **(1)** `PREVIEW_MAX_CHARS` n'est déclaré qu'une fois : le spec relit les quatre fichiers qui la
  consomment et rougit si le littéral y réapparaît (CC-60 rejoué — deux bornes divergentes rendent
  le panneau muet, la page postant ce que le validateur refuse). ⚠️ Il attrape la **recopie
  littérale**, pas un `20 * 1000`. **(2)** tout `v-html` du module porte la classe `markdown` :
  sans elle, le Preflight de Tailwind laisse les `ul` sans puces et les titres à la taille du
  texte — l'aperçu ment, avec les trois gates au vert. Le balayage porte sur **tout le module**,
  pas sur les seuls fichiers du lot. ⚠️ **Son plancher (`isAtLeast(vus, 5)`) n'est pas décoratif** :
  vérifié en cassant la racine du balayage, l'assertion principale passe alors au **vert** en
  n'ayant rien comparé, et seul le plancher rougit — même mode d'échec que `tests_index.spec.ts`.

## Le rôle invité : ce qu'il révise (CC-121), ce qui lui reste fermé (CC-72)

- `tests/functional/modules/leitner_guest.spec.ts` — le rôle invité **exact** de CC-121
  (`leitner.view` + `leitner.stats.view` + `leitner.review`) qui déroule une session **entière**,
  de l'écran de choix à la file vide.
  ⚠️ **Ce fichier n'existe que pour ce que les autres ne disent pas.** Toute la suite du module
  tourne déjà sous des comptes non-admin porteurs de `leitner.review` : « un invité peut noter »
  y est vrai par construction. Ce qu'aucun autre ne fait, c'est **plus d'un tour de boucle** — ils
  notent une carte et s'arrêtent. Or c'est exactement là que vivait le symptôme rapatrié de CC-81 :
  l'écran est sans état, la file n'avance **que** par la note, et sans `leitner.review` il n'existait
  aucun mécanisme d'avancement.
  ⚠️ **Chaque tour navigue vers `response.headers().location`, jamais vers une URL écrite dans le
  test** : la session se déroule par ce que le serveur renvoie, donc le `withQs()` (piège n° 1 du
  module) est éprouvé à *chaque* note. Vérifié en le retirant — le test rougit en nommant l'écran
  de choix (`expected 'choice' to equal 'session'`), et c'est pour ça que `view` est lu **avant**
  `dueCards` : sans cette ligne, l'échec serait un accès à `undefined`.
  Deux gardes du montage, sans lesquelles il passerait au vert sans rien prouver : le compte dû
  asserté sur l'écran de choix **avant** d'entrer (une file vide dès le départ ferait sortir la
  boucle au premier tour), et la boucle **bornée à 10** avec un `again` au premier tour — quatre
  présentations pour trois cartes, la ratée revenant en fin de file. Plus, en sortie : la
  progression du **propriétaire admin** inchangée, et le juge ouvert à ce profil, prouvé **contre un
  faux client qui lève** — la réponse étant le verso exact, un verdict `juste` dit du même coup
  qu'aucun appel n'est parti vers un LM Studio réellement allumé.
- `tests/functional/modules/leitner_readonly.spec.ts` — le pendant : ce que les capacités
  **ferment**, en **deux** profils, et il faut les deux. Le *lecteur strict* de CC-72 (`view` +
  `stats.view`) prouve que `leitner.review` ferme encore — sans ce groupe plus rien ne le dirait,
  le profil courant la portant désormais. L'*invité* de CC-121 prouve que la révision n'ouvre **rien
  d'autre** : contenu, taxonomie, intervalles, ingestion, LLM, export **et import**.
  ⚠️ **L'assertion qui compte n'est jamais le 403, c'est l'état de la base après le refus.** Les
  tests sont **tous côté serveur** : masquer un bouton n'est pas un droit, un `curl` muni d'un
  cookie valide n'a que faire du rendu Vue. Le refus sur une **route JSON nue** est couvert deux
  fois (le juge, l'extraction) — un 403 avec corps JSON, jamais une redirection, sans quoi les
  écrans appelés en `fetch` casseraient au lieu de dire non.
  ⚠️ **La moitié de sa justification est tombée avec CC-119, l'autre pas**, et c'est la distinction
  que le fichier tient : `box` et `next_review` ne sont plus des colonnes de la carte, ce qui a
  autorisé CC-121 à accorder `leitner.review` ; `leitner_settings` reste une ligne unique et un
  réglage d'**installation**, donc fermée. Le test de l'import a été vérifié en dégardant la route :
  il rougit en 302.
  ⚠️ **Le refus sur `/revision/llm` n'a aucun état à assertir, et c'est assumé** — ces routes
  n'écrivent rien ; ce qu'elles font, c'est faire émettre au serveur des requêtes vers une URL
  saisie.

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
