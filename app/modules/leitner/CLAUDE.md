# Module Leitner — répétition espacée

Route `/revision` (⚠️ **pas** `/leitner`) · pages Inertia `modules/leitner/index` et
`modules/leitner/settings` · tables `leitner_cards`, `leitner_reviews`, `leitner_categories`,
`leitner_themes`, `leitner_settings`.

```
controllers/leitner_controller.ts          révision seule : index · review
controllers/leitner_settings_controller.ts écran de gestion : CRUD cartes + taxonomie + intervalles
                                           + export/import JSON
controllers/leitner_ingestion_controller.ts ingestion d'un cours par un LLM local : brouillons,
                                           relecture, promotion
services/leitner_service.ts                règle métier (boîtes, intervalles, stats) ← source de vérité
services/leitner_catalog_service.ts        catalogue : filtres, CRUD cartes, catégories/thèmes
                                           ← seul point d'écriture d'une carte, porte la dédup
services/leitner_backup_service.ts         export/import JSON — le filet de sécurité du module
services/leitner_ingestion_service.ts      découpage du cours, appels LLM, fusion, brouillons
services/llm_client.ts                     client /v1/chat/completions — INJECTÉ (jamais en dur)
models/leitner_card.ts                     hasMany reviews · belongsTo theme (nullable)
models/leitner_review.ts                   belongsTo card
models/leitner_category.ts                 hasMany themes
models/leitner_theme.ts                    belongsTo category · hasMany cards
models/leitner_settings.ts                 réglages du module — UNE seule ligne (id = 1)
models/leitner_ingestion.ts                le travail : statut, source, compteurs, erreur
models/leitner_draft_card.ts               une carte PROPOSÉE, rattachée à son ingestion
validators/leitner.ts                      card · review · cardIds · cardsTheme · category · theme
                                           · boxIntervals · backup · backupImport
                                           · courseIngestion · draftCard · draftIds
pages/index.vue                            session de révision · grille des 5 boîtes
pages/settings.vue                         tableau des cartes · création/édition · sélection
                                           multiple · taxonomie · intervalles des boîtes
pages/ingest.vue                           soumission d'un cours · brouillons · relecture
migrations/                                cards PUIS reviews PUIS categories/themes PUIS settings
                                           PUIS ingestions PUIS draft_cards
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

⚠️ Ce module touche **quatre** fichiers hors de son dossier, et pas un seul :

- `start/routes.ts` — toutes ses routes (`PUT /revision/settings/intervals`, `GET /revision/export`,
  `POST /revision/import`, `GET|POST /revision/ingest`…).
- `start/env.ts` — les variables du serveur LLM (`LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`,
  `LLM_TIMEOUT_MS`).
- `.env.example` — leur documentation.
- `config/llm.ts` — la configuration typée du client LLM, et ses valeurs par défaut.

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

## La règle métier

Les intervalles (jours avant la prochaine révision, boîte par boîte) **vivent en base**, dans la
ligne unique de `leitner_settings`, et se règlent depuis `/revision/settings`. Lis-les avec
`LeitnerService.boxIntervals()`. `DEFAULT_BOX_INTERVAL_DAYS = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 30 }`
n'est **que** la valeur de départ (posée par la migration, et filet de sécurité si la ligne
disparaît) : ne t'en sers jamais pour calculer une échéance, elle peut ne plus refléter le réglage.

Chaque note a un effet distinct :

| note    | boîte atteinte                            | `next_review`              |
| ------- | ----------------------------------------- | -------------------------- |
| `again` | 1                                         | **aujourd'hui**            |
| `hard`  | inchangée — sauf **2ᵉ `hard` d'affilée** → 1 | intervalle de cette boîte |
| `good`  | +1                                        | intervalle de cette boîte  |
| `easy`  | +2                                        | intervalle de cette boîte  |

- La boîte est plafonnée à 5. `next_review` = aujourd'hui + l'intervalle **réglé** pour la boîte
  **atteinte** (après mouvement) — `again` est la **seule** note qui laisse la carte due le jour
  même, et le seul cas où l'intervalle de la boîte 1 ne s'applique pas.
- Conséquence : **une carte ratée reste due et revient dans la session en cours**, en fin de file,
  jusqu'à ce qu'elle passe. C'est le geste du Leitner physique. Toute autre note repousse
  l'échéance d'au moins un jour, donc vide la carte de la session du jour.
- « Deux `hard` d'affilée » = la **dernière révision enregistrée** pour cette carte était déjà
  `hard`, quel que soit le délai entre les deux (`LeitnerService.lastGrade`). Stagner deux fois
  n'est pas savoir. Un `hard` séparé du précédent par une autre note ne rétrograde pas.

**L'ordre de la file dépend de cette règle.** `leitner_controller.ts::index` trie
`next_review` asc → `updated_at` asc → `id` asc. **Ne trie jamais par `box`** : une carte ratée
retombe en boîte 1 et repasserait devant toutes les cartes de boîte ≥ 2 — elle se re-présenterait
en boucle. Avec ce tri elle est dernière aux deux critères (échéance la plus tardive parmi les
cartes dues, et écriture la plus récente), donc en fin de file.

**Rétention** (`leitner_controller.ts::index`) : `grade !== 'again'`. `hard` compte comme une
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

`/revision/ingest` : on colle un cours (ou on téléverse un `.txt` / `.md`), un LLM **local** en
extrait les grands principes, et rend des **cartes proposées**. Le modèle propose, l'utilisateur
relit, corrige, valide — et c'est seulement là que les cartes entrent en base. Une carte issue d'un
cours est ensuite une carte comme une autre : boîte 1, due aujourd'hui.

Deux tables : `leitner_ingestions` (le travail : statut, source, compteurs, erreur) et
`leitner_draft_cards` (les cartes **proposées** — ni boîte, ni échéance : ce ne sont pas des cartes).

### La frontière de confiance — le point à ne pas régresser

⚠️ **L'URL du serveur LLM vient de l'environnement, jamais d'un formulaire.** `LLM_BASE_URL`,
`LLM_MODEL`, `LLM_API_KEY`, `LLM_TIMEOUT_MS` (`start/env.ts` → `config/llm.ts`). Un champ « URL du
serveur » dans un écran de réglages serait une **SSRF** : le serveur émettrait des requêtes vers
l'hôte du choix de celui qui écrit dans ce champ. C'est le raisonnement du module `agents` sur
`config.command`, appliqué ici. Ne l'expose jamais dans une UI.

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

### Exécution : synchrone, donc plafonnée

La requête HTTP **attend** le LLM, morceau par morceau : d'où `MAX_COURSE_CHARS` (plafond d'entrée) et
`LLM_TIMEOUT_MS` (plafond d'attente par appel). Un échec (serveur injoignable, JSON irréparable) n'est
pas une 500 : l'ingestion passe `failed` avec son message, affiché sur la page, et **aucun brouillon
n'est écrit** — ils ne le sont qu'une fois tous les morceaux traités. Pas de moitié de cours en base.

`leitner_ingestions.status` porte déjà `pending` et `running`, inutilisés en synchrone. C'est
délibéré : passer en asynchrone (lot 2) sera un changement de **mode d'exécution**, pas une reprise du
modèle de données.

⚠️ **`LlmClient` est injecté** (conteneur AdonisJS, `@inject()` sur le service et le contrôleur), et
jamais instancié en dur. C'est ce qui permet à la suite de tests de tourner contre un faux client
(`tests/fakes/fake_llm_client.ts`), sans réseau et de façon déterministe : **aucun test n'appelle un
vrai LLM**. En fonctionnel, on le remplace par `app.container.swap(LlmClient, …)`.

## Pièges techniques

- **`next_review` est une colonne `date`, `reviewed_at` un `timestamp`.** Les requêtes ne se
  formatent donc pas pareil : `today.toSQLDate()` pour les cartes dues, `startOfDay.toSQL()` pour
  les révisions. Les intervertir passe le typecheck et casse le filtre en silence.
- **Le filtre par catégorie passe par une sous-requête** sur `leitner_themes` (une carte ne connaît
  que son thème, pas sa catégorie). Filtrer sur `leitner_category_id` depuis `leitner_cards` n'a
  aucun sens : la colonne n'existe pas.
- Les stats (`reviewedToday`, `streakDays`) et le catalogue chargent les lignes et comptent en JS,
  sans pagination. Volumétrie personnelle : c'est assumé.

## Avant de rendre la main

`npm test` — `tests/unit/leitner_service.spec.ts` couvre la règle des boîtes (une note = une
assertion sur la boîte **et** sur `next_review`), `tests/functional/modules/leitner_review.spec.ts`
couvre la file de révision (une carte ratée reste due le jour même et repart en fin de file),
`tests/unit/leitner_catalog_service.spec.ts` couvre les filtres, la suppression multiple, le
reclassement et les cascades de la taxonomie, et `tests/functional/modules/leitner_backup.spec.ts`
couvre la sauvegarde — dont **l'aller-retour** (export → base vidée → import → base identique), le
seul test qui valide la promesse de l'export. `tests/unit/leitner_ingestion_service.spec.ts` et
`tests/functional/modules/leitner_ingest.spec.ts` couvrent l'ingestion (parsing, découpage, fusion,
promotion, échecs du LLM) **contre un faux client** — jamais contre un vrai modèle. Toute
modification doit les laisser vertes, ou les mettre à jour explicitement.

Le test fonctionnel ne voit **pas** le piège Inertia de l'export : il faut un vrai clic dans un
navigateur pour ça (au `curl`, la réponse paraît parfaite dans les deux cas).
