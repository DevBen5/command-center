# Module Leitner — répétition espacée

Route `/revision` (⚠️ **pas** `/leitner`) · pages Inertia `modules/leitner/index` et
`modules/leitner/settings` · tables `leitner_cards`, `leitner_reviews`, `leitner_categories`,
`leitner_themes`.

```
controllers/leitner_controller.ts          index · store · review
controllers/leitner_settings_controller.ts écran de gestion : cartes + taxonomie
services/leitner_service.ts                règle métier (boîtes, stats)  ← source de vérité
services/leitner_catalog_service.ts        catalogue : filtres, CRUD cartes, catégories/thèmes
models/leitner_card.ts                     hasMany reviews · belongsTo theme (nullable)
models/leitner_review.ts                   belongsTo card
models/leitner_category.ts                 hasMany themes
models/leitner_theme.ts                    belongsTo category · hasMany cards
validators/leitner.ts                      card · review · cardIds · cardsTheme · category · theme
pages/index.vue                            session de révision · grille des 5 boîtes · ajout
pages/settings.vue                         tableau des cartes · création/édition · sélection
                                           multiple · taxonomie
migrations/                                cards PUIS reviews PUIS categories/themes (FK :
                                           l'ordre du nom de fichier compte)
```

**Aucun seeder, et c'est voulu** : tout le contenu (cartes, catégories, thèmes) est saisi depuis
l'UI. Le module n'a plus de dossier `seeders/` ; `config/database.ts` en garde le path, ce qui est
sans effet (Lucid lit les dossiers de seeders avec `ignoreMissingRoot`). Ne réintroduis pas de
données de démo : elles écraseraient le contenu réel de l'utilisateur au prochain `db:seed`.

La création de carte est exposée à **deux endroits pour une seule route** (`POST /revision/cards`,
`LeitnerController.store`) : le formulaire latéral de `index.vue` et la modale de `settings.vue`,
qui sert à la fois à créer (`editing === null`) et à éditer.

## La règle métier

`BOX_INTERVAL_DAYS = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 30 }` dans `leitner_service.ts`.

- `again` → retour boîte 1. **Toute autre note** (`hard`, `good`, `easy`) → +1 boîte, plafonnée à 5.
- `hard`, `good` et `easy` ont donc aujourd'hui un comportement **strictement identique**.
  C'est une simplification assumée, pas un bug : les différencier est une décision produit,
  pas une correction à faire au passage.
- `next_review` = maintenant + l'intervalle de la boîte **atteinte** (après mouvement).
- Conséquence : une carte ratée revient demain, jamais dans la même session.

Les intervalles sont **dupliqués en trois endroits** — changer l'un exige de changer les trois :
`BOX_INTERVAL_DAYS`, les libellés `boxIntervalLabel` de `pages/index.vue`, et les assertions de
`tests/unit/leitner_service.spec.ts`.

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

`npm test` — `tests/unit/leitner_service.spec.ts` couvre la règle des boîtes,
`tests/unit/leitner_catalog_service.spec.ts` couvre les filtres, la suppression multiple, le
reclassement et les cascades de la taxonomie. Toute modification doit les laisser vertes, ou les
mettre à jour explicitement.
