# Module Leitner — répétition espacée

Route `/revision` (⚠️ **pas** `/leitner`) · pages Inertia `modules/leitner/index` et
`modules/leitner/settings` · tables `leitner_cards`, `leitner_reviews`, `leitner_categories`,
`leitner_themes`.

```
controllers/leitner_controller.ts          révision seule : index · review
controllers/leitner_settings_controller.ts écran de gestion : CRUD cartes + taxonomie
services/leitner_service.ts                règle métier (boîtes, stats)  ← source de vérité
services/leitner_catalog_service.ts        catalogue : filtres, CRUD cartes, catégories/thèmes
models/leitner_card.ts                     hasMany reviews · belongsTo theme (nullable)
models/leitner_review.ts                   belongsTo card
models/leitner_category.ts                 hasMany themes
models/leitner_theme.ts                    belongsTo category · hasMany cards
validators/leitner.ts                      card · review · cardIds · cardsTheme · category · theme
pages/index.vue                            session de révision · grille des 5 boîtes
pages/settings.vue                         tableau des cartes · création/édition · sélection
                                           multiple · taxonomie
migrations/                                cards PUIS reviews PUIS categories/themes (FK :
                                           l'ordre du nom de fichier compte)
```

**Aucun seeder, et c'est voulu** : tout le contenu (cartes, catégories, thèmes) est saisi depuis
l'UI. Le module n'a plus de dossier `seeders/` ; `config/database.ts` en garde le path, ce qui est
sans effet (Lucid lit les dossiers de seeders avec `ignoreMissingRoot`). Ne réintroduis pas de
données de démo : elles écraseraient le contenu réel de l'utilisateur au prochain `db:seed`.

## Un seul point de saisie : `/revision/settings`

`/revision` **ne fait que réviser** : aucune création, aucune édition. Toute écriture sur une carte
(créer, éditer, supprimer, classer) passe par `settings.vue` et `LeitnerSettingsController` —
`POST /revision/cards` y compris, alors que l'URL vit sous le préfixe `/revision`. Ne réintroduis pas
de formulaire dans `index.vue` : la page renvoie vers la gestion (lien du header, bouton de l'état
vide), et son contrôleur n'a plus besoin de `LeitnerCatalogService`.

La modale de `settings.vue` sert à la fois à créer (`editing === null`) et à éditer. En création,
« Créer et enchaîner » (`submitCard(true)`) la laisse ouverte en conservant le thème : la saisie se
fait en général par séries sur un même sujet. `@submit.prevent="submitCard()"` s'écrit **avec les
parenthèses** — sans elles, Vue passe l'événement en `keepOpen` et la modale ne se ferme jamais.

## La règle métier

`BOX_INTERVAL_DAYS = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 30 }` dans `leitner_service.ts`.
Chaque note a un effet distinct :

| note    | boîte atteinte                            | `next_review`              |
| ------- | ----------------------------------------- | -------------------------- |
| `again` | 1                                         | **aujourd'hui**            |
| `hard`  | inchangée — sauf **2ᵉ `hard` d'affilée** → 1 | intervalle de cette boîte |
| `good`  | +1                                        | intervalle de cette boîte  |
| `easy`  | +2                                        | intervalle de cette boîte  |

- La boîte est plafonnée à 5. `next_review` = aujourd'hui + l'intervalle de la boîte **atteinte**
  (après mouvement) — `again` est la **seule** note qui laisse la carte due le jour même.
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

**Les boutons annoncent leur effet.** `pages/index.vue` reçoit `boxIntervals` (la table du serveur)
et le `lastGrade` de chaque carte due : chaque bouton affiche la boîte atteinte et l'échéance —
y compris « 2ᵉ d'affilée · boîte 1 » quand la note précédente était `hard`. Ne réintroduis pas de
libellés muets : quatre boutons opaques valent l'ancien bug de quatre boutons identiques.

Les intervalles restent **dupliqués à deux endroits** — la page ne les redéclare plus, mais changer
`BOX_INTERVAL_DAYS` exige de changer les assertions de `tests/unit/leitner_service.spec.ts`
(un test qui importerait la constante n'asserterait plus rien).

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
couvre la file de révision (une carte ratée reste due le jour même et repart en fin de file), et
`tests/unit/leitner_catalog_service.spec.ts` couvre les filtres, la suppression multiple, le
reclassement et les cascades de la taxonomie. Toute modification doit les laisser vertes, ou les
mettre à jour explicitement.
