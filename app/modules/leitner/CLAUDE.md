# Module Leitner — répétition espacée

Route `/revision` (⚠️ **pas** `/leitner`) · pages Inertia `modules/leitner/index`,
`modules/leitner/settings`, `modules/leitner/ingest`, `modules/leitner/ingest_show`,
`modules/leitner/llm` · tables `leitner_cards`, `leitner_reviews`, `leitner_categories`,
`leitner_themes`, `leitner_settings`, `leitner_ingestions`, `leitner_draft_cards`.

Quatre écrans, une barre d'onglets (`components/LeitnerTabs.vue`) : **Révision** (`/revision`) ·
**Cartes** (`/revision/settings`) · **Ingestion** (`/revision/ingest`) · **Configuration**
(`/revision/llm`).

⚠️ **`components/` n'est pas `pages/`.** La résolution Inertia fait un glob sur les `.vue` de tout
dossier `pages/` (`inertia/app/app.ts`) : un composant partagé posé là deviendrait une page. Les
composants du module vivent dans `components/` et s'importent relativement (`../components/…`).

```
controllers/leitner_controller.ts          révision seule : index (choix OU session) · review
controllers/leitner_settings_controller.ts écran de gestion : CRUD cartes + taxonomie + intervalles
                                           + export/import JSON
controllers/leitner_ingestion_controller.ts ingestion d'un cours par un LLM local : formulaire +
                                           historique · extraction du texte d'un fichier (n'écrit
                                           RIEN) · page de suivi d'UN travail · renommage ·
                                           brouillons, relecture, promotion
controllers/leitner_llm_controller.ts      configuration du LLM : détection, /models, génération de
                                           contrôle — n'écrit RIEN (ni base, ni disque)
services/leitner_service.ts                règle métier (boîtes, intervalles, stats) ← source de vérité
                                           + la FILE de révision : dueCards(scope), resolveScope,
                                           dueScopeChoices
services/leitner_scope.ts                  la PORTÉE : le type `CardScope` et `applyScope` — l'unique
                                           copie de la sous-requête catégorie → thèmes
services/leitner_catalog_service.ts        catalogue : filtres, CRUD cartes, catégories/thèmes
                                           ← seul point d'écriture d'une carte, porte la dédup
services/leitner_backup_service.ts         export/import JSON — le filet de sécurité du module
services/leitner_ingestion_service.ts      titre déduit, découpage, appels LLM, TÂCHE DE FOND,
                                           brouillons au fil de l'eau + balayage au démarrage
                                           (`sweepInterruptedIngestions`)
services/leitner_pdf_service.ts            un fichier (.txt · .md · .pdf) → son texte : octets
                                           magiques, extraction unpdf, nettoyage, et les six refus
                                           (scan · chiffré · corrompu · pas un PDF · pages · taille)
services/llm_client.ts                     client /v1/chat/completions + sonde /v1/models
                                           — INJECTÉ (jamais en dur)
models/leitner_card.ts                     hasMany reviews · belongsTo theme (nullable)
models/leitner_review.ts                   belongsTo card
models/leitner_category.ts                 hasMany themes
models/leitner_theme.ts                    belongsTo category · hasMany cards
models/leitner_settings.ts                 réglages du module — UNE seule ligne (id = 1)
models/leitner_ingestion.ts                le travail : titre, statut, source, compteurs, erreur
models/leitner_draft_card.ts               une carte PROPOSÉE, rattachée à son ingestion
validators/leitner.ts                      card · review · reviewScope (la portée, dans la query
                                           string) · cardIds · cardsTheme · category · theme
                                           · boxIntervals · backup · backupImport
                                           · courseIngestion (SANS fichier : que du texte)
                                           · documentExtract (le seul à porter un fichier)
                                           · ingestionTitle · draftCard · draftIds
                                           · llmDetect · llmModels · llmTest (LISTE BLANCHE SSRF)
components/LeitnerTabs.vue                 la barre d'onglets des quatre écrans (PAS dans pages/)
components/IngestionTitle.vue              le titre d'un travail, renommable en ligne (PAS dans pages/)
components/LeitnerScopePicker.vue          l'écran de choix d'une portée (PAS dans pages/)
pages/index.vue                            choix d'une portée OU session de révision (`view`) · fin de
                                           portée · grille des 5 boîtes
pages/settings.vue                         tableau des cartes · création/édition · sélection
                                           multiple · taxonomie · intervalles des boîtes
pages/ingest.vue                           soumission d'un cours (formulaire VIERGE) · le chargeur
                                           de fichier et la prévisualisation éditable · historique
pages/ingest_show.vue                      la page d'UN travail : progression · brouillons · échec
pages/llm.vue                              configuration du LLM : le fil rouge en quatre étapes
migrations/                                cards PUIS reviews PUIS categories/themes PUIS settings
                                           PUIS ingestions PUIS draft_cards PUIS title
                                           (FK : l'ordre du nom de fichier compte)
```

**Aucun seeder, et c'est voulu** : tout le contenu (cartes, catégories, thèmes) est saisi depuis
l'UI. Le module n'a pas de dossier `seeders/`, et `config/database.ts` ne déclare aucun path de
seeder pour lui — c'est le seul module dans ce cas. Ne réintroduis pas de données de démo : elles
écraseraient le contenu réel de l'utilisateur au prochain `db:seed`.
La ligne de `leitner_settings` insérée par la migration n'est pas une donnée de démo mais la
configuration du module : ne la supprime pas.

Le filet de sécurité n'est donc pas un seeder mais **l'export JSON** (`/revision/settings`) : les
cartes n'existent qu'en base, saisies à la main, sans autre copie. Voir « Sauvegarde » plus bas.

La base, elle, vit dans `./pgdata` (bind mount, voir le `CLAUDE.md` racine) : un
`docker compose down -v` ne l'emporte **plus** — mais une corruption, un `rm -rf` ou un changement
de machine, si. L'export reste donc le filet, et `npm run db:backup` le complète.

⚠️ Ce module touche **cinq** fichiers hors de son dossier, et pas un seul :

- `start/routes.ts` — toutes ses routes (`PUT /revision/settings/intervals`, `GET /revision/export`,
  `POST /revision/import`, `GET|POST /revision/ingest`, `POST /revision/ingest/extract`,
  `GET /revision/ingest/:id`…).
- `start/env.ts` — les variables du serveur LLM (`LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`,
  `LLM_TIMEOUT_MS`).
- `.env.example` — leur documentation.
- `config/llm.ts` — la configuration typée du client LLM, et ses valeurs par défaut.
- `providers/leitner_provider.ts` — le **balayage au démarrage** des ingestions interrompues
  (déclaré dans `adonisrc.ts`, sous `environment: ['web']`). C'est le prix de la tâche de fond :
  voir « Le cycle de vie d'un travail » plus bas.

## Un seul point de saisie : `/revision/settings`

`/revision` **ne fait que réviser** : aucune création, aucune édition. Toute écriture sur une carte
(créer, éditer, supprimer, classer) passe par `settings.vue` et `LeitnerSettingsController` —
`POST /revision/cards` y compris, alors que l'URL vit sous le préfixe `/revision`. Ne réintroduis pas
de formulaire dans `index.vue` : la page renvoie vers la gestion (lien du header, bouton de l'état
vide), et son contrôleur n'a plus besoin de `LeitnerCatalogService`.

Deux autres voies **ajoutent** des cartes — l'import JSON et l'ingestion d'un cours par un LLM
(`/revision/ingest`) — mais aucune n'écrit sur `LeitnerCard` : toutes passent par
`LeitnerCatalogService`, qui reste le seul point d'écriture d'une carte et porte la déduplication.

La modale de `settings.vue` sert à la fois à créer (`editing === null`) et à éditer. En création,
« Créer et enchaîner » (`submitCard(true)`) la laisse ouverte en conservant le thème : la saisie se
fait en général par séries sur un même sujet. `@submit.prevent="submitCard()"` s'écrit **avec les
parenthèses** — sans elles, Vue passe l'événement en `keepOpen` et la modale ne se ferme jamais.

## La portée d'une session : `/revision` a deux visages

`/revision` **nu** est l'écran de **choix** (que réviser ce soir ?) ; `/revision?scope=all`,
`?scope=unclassified`, `?category=<id>` ou `?theme=<id>` est la **session**, restreinte à cette
portée. Une seule page Inertia (`modules/leitner/index`), un prop `view` qui tranche — d'où le fait
que `tests/functional/modules/pages.spec.ts` tienne sans modification.

### La portée vit dans l'URL, et nulle part ailleurs

**Rien en base, rien en session.** La portée est un *geste*, pas un *réglage* : elle ne survit pas à
la session et n'a pas à le faire. Une colonne `current_scope` dans `leitner_settings` serait un état
à invalider (thème supprimé, plus rien de dû, deux onglets ouverts) pour un gain nul — et
`leitner_settings` porte la **configuration** du module, pas ce que l'utilisateur est en train de
faire. Deux onglets, deux portées, aucun conflit possible : c'est la propriété qu'on achète.

C'est gratuit parce que **la page n'a aucun état** : `currentCard` vaut `dueCards[0]`, `review()`
redirige en arrière, la page se recharge et **re-requête**. Il n'y a rien à reprendre, rien à
invalider. Aucune route nouvelle non plus : la portée est une query string sur `GET /revision`.

⚠️ **`response.redirect().withQs().back()` — le `withQs()` n'est pas décoratif.** `back()` renvoie
sur le `referer` mais **sur son seul `pathname`** : il **jette la query string**
(`Redirect.back()`, @adonisjs/http-server — le `#forwardQueryString` vaut `false` par défaut). Sans
`withQs()`, `?theme=3` disparaîtrait **à chaque note**, en silence : la session repartirait sur
toutes les cartes dues sans une erreur ni un log. Ne le retire pas, et ne remplace pas ce `back()`
par un `toRoute()`. C'est le piège n° 1 du module ; son test est
`leitner_scope.spec.ts` → « noter une carte CONSERVE la portée », et il **assert l'en-tête
`location` brut** — `assertRedirectsTo` ne compare que le chemin, il laisserait passer exactement
cette régression.

### La fin d'une portée est une file vide — jamais un compteur

⚠️ **`again` laisse la carte due le jour même** (voir « La règle métier ») : elle reste dans
`dueCards` et revient en fin de file, **dans la portée**. Donc **« la fin d'un thème » n'arrive que
quand plus aucune de ses cartes n'est due — y compris celles qu'on vient de rater**. C'est voulu.

L'écran de fin se déclenche donc sur une **re-requête vide** dans la portée, **jamais** sur un
compteur de cartes vues. Compter les cartes présentées et s'arrêter à N reproduirait l'erreur que
l'ordre de la file existe pour éviter : une carte ratée disparaîtrait de la session.

Aucune **redirection automatique** à la fin : l'utilisateur doit *voir* qu'il a fini — un retour auto
à l'écran de choix se lirait comme un bug. Deux gestes : « Choisir une autre portée » (`/revision`) ou
« Arrêter » (`/`).

⚠️ **« Terminée » et « vide dès le départ » sont la même file vide** — ouvrir `?theme=7` sur un thème
sans carte due doit dire « rien à réviser », **pas** « terminé, bravo » : on n'a rien fait. Seul
`LeitnerService.hasReviewedTodayInScope(scope)` les sépare, et il rend un **booléen, pas un
compteur** : aucun chiffre n'est affiché sur cet écran. `reviewedToday()` ne pourrait de toute façon
pas servir — il est **global**, il annoncerait les cartes revues dans *tous* les thèmes, et un chiffre
faux est pire que pas de chiffre. Limite acceptée : une carte révisée ce matin puis déplacée dans un
autre thème fait dire « rien à réviser » à son ancien thème.

### Le refus, jamais le repli

⚠️ **Un id inexistant ne retombe JAMAIS sur « tout ».** Un thème supprimé depuis un autre onglet, et
l'utilisateur réviserait l'intégralité de sa base en croyant travailler Docker. `resolveScope` rend
un résultat **ou** un refus — son type n'a pas de troisième cas, et pas de valeur par défaut.
`category` **et** `theme` ensemble : refus aussi. Pas de « le dernier gagne », pas de « le plus
précis gagne » : une combinaison qu'on n'a pas voulue est une erreur, pas une devinette.

Le refus **redirige vers `/revision` avec un flash** (`scopeError`), plutôt qu'un 404 : le cas réel
n'est pas une URL bricolée mais un thème supprimé — l'utilisateur doit atterrir là où il peut agir.
La validation de forme (`reviewScopeValidator`) est enveloppée dans un `try/catch` pour la même
raison : laisser filer l'exception redirigerait sur le `referer`, donc sur l'URL fautive elle-même.

### Les comptes de l'écran de choix sont des comptes DUS

Chaque ligne montre son nombre de cartes **dues**, pas son total : un thème de 200 cartes dont 0 est
due n'a aucun intérêt ce soir. ⚠️ **`LeitnerCatalogService.categoryTree()` ne convient donc pas** —
son `withCount('cards')` compte les cartes **totales**. C'est `LeitnerService.dueScopeChoices()`, et
il compte en **une requête** (`group by leitner_theme_id`) agrégée en JS, jamais une par thème.

⚠️ Postgres rend `count(*)` en `bigint`, donc en **chaîne** : sans `Number()`, les sommes de
catégorie concatèneraient (`'1' + '1'` = `'11'`). Le test porte sur le total d'une catégorie — un
compte de thème seul ne l'attraperait pas, `assert.equal` de chai étant laxiste (`==`).

### Stats de portée vs stats globales — la distinction n'est pas devinable

| mesure | portée ? | pourquoi |
| ------ | -------- | -------- |
| `dueCount`, grille des 5 boîtes | **suit la portée** | c'est ce qu'on est en train de réviser : la grille doit décrire *ça* |
| `streak`, `reviewedToday`, `retention` | **globaux** | ce sont des mesures d'**habitude**, pas de thème. Une série de 40 jours qui retomberait à zéro parce qu'on a ouvert un autre thème serait absurde |
| `totalCards` | **global** | un inventaire, dans la même rangée que les trois précédentes. Contrepartie assumée : la grille scopée ne somme pas au « total cartes » affiché |

## La règle métier

Les intervalles (jours avant la prochaine révision, boîte par boîte) **vivent en base**, dans la
ligne unique de `leitner_settings`, et se règlent depuis `/revision/settings`. Lis-les avec
`LeitnerService.boxIntervals()`. `DEFAULT_BOX_INTERVAL_DAYS = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 30 }`
n'est **que** la valeur de départ (posée par la migration, et filet de sécurité si la ligne
disparaît) : ne t'en sers jamais pour calculer une échéance, elle peut ne plus refléter le réglage.

Chaque note a un effet distinct :

| note    | boîte atteinte                            | `next_review`              |
| ------- | ----------------------------------------- | -------------------------- |
| `again` | **inchangée**                             | **aujourd'hui**            |
| `hard`  | inchangée — sauf **2ᵉ `hard` d'affilée** → 1 | intervalle de cette boîte |
| `good`  | +1                                        | intervalle de cette boîte  |
| `easy`  | +2                                        | intervalle de cette boîte  |

- La boîte est plafonnée à 5. `next_review` = aujourd'hui + l'intervalle **réglé** pour la boîte
  **atteinte** (après mouvement) — `again` est la **seule** note qui laisse la carte due le jour
  même, et le seul cas où aucun intervalle ne s'applique.
- **`again` ne rétrograde pas**, et ce n'est pas un oubli : c'est « remets-la moi maintenant », pas
  une sanction. La carte reste dans sa boîte, redevient due, et **revient en fin de file dans la
  session en cours**, jusqu'à ce qu'elle passe. Rater une fois ne défait pas ce qui a été acquis —
  seule la promotion est suspendue. Toute autre note repousse l'échéance d'au moins un jour, donc
  vide la carte de la session du jour.
- ⚠️ **Le « 2ᵉ `hard` d'affilée » est donc le seul chemin de rétrogradation du module.** Aucune
  quantité de `again` ne fait descendre une carte : une carte de boîte 5 qu'on rate tous les jours
  reste en boîte 5, et repart à l'intervalle de la boîte 5 dès le premier `good`. C'est le prix
  assumé d'un `again` sans sanction ; si ce comportement gêne un jour, c'est **cette ligne** qu'il
  faut rouvrir, pas l'ordre de la file.
- « Deux `hard` d'affilée » = la **dernière révision enregistrée** pour cette carte était déjà
  `hard`, quel que soit le délai entre les deux (`LeitnerService.lastGrade`). Stagner deux fois
  n'est pas savoir. Un `hard` séparé du précédent par une autre note ne rétrograde pas — **y compris
  par un `again`**, qui remet donc le compteur à zéro.

**L'ordre de la file dépend de cette règle.** `LeitnerService.dueCards(scope)` trie
`next_review` asc → `updated_at` asc → `id` asc. **Ne trie jamais par `box`** : depuis qu'`again`
laisse la boîte intacte, un tri par `box` rendrait la carte ratée **à la même place** qu'avant la
note — elle se re-présenterait aussitôt, en boucle, et la session serait bloquée sur elle. C'est
`updated_at` qui la renvoie en fin de file : la noter l'écrit, donc elle devient la plus récemment
touchée, donc la dernière. **Le ciblage par thème n'y change rien** : la portée retire des cartes,
elle ne réordonne pas.

La requête vit dans le **service**, pas dans le contrôleur : c'est la règle métier, et c'est ce qui
la rend testable unitairement (`tests/unit/leitner_due_cards.spec.ts`) — l'ordre n'était jusque-là
verrouillé que par un test fonctionnel.

**Rétention** (`leitner_controller.ts::globalStats`) : `grade !== 'again'`. `hard` compte comme une
**réussite** — la réponse a été rappelée, péniblement ; ce n'est pas un échec de rappel, même
depuis qu'il ne fait plus progresser la carte.

**Les boutons annoncent leur effet.** `pages/index.vue` reçoit `boxIntervals` (les intervalles
réglés, envoyés par le serveur — la page ne les redéclare jamais) et le `lastGrade` de chaque carte
due : chaque bouton affiche la boîte atteinte et l'échéance — y compris « 2ᵉ d'affilée · boîte 1 »
quand la note précédente était `hard`. Ne réintroduis pas de libellés muets : quatre boutons opaques
valent l'ancien bug de quatre boutons identiques.

## Les intervalles se règlent : `leitner_settings`

Une **seule** ligne, `id = 1`, protégée par un `check` en base — n'en crée jamais une seconde,
`LeitnerService.settings()` lit celle-là (`firstOrCreate`). Les colonnes sont `box_1_days` …
`box_5_days` ; le modèle les mappe **explicitement** (`columnName`), sans se fier à la conversion
automatique d'un identifiant qui mêle lettres et chiffres.

- Bornes : **1 à 365 jours** (`boxIntervalsValidator`). Un intervalle à **0 est refusé** — il
  laisserait la carte due le jour de sa réussite, donc éternellement en session : c'est le
  privilège de `again`, et de lui seul.
- `updateBoxIntervals()` **ne recalcule aucune échéance** : les cartes déjà notées gardent le
  `next_review` posé avec l'ancien intervalle, le nouveau réglage ne vaut que pour les révisions
  suivantes. C'est volontaire — rejouer les échéances déplacerait des cartes que l'utilisateur
  n'a pas revues.
- La valeur par défaut est dupliquée à deux endroits, et c'est assumé : `DEFAULT_BOX_INTERVAL_DAYS`
  et les assertions de `tests/unit/leitner_service.spec.ts` (un test qui importerait la constante
  n'asserterait plus rien). Le `defaultTo()` de la migration en est un troisième — mais lui ne vaut
  que pour une base neuve.

## Le classement : catégorie → thème

Une carte porte **un thème** (`leitner_theme_id`, nullable = « non classée »), et un thème
appartient à **une catégorie**. Il n'y a pas de classement multiple : la colonne `tags` (`text[]`)
qui existait avant a été **supprimée**, son contenu repris en thèmes sous une catégorie `Import`
(migration `1782911000003`). Une catégorie `Import` vide qui traîne en base est ce résidu :
elle se supprime depuis `/revision/settings`.

- `leitner_themes` : unique sur **(catégorie, nom)** — « Docker » peut vivre sous DevOps *et* Cloud.
- Supprimer une **catégorie** → ses thèmes partent en CASCADE, ses cartes deviennent non classées.
- Supprimer un **thème** → ses cartes deviennent non classées (`ON DELETE SET NULL`).
  **Aucune suppression de carte n'est jamais implicite** ; seule la suppression explicite d'une
  carte détruit des données (et emporte ses révisions, en CASCADE).
- `LeitnerCatalogService` renvoie **`null`** quand un nom de catégorie/thème est déjà pris : le
  contrôleur en fait une erreur de formulaire (`session.flash('errors')`), il ne lève pas.

## Sauvegarde : l'export JSON

`GET /revision/export` (`LeitnerSettingsController::exportBackup` → `LeitnerBackupService`) rend un
instantané complet : taxonomie, cartes (boîte, échéance, horodatage) et **historique des
révisions**. Sans l'historique, une restauration remettrait la série à zéro, viderait la rétention
30 j — et surtout **réarmerait la règle du « 2ᵉ `hard` d'affilée »**, qui lit la dernière révision
enregistrée (`lastGrade`).

```json
{
  "version": 1,
  "exportedAt": "2026-07-13T14:12:03.000Z",
  "categories": [{ "name": "DevOps", "themes": ["Docker", "Kubernetes"] }],
  "cards": [
    {
      "front": "Rôle du handshake TLS ?",
      "back": "Négocier clés et algorithmes.",
      "category": "DevOps", "theme": "Docker",
      "box": 3, "nextReview": "2026-07-20",
      "createdAt": "2026-07-01T08:00:00.000Z", "updatedAt": "2026-07-13T09:02:00.000Z",
      "reviews": [{ "grade": "good", "reviewedAt": "2026-07-13T09:02:00.000Z" }]
    }
  ]
}
```

- **La taxonomie est désignée par son nom, jamais par un id — et le fichier n'en contient aucun.**
  Réinjecter un id casserait les séquences Postgres (`leitner_cards_id_seq` ne suit pas un insert à
  id explicite) : le prochain ajout depuis l'UI planterait sur un doublon de clé primaire.
- Une carte non classée **omet** `category` et `theme` (plutôt que `null`) : le fichier se relit et
  se retouche à la main.
- `nextReview` est un jour calendaire (`YYYY-MM-DD`, colonne `date`) ; `reviewedAt`, `createdAt` et
  `updatedAt` sont des horodatages ISO complets (`timestamp`). Ne pas les intervertir.
- `createdAt` / `updatedAt` sont exportés **parce que l'ordre de la file de révision en dépend**
  (`next_review` asc → `updated_at` asc → `id` asc) : sans eux, toutes les cartes restaurées
  prendraient l'instant de l'import et la carte ratée hier ne repasserait plus en fin de file.
- Les **intervalles** (`leitner_settings`) ne sont **pas** dans le fichier : c'est la configuration
  du module, pas du contenu. Une base restaurée repart sur `DEFAULT_BOX_INTERVAL_DAYS` et se
  re-règle depuis l'UI ; les échéances importées, elles, sont intactes — `next_review` est stocké,
  jamais recalculé.

⚠️ **Le téléchargement ne peut pas passer par Inertia.** Toutes les autres routes du module rendent
un `inertia.render` ou un `redirect().back()` ; l'export est une **réponse HTTP nue**
(`application/json` + `content-disposition: attachment`). Côté Vue, le lien est un `<a href>` natif
— **jamais** `<Link>` ni `router.get()`, qui attendent une réponse Inertia et cassent sur du JSON
brut. Le bug ne se voit qu'au clic dans un vrai navigateur : au `curl` comme en test fonctionnel,
la réponse paraît parfaite.

## L'import : le même format, deux usages

`POST /revision/import` lit exactement ce que l'export écrit. **Seuls `front` et `back` sont
obligatoires** : le reste prend les valeurs d'une carte créée depuis l'UI (boîte 1, due
aujourd'hui). Un fichier de saisie en masse se réduit donc à :

```json
{ "cards": [{ "front": "…", "back": "…", "category": "DevOps", "theme": "Docker" }] }
```

**L'import n'ajoute que ce qui manque. Il n'y a pas de mode « remplacer », et c'est voulu** :
aucune route de ce module ne détruit du contenu en masse. Restaurer, c'est importer dans une base
vide — nouvelle machine, base perdue — et il n'y a alors rien à écraser.

- **Déduplication sur le couple (recto, thème)** — contre la base *et* contre le fichier lui-même,
  donc rejouer deux fois le même fichier n'ajoute rien. Le même recto sous **deux thèmes** reste
  deux cartes. Revers assumé : deux cartes réellement identiques (même recto, même thème) n'en font
  **qu'une** après un aller-retour — c'est le prix de l'idempotence, et c'est un choix explicite.
- **La taxonomie est fusionnée par nom, jamais dupliquée** : une catégorie « DevOps » déjà présente
  est réutilisée (`leitner_categories.name` est unique, `leitner_themes` unique sur (catégorie,
  nom)). Elle est créée à la volée si une carte la mentionne sans que le bloc `categories` l'ait
  déclarée. `category` et `theme` vont **toujours ensemble** : l'un sans l'autre est une erreur, pas
  une carte non classée.
- Une carte existante n'est **jamais écrasée** : son verso, sa boîte et son échéance survivent à un
  import qui contiendrait le même recto.
- **`version` inconnue → refus**, avec un message. Un import « au mieux » sur un format qu'on ne
  comprend pas écrit des données fausses en silence. Un fichier **sans** `version` est un fichier
  écrit à la main : il est lu comme la version courante.
- **Tout ou rien** : `db.transaction()` + `{ client: trx }` sur chaque écriture. Sans ça, un fichier
  qui casse à la 300ᵉ carte laisserait 299 cartes derrière lui.
- Le retour d'import (rapport ou erreurs) passe par un **flash** relu dans `index` et renvoyé en
  props (`importReport`, `importErrors`) : Inertia ne partage automatiquement que `errorsBag`, et
  `config/inertia.ts` est hors du module.

⚠️ **`box` est validée entre 1 et 5, et c'est le seul rempart.** La colonne n'a **aucune contrainte
en base**. Une carte importée en boîte 12 puis notée `hard` y resterait : `boxIntervals()[12]` vaut
`undefined`, Luxon fait `plus({ days: undefined })` = +0 jour et rend une date **valide** —
`next_review` = aujourd'hui, indéfiniment. Aucune exception, aucun log. Ne relâche jamais cette
borne dans `backupValidator`.

⚠️ **Ne réinjecte jamais les ids.** Les séquences Postgres (`leitner_cards_id_seq`) ne suivent pas
un insert à id explicite : le prochain ajout depuis l'UI planterait sur un doublon de clé primaire.
C'est toute la raison de la taxonomie par nom.

## L'ingestion d'un cours par un LLM local

> Côté usage — quel modèle charger, comment brancher LM Studio / llama.cpp / vLLM / Ollama, et quoi
> faire quand ça casse : voir **`LLM.md`**, dans ce dossier.

`/revision/ingest` : on colle un cours (ou on charge un `.txt` / `.md` / `.pdf`), un LLM **local** en
extrait les grands principes, et rend des **cartes proposées**. Le modèle propose, l'utilisateur
relit, corrige, valide — et c'est seulement là que les cartes entrent en base. Une carte issue d'un
cours est ensuite une carte comme une autre : boîte 1, due aujourd'hui.

Deux tables : `leitner_ingestions` (le travail : statut, source, compteurs, erreur) et
`leitner_draft_cards` (les cartes **proposées** — ni boîte, ni échéance : ce ne sont pas des cartes).

### La frontière de confiance — le point à ne pas régresser

⚠️ **L'URL que l'ingestion utilise vient de l'environnement, jamais d'un formulaire ni de la base.**
`LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`, `LLM_TIMEOUT_MS` (`start/env.ts` → `config/llm.ts`). Une
URL de serveur **persistée** depuis un formulaire serait une **SSRF** : le serveur émettrait, à
chaque ingestion, des requêtes vers l'hôte du choix de celui qui a écrit dans ce champ. C'est le
raisonnement du module `agents` sur `config.command`, appliqué ici.

L'onglet « Configuration » (`/revision/llm`) **teste** des URL candidates avant qu'on ne les colle
dans `.env` — en mémoire, sans rien persister, et sous liste blanche (loopback et plages privées).
Voir plus bas : c'est une exception bornée, pas une réouverture.

⚠️ **Le texte du cours est du contenu non fiable** : il peut contenir des instructions adressées au
modèle. C'est acceptable — le dégât maximal est une carte absurde, arrêtée par la relecture humaine —
**à condition** que rien de ce que sort le modèle ne soit jamais exécuté, interprété comme du SQL, ni
utilisé comme identifiant. D'où :

- la taxonomie proposée est **du texte, un nom** (colonnes `category` / `theme` de
  `leitner_draft_cards`), jamais un id : les séquences Postgres ne suivent pas un insert à id
  explicite, et un id venu du modèle n'a de toute façon aucun sens ;
- **la boîte est imposée à 1** ; ce que le modèle dirait d'une boîte, d'une échéance ou d'un id est
  **jeté avant validation** (`parseLlmCards`). La borne 1..5 reste le seul rempart — la colonne n'a
  aucune contrainte en base.

### La voie fichier : un chargeur de texte, pas une soumission

⚠️ **Le champ fichier ne soumet plus rien.** Choisir un fichier appelle
`POST /revision/ingest/extract`, qui rend son **texte** et remplit le `<textarea>` ; c'est ce texte,
**relu et corrigé**, que `POST /revision/ingest` reçoit ensuite. Le flux :

```
choisir un fichier → POST /revision/ingest/extract → le texte remplit le <textarea>
                   → l'utilisateur relit, coupe, corrige
                   → POST /revision/ingest (le flux existant, inchangé)
```

Prévisualiser veut dire que le texte existe **avant** que le travail ne soit créé. D'où trois
conséquences, toutes voulues :

- **`store()` ne lit plus aucun fichier** : il ne reçoit que du texte. `LeitnerPdfService` est le
  seul à toucher un fichier, et il n'écrit rien en base.
- **`.txt` / `.md` passent par le même chemin**, alors qu'ils étaient lus dans `store()`. Un PDF
  qui se prévisualise pendant qu'un `.md` part à l'aveugle serait une incohérence gratuite.
- La route d'extraction rend du **JSON nu** (comme celles de `/revision/llm`, et pour la même
  raison) : la page l'appelle en `fetch`, donc avec l'en-tête **`x-xsrf-token`** et
  `accept: application/json`. Elle **n'écrit rien** — ni ingestion, ni brouillon.

⚠️ **`source` et `sourceName` sont donc DÉCLARATIFS.** C'est le client qui a fait l'extraction :
c'est lui qui annonce l'origine. Quelqu'un peut coller du texte en le disant tiré de « cours.pdf ».
Le dégât est **cosmétique** — un faux nom de fichier dans l'historique — et acceptable **à trois
conditions, qui sont le prix de la prévisualisation** : ces champs sont **bornés en longueur**
(`courseIngestionValidator`), **jamais interprétés** (`sourceName` n'est pas un chemin, rien ne le
rouvre ; `source` est une valeur d'une liste fermée), et **seulement stockés puis affichés**.
Ne bâtis jamais quoi que ce soit dessus. `source` est une colonne `string(16)` : la valeur `pdf`
n'a demandé **aucune migration**.

### Le PDF : ce qu'il rend, et ce qu'il refuse

`unpdf` (un build moderne de pdf.js, sans worker à câbler en Node ESM). **Ne le remplace pas par
`pdf-parse`** : il embarque un pdf.js 1.x sans correctifs.

⚠️ **On parse du binaire hostile dans le processus.** pdf.js a connu une exécution de code
arbitraire par une police piégée (CVE-2024-4367) quand `eval` est autorisé. D'où
`isEvalSupported: false`, passé **explicitement** (même si `unpdf` le pose par défaut : une garantie
ne se lit pas dans un `node_modules`), et rien qui aille chercher au dehors ni dans les polices du
système.

Six refus, **six messages distincts** — les fondre dans un « fichier invalide » générique rendrait
l'écran inutile, exactement la faute que `/revision/llm` a évitée en montrant l'échec brut :

| refus            | déclencheur                                                                |
| ---------------- | -------------------------------------------------------------------------- |
| `not-a-pdf`      | les octets ne commencent pas par `%PDF-` — **l'extension ne prouve rien**   |
| `encrypted`      | pdf.js lève `PasswordException` (reconnue par son `name`, stable)           |
| `corrupt`        | toute autre exception à l'ouverture                                         |
| `no-text`        | ratio caractères / pages sous `MIN_CHARS_PER_PAGE`                          |
| `too-many-pages` | plus de `MAX_PDF_PAGES`, vérifié **avant** d'extraire                       |
| `too-long`       | plus de `MAX_COURSE_CHARS`, dès l'extraction                                |

⚠️ **Le scan se détecte par page, jamais sur un total.** Un PDF de 200 pages scannées rend quand
même quelques centaines de caractères (numéros de page, filigranes) : un seuil global les laisserait
passer, et le travail partirait au LLM pour ne rien produire. Le fixture `tests/fixtures/scan.pdf`
est fait pour ça — ses quatre pages portent chacune leur numéro. **L'OCR est hors périmètre,
définitivement** : un PDF sans couche texte est refusé, jamais deviné.

⚠️ **Les deux plafonds ne font pas double emploi.** Un PDF de 8 Mo peut porter 600 pages :
`MAX_COURSE_CHARS` les rejetterait, mais **après** une extraction longue (pdf.js lit toutes les
pages en parallèle). Le plafond de **taille de fichier** (15 Mo, `documentExtractValidator`) doit
rester **sous** le `limit: '20mb'` de `config/bodyparser.ts`, le plafond dur global — au-dessus,
l'erreur viendrait du parseur au lieu du validateur.

⚠️ **Le multi-colonnes ne se résout pas, il se voit.** Sur un article ou un polycopié à deux
colonnes, l'extraction entrelace les colonnes et produit du charabia. C'est une **limite connue et
acceptée** : n'essaie pas de reconstruire la mise en page. C'est précisément le rôle de la
prévisualisation — l'utilisateur le voit à l'écran, et corrige ou renonce.

Le nettoyage (`cleanExtractedText`) est du code pur : ligatures normalisées par **NFKC**
(`ﬁ` → `fi` — sinon deux rectos pour un même mot, et la déduplication tombe), césures de fin de
ligne recollées (`compré-\nhension`), blancs réduits **sans écraser les sauts de paragraphe** —
`chunkCourse` découpe par titres et par lignes vides, les aplatir lui retirerait ses repères.
Un `.txt` / `.md` n'y passe **pas** : ses tirets et ses blancs sont voulus.

### Le contrat avec le LLM : le format d'import, tel quel

La sortie attendue du modèle est **exactement** le format d'import JSON du module :

```json
{ "cards": [{ "front": "…", "back": "…", "category": "DevOps", "theme": "Docker" }] }
```

Ce n'est pas cosmétique : la sortie du modèle est validée par **`backupValidator`** (bornes,
taxonomie par nom, jamais d'ids), et la promotion passe par `LeitnerCatalogService` — qui sait déjà
créer une catégorie et un thème à la volée à partir de leurs noms (`ensureTheme`) et déduplique sur
le couple **(recto, thème)** (`createCardUnlessDuplicate`). L'ingestion **branche une nouvelle source
sur un pipeline qui existe** ; elle n'en écrit pas un second. Une carte existante n'est jamais
écrasée : le brouillon est compté « ignoré ».

### Les deux difficultés réelles

**Le découpage** (`chunkCourse`). Un cours dépasse la fenêtre de contexte d'un modèle local : il est
coupé par titres Markdown, à défaut par paragraphes, en dernier recours à la hache — puis les petites
sections sont regroupées (dix titres de trois lignes ne valent pas dix appels). Chaque morceau reprend
la fin du précédent (`CHUNK_OVERLAP_CHARS`) pour qu'un principe à cheval sur une coupure reste
énonçable. `mergeDrafts` fusionne ensuite les morceaux et **déduplique** (casse, accents, ponctuation
finale ignorés) : un principe énoncé en introduction et rappelé en conclusion ne donne pas deux cartes.

**Le JSON qui n'en est pas** (`extractJson` / `parseLlmCards`). Un petit modèle rend volontiers du
JSON entouré de prose, ou dans un bloc ` ```json ` — c'est le régime normal, pas une panne : le
parsing absorbe les trois formes. Ce qu'il ne peut pas lire, il le fait **réparer une seule fois**
(on renvoie au modèle sa sortie et l'erreur) : pas de boucle, un modèle qui n'a pas compris au
deuxième tour ne comprendra pas au dixième. `response_format: json_object` est demandé quand le
serveur le connaît, jamais présumé (un 400 fait réessayer sans lui).

### Le cycle de vie d'un travail — asynchrone, dans le processus

**Deux écrans, une URL par travail.** `GET /revision/ingest` est le formulaire (toujours vierge) et
l'historique. `POST /revision/ingest` crée la ligne en `pending`, **lance le travail en tâche de fond
et redirige aussitôt** vers `GET /revision/ingest/:id` — sa page de suivi, qu'on peut quitter,
partager et retrouver à jour.

⚠️ **La réponse du POST n'attend pas le LLM.** Un `await` sur la tâche de fond dans le contrôleur
referait du synchrone, avec des étapes en plus : c'est exactement ce que ce mode d'exécution existe
pour éviter. `LeitnerIngestionService.start()` rend la main ; `run()` travaille derrière.

`pending → running → done | failed`, et rien d'autre. La progression est **réelle** : `chunks_done` /
`chunk_count`, écrits morceau par morceau, sont la source de la barre.

**Ce projet n'a aucune infrastructure de job** — pas de file de messages, pas de worker. D'où trois
règles qui ne se négocient pas :

1. **Un redémarrage laisse des `running` orphelins.** Personne ne les reprendra : sans balayage, leur
   page tournerait indéfiniment sur une barre qui n'avancera plus. `sweepInterruptedIngestions()` les
   passe `failed` au boot, avec un message qui dit pourquoi — appelé par `providers/leitner_provider.ts`
   (le 5ᵉ fichier hors module). **Un statut qui ment en silence est pire qu'un échec.**
2. **Aucune exception n'est avalée.** Plus personne n'attend cette promesse : une erreur de la tâche de
   fond atterrit dans la colonne `error` et bascule le statut en `failed`. Un `catch {}` ici, c'est une
   page qui tourne dans le vide jusqu'à ce qu'on ferme l'onglet.
3. **Les tests attendent la tâche de fond** (`ingestionJobs()`), sans quoi ils courraient contre elle —
   et contre le rollback de leur propre transaction. C'est la seule raison d'être de ce registre : le
   code de production, lui, n'attend rien.

`MAX_COURSE_CHARS` ne borne donc plus une **attente** mais un **travail** (100 000 caractères, soit une
quinzaine d'appels) ; `LLM_TIMEOUT_MS` continue de borner chaque appel.

### Les brouillons s'écrivent au fil de l'eau — la rupture avec l'import

⚠️ **Contrairement à l'import JSON, qui est en tout-ou-rien** (`db.transaction()`, voir plus haut),
l'ingestion écrit ses brouillons **morceau par morceau**. Un échec au 5ᵉ morceau laisse en base ceux
des quatre premiers, et le statut `failed` le dit.

C'est un choix, pas un oubli : c'est ce qui rend la barre honnête et le compteur de cartes vivant. Et
ça ne contredit pas la règle du module, parce que ce sont des **brouillons**, pas des cartes — rien
n'entre dans `leitner_cards` sans relecture, et la promotion continue de passer par
`LeitnerCatalogService`. La déduplication entre morceaux se fait alors contre les brouillons **déjà
écrits pour cette ingestion** (`keepNewDrafts`), et non plus en fin de course.

### Le titre : jamais « Texte collé »

Chaque travail porte un **titre** (colonne `title`, 120 caractères) : fourni à la saisie, sinon
**déduit** du contenu (`deduceTitle`, du code pur — c'est son test unitaire qui compte), et renommable
ensuite (`PUT /revision/ingest/:id/title`). L'ordre : premier titre Markdown · première ligne non vide,
tronquée sans couper un mot · nom du fichier sans extension · « Cours du 14 juillet ».

L'**origine** (`source` : collé ou fichier) reste une donnée utile — elle s'affiche comme une
**pastille** à côté du titre, jamais à sa place. Un historique où dix travaux s'appellent « Texte
collé » ne désigne rien.

### La relecture : « Enregistrer les modifications » ≠ « Valider »

Trois gestes sur un brouillon, et ils ne font pas la même chose :

- **Enregistrer les modifications** (`PUT /revision/ingest/drafts/:id`) — le brouillon corrigé
  remplace ce que le modèle a proposé. Il **reste un brouillon** : aucune carte n'est créée.
- **Valider** (`POST /revision/ingest/drafts/accept`) — le brouillon devient une **carte** (boîte 1,
  due aujourd'hui), par `LeitnerCatalogService` et lui seul.
- **Rejeter** — le brouillon passe `rejected` et reste en base, comme trace. Il ne redevient jamais
  `pending`.

⚠️ **La requête de validation porte le contenu, jamais de simples ids** (`draftPromotionValidator`),
et le contrôleur l'enregistre (`saveDrafts`) **avant** de promouvoir, dans la même requête. C'est la
seule chose qui fasse tenir « valider = valider ce que j'ai sous les yeux ».

Un `accept` sur des ids seuls relirait la ligne **en base** : corriger le verso puis cliquer
directement « Valider » créerait la carte avec le **texte du modèle**, jetterait la correction en
silence — et le brouillon serait `accepted`, donc plus rien à rattraper. Ne reviens pas à des ids.

### L'interrogation périodique : du rechargement partiel, pas une route JSON

La page de suivi s'actualise par `router.reload({ only: ['ingestion', 'drafts'] })` (~1,5 s) : on reste
dans le fonctionnement natif d'Inertia, **sans route JSON nue** — donc sans CSRF ni sérialisation à
gérer à la main (contrairement aux routes de `/revision/llm`, qui n'ont pas ce choix).

Deux pièges, tous deux traités dans `ingest_show.vue` : on **n'interroge que si le statut est `pending`
ou `running`** (`done` et `failed` sont terminaux, la boucle s'arrête définitivement), et l'intervalle
est **nettoyé au démontage** (`onUnmounted`) — un `setInterval` qui survit à une navigation Inertia
continue d'émettre des requêtes pour une page qui n'existe plus.

⚠️ **`LlmClient` est injecté** (conteneur AdonisJS, `@inject()` sur le service et le contrôleur), et
jamais instancié en dur. C'est ce qui permet à la suite de tests de tourner contre un faux client
(`tests/fakes/fake_llm_client.ts`), sans réseau et de façon déterministe : **aucun test n'appelle un
vrai LLM**. En fonctionnel, on le remplace par `app.container.swap(LlmClient, …)`.

## L'onglet « Configuration » (`/revision/llm`)

Un écran qui rend le branchement d'un LLM local évident : il détecte le serveur, liste les modèles
qu'il expose, lance une **vraie génération de test**, et rend le bloc à coller dans `.env`. Le fil
rouge fait quatre étapes (serveur → modèle → JSON → bloc à copier), chacune verte (`ok`), rouge
(`bad`, avec le message d'erreur **brut**) ou grise ; une étape verte débloque la suivante.

L'étape 3 est celle qui porte l'écran : elle envoie **le prompt de l'ingestion**
(`courseMessages`, exporté par `leitner_ingestion_service.ts`) sur un extrait de cours **en dur**,
et repasse par **`parseLlmCards`** — le même parsing. C'est la seule chose qui réponde à « ce
modèle-là est-il utilisable pour fabriquer des cartes ? » : un petit modèle qui rend de la prose au
lieu du JSON se voit **ici, et nulle part ailleurs**. Un test qui enverrait un autre prompt ne
prouverait rien.

### Pourquoi la configuration ne vit pas en base

Elle vit dans l'environnement — `.env` en dev, les variables du conteneur en Docker — et **nulle
part ailleurs**. C'est ce qui préserve la frontière de confiance : la valeur qu'utilise réellement
le serveur ne peut être changée par **aucune requête HTTP**. Une `LLM_BASE_URL` stockée en base
serait une SSRF permanente, écrite une fois et rejouée à chaque ingestion.

D'où : **l'assistant ne persiste rien.** Il détecte, il teste **en mémoire**, il **produit le bloc à
copier** (`.env` et sa variante `docker-compose`) — l'utilisateur colle, redémarre, et le bandeau du
haut repasse au vert. Pas d'écriture automatique du `.env` : AdonisJS lit l'environnement **au
démarrage** (un redémarrage est de toute façon nécessaire), et sous Docker le fichier du conteneur
n'est pas la source de vérité. Écrire un fichier depuis une requête web serait une surface offerte
pour un copier-coller économisé.

### La liste blanche — l'exigence n° 1

Ces routes font émettre au serveur des requêtes vers une URL **saisie par l'utilisateur** : c'est
inévitable, puisqu'il faut tester la valeur *avant* de la coller dans `.env`. Transitoire ou non,
c'est une SSRF si on ne la borde pas.

`isLocalLlmUrl` (validateurs du module), appliqué à **toutes** les routes de diagnostic :

- schéma `http` ou `https` uniquement ;
- hôte **loopback** (`127.0.0.0/8`, `::1`, `localhost`) ou **plage privée** (`10/8`, `172.16/12`,
  `192.168/16`) ;
- tout le reste est refusé — `169.254.169.254` (métadonnées cloud) comme **tout nom de domaine**,
  fût-il résolu vers une IP privée : seule une IP littérale (ou `localhost`) passe. La comparaison
  porte sur l'hôte **normalisé par le parseur d'URL** (`0x7f000001` et `2130706433` sont
  `127.0.0.1`) : ni le décimal, ni l'hexadécimal ne contournent quoi que ce soit.

Un LLM « local » vit par définition dans ces plages : la contrainte ne coûte rien à l'usage.
`tests/unit/leitner_llm_url.spec.ts` est **le** test à ne pas laisser tomber.

Trois corollaires, aussi importants que la liste elle-même :

- **La liste des candidats sondés est en dur** (`LLM_CANDIDATES`, dans le contrôleur : LM Studio
  `1234`, llama.cpp `8080`, Ollama `11434`). Une liste de ports fournie par le client ferait de la
  « détection » un scanner de ports téléguidé.
- **Aucune de ces routes n'écrit quoi que ce soit** : ni en base, ni sur le disque. Elles sont sous
  `middleware.auth()` comme le reste du module.
- **`LLM_API_KEY` ne repart jamais vers le client.** L'écran affiche qu'elle est définie, jamais sa
  valeur (`hasApiKey`). Le client LLM continue de l'envoyer côté serveur, vers un hôte que la liste
  blanche borne.

### Deux détails qui mordent

- **Le délai de sonde n'est pas celui de la génération.** `PROBE_TIMEOUT_MS` vaut 2 s ;
  `LLM_TIMEOUT_MS` en vaut 120. Sonder trois candidats éteints avec le délai de génération figerait
  « Détecter » pendant six minutes.
- **Les trois routes rendent du JSON nu, pas de l'Inertia** : la page les appelle en `fetch`, donc
  avec l'en-tête **`x-xsrf-token`** (Shield, `enableXsrfCookie`) — sans lui, tout POST part en 403.
  Elle envoie aussi `accept: application/json`, sans quoi un refus de la liste blanche se change en
  redirection avec erreurs flashées au lieu d'un 422.

## Pièges techniques

- **`next_review` est une colonne `date`, `reviewed_at` un `timestamp`.** Les requêtes ne se
  formatent donc pas pareil : `today.toSQLDate()` pour les cartes dues, `startOfDay.toSQL()` pour
  les révisions. Les intervertir passe le typecheck et casse le filtre en silence.
  `LeitnerService.hasReviewedTodayInScope` est le point où les deux se croisent.
- **Le filtre par catégorie passe par une sous-requête** sur `leitner_themes` (une carte ne connaît
  que son thème, pas sa catégorie). Filtrer sur `leitner_category_id` depuis `leitner_cards` n'a
  aucun sens : la colonne n'existe pas. Elle s'écrit **une seule fois**, dans
  `services/leitner_scope.ts` : la portée d'une session et le filtre du catalogue posent la même
  question, et `LeitnerCatalogService.cards()` comme `LeitnerService.dueCards()` passent par
  `applyScope`. N'en fais pas une troisième copie.
- Les stats (`reviewedToday`, `streakDays`) et le catalogue chargent les lignes et comptent en JS,
  sans pagination. Volumétrie personnelle : c'est assumé.

## Avant de rendre la main

`npm test` — `tests/unit/leitner_service.spec.ts` couvre la règle des boîtes (une note = une
assertion sur la boîte **et** sur `next_review`), `tests/unit/leitner_due_cards.spec.ts` couvre la
**file et sa portée** (`all` · `theme` · `category` via ses thèmes · `unclassified`, l'ordre à
l'intérieur d'une portée, une carte `again` qui y reste, et le **refus** d'un id inexistant — le
repli muet sur « tout » est le mode d'échec que ce lot existe pour éviter),
`tests/functional/modules/leitner_scope.spec.ts` couvre l'écran de choix et ses **comptes dus**, la
fin de portée (distincte d'une portée vide dès le départ) et surtout que **noter une carte conserve
la portée** — le piège n° 1, celui du `withQs()`.
`tests/functional/modules/leitner_review.spec.ts`
couvre la file de révision (une carte ratée reste due le jour même et repart en fin de file) — il
vise `?scope=all`, qui doit se comporter **exactement** comme `/revision` d'avant le ciblage,
`tests/unit/leitner_catalog_service.spec.ts` couvre les filtres, la suppression multiple, le
reclassement et les cascades de la taxonomie, et `tests/functional/modules/leitner_backup.spec.ts`
couvre la sauvegarde — dont **l'aller-retour** (export → base vidée → import → base identique), le
seul test qui valide la promesse de l'export. `tests/unit/leitner_ingestion_service.spec.ts` et
`tests/functional/modules/leitner_ingest.spec.ts` couvrent l'ingestion (parsing, découpage,
déduplication, promotion, échecs du LLM) **contre un faux client** — jamais contre un vrai modèle —
ainsi que l'**asynchrone** : le POST rend la main avant le modèle (le faux client est *retenu* le
temps de le vérifier), un échec laisse `failed` avec son message et jamais `running`, et un travail
orphelin est bien balayé. `tests/unit/leitner_ingestion_title.spec.ts` couvre la **déduction du
titre** — du code pur, donc le test qui compte de ce lot.
`tests/unit/leitner_llm_url.spec.ts` couvre la **liste blanche SSRF** (le test qui compte) et
`tests/functional/modules/leitner_llm.spec.ts` l'écran de configuration — dont le fait que **la base
est inchangée après un test de génération**. `tests/unit/leitner_pdf_service.spec.ts` couvre
l'extraction et **ses six refus, un par un** (les confondre est la faute que ce lot évite), plus le
nettoyage — du code pur, donc le test qui compte de ce lot ; le fonctionnel vérifie que la route
d'extraction **n'écrit rien** et que le flux complet PDF → texte relu → travail tient. Toute
modification doit les laisser vertes, ou les mettre à jour explicitement.

⚠️ **`tests/fixtures/*.pdf` sont des binaires versionnés**, générés une fois : `cours.pdf` (deux
pages de texte, avec des césures), `scan.pdf` (quatre pages sans couche texte, mais numérotées —
c'est le piège du seuil global), `epais.pdf` (250 pages de vrai texte : seul le plafond de **pages**
peut le refuser, ni celui du scan ni celui des caractères), `protege.pdf` (RC4, mot de passe
`secret`). Ne les fabrique pas à la volée dans un test, et **ne les télécharge jamais** : aucun test
de ce dépôt ne touche le réseau. Un test qui n'est pas un vrai PDF (fichier tronqué, fichier qui
ment sur son extension) se fabrique en revanche à la volée : il n'y a pas de binaire à versionner.

Ce que la suite fonctionnelle ne verra **pas** : la **qualité** d'une extraction. Elle vérifie qu'il
y a du texte, pas qu'il veut dire quelque chose — un PDF à deux colonnes lui paraît parfait. Ça, il
faut un vrai passage navigateur avec de vrais PDF.

Le faux client (`tests/fakes/fake_llm_client.ts`) simule aussi le **diagnostic** (`ping`,
`listModels`) : sans lui, les tests de `/revision/llm` iraient sonder de vrais ports de la machine
qui les exécute.

Le test fonctionnel ne voit **pas** le piège Inertia de l'export : il faut un vrai clic dans un
navigateur pour ça (au `curl`, la réponse paraît parfaite dans les deux cas).
