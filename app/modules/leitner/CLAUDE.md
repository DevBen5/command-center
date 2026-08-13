# Module Leitner — répétition espacée

Route `/revision` (⚠️ **pas** `/leitner`) · pages Inertia `modules/leitner/{index, settings, stats,
ingest, ingest_show, llm}` · tables `leitner_cards`, `leitner_card_progress`, `leitner_reviews`,
`leitner_categories`, `leitner_themes`, `leitner_settings`, `leitner_ingestions`,
`leitner_draft_cards`.

## ⭐ Le contenu a un propriétaire, privé par défaut (CC-139)

C'est **la** ligne de partage du module, et elle dicte le schéma. ⚠️ **Elle renverse ce qu'écrivait
CC-119** ici même (« le contenu ne connaît aucun utilisateur ») — pas un ajout à côté d'une phrase
qui resterait vraie, un remplacement. Le coût de l'ancien modèle s'est vu le 2026-08-03 : une
invitée a ajouté ses propres paquets, et ils sont apparus dans la file de tout le monde. Correct sur
une installation à un seul foyer, faux dès que deux personnes ne révisent pas la même chose.

À tenir sur chaque table ajoutée :

| | `owner_id` + `is_shared` ? | À la suppression du compte |
| --- | --- | --- |
| **Contenu** — cartes, catégories, thèmes, ingestions | **Oui** | Survit toujours (`SET NULL`) ; **bloque la suppression si `is_shared = true`** |
| **Brouillons d'ingestion** (`leitner_draft_cards`) | **Non — dérivé de l'ingestion parente** | Cascade avec son ingestion |
| **Données personnelles** — `leitner_card_progress` (boîte, échéance), `leitner_reviews` (réponses écrites, verdicts, `thinking_ms`) | `user_id`, pas `owner_id`/`is_shared` | **`ON DELETE CASCADE`**, inchangé depuis CC-119 |

**Le modèle : je vois mes cartes, plus celles que quelqu'un a explicitement marquées comme
partagées.** Rien ne fuite par défaut ; la révision à plusieurs (CC-77, CC-121) reste possible —
elle devient un **geste** (cocher « Partagé ») au lieu d'un état de fait. La règle de visibilité,
en lecture, est **la même partout** et vit en un seul endroit : `services/leitner_visibility.ts`,
`applyVisibility(query, table, userId, isAdmin)` — `owner_id = userId OU is_shared = true OU
(admin ET owner_id IS NULL)`. Le dernier cas est **étroit et volontaire** : un admin ne voit
toujours pas la progression des autres (CC-119 tient sur ce point), le repli ne s'ouvre que sur
l'**orphelin** — du contenu que plus personne d'autre ne peut jamais voir. Toute lecture du module
doit appeler `applyVisibility` ; c'est en pratique l'essentiel des requêtes du module.

⚠️ **`leitner_draft_cards` ne porte PAS `owner_id`/`is_shared`, délibérément.** Un brouillon
appartient toujours à exactement une ingestion (`leitner_ingestion_id` non nullable) : sa
visibilité se dérive par jointure sur elle plutôt que de dupliquer la propriété — même doctrine
que `applyScope`/`joinProgress` : une seule copie de la vérité. Filtrer la LISTE des ingestions
(et vérifier que celle qu'on ouvre par id est visible) suffit à protéger ses brouillons.

### La suppression d'un compte n'est plus sûre par le seul schéma — CASCADE, SET NULL et le refus, combinés

⚠️ **Jamais de `CASCADE` sur du contenu** — cette phrase reste vraie mot pour mot depuis CC-119,
mais le mécanisme qui la tient a changé. Un `CASCADE` ferait s'évaporer un paquet **partagé** en
supprimant le compte qui l'a créé — exactement l'inverse du but de ce lot (rendre le partage
durable, pas fragile). La solution retenue combine trois pièces, aucune seule ne suffit :

1. **FK `owner_id → users.id` en `ON DELETE SET NULL`** sur les quatre tables — le contenu
   **survit toujours**, jamais détruit par une suppression de compte.
2. **Garde applicative dans `AdminUsersController#destroy`** (hors du module,
   `app/core/auth/controllers/admin_users_controller.ts`) : refuse la suppression si le compte
   possède encore du contenu `is_shared = true`, via `ownedSharedContentTable` (ce fichier,
   `services/leitner_account_deletion_guard.ts`). Le contenu **privé** ne bloque jamais.
3. **Aucune impasse** : le propriétaire (ou un admin, qui peut éditer n'importe quel contenu —
   voir plus bas) peut décocher « Partagé » avant de supprimer le compte. Pas de fonctionnalité
   de transfert de propriété nécessaire pour que ce garde reste résoluble.

Le contenu privé qui survit à la suppression de son propriétaire devient **orphelin**
(`owner_id = null`, `is_shared` inchangé), et retombe dans le seul cas où `applyVisibility`
ouvre un accès à un admin : c'est le ménage qu'un administrateur peut faire, personne d'autre.

⚠️ **`app/core/auth/controllers/admin_users_controller.ts` est donc un fichier hors module qui
dépend de celui-ci** — même patron déjà en place pour `HomeController` et `NavStatsService` (voir
plus bas et le `CLAUDE.md` racine, point 7) : `modules.has('leitner')` avant toute requête, pour
qu'un module désactivé ne fasse pas échouer une suppression de compte sur une table absente.

### L'écriture reste un geste de propriétaire, `is_shared` n'ouvre que la lecture

⚠️ **`is_shared` ne donne jamais le droit d'éditer ou de supprimer.** Seul le propriétaire (ou un
admin) peut modifier une carte/catégorie/thème/ingestion, qu'elle soit partagée ou non — sinon
« partagé » deviendrait tacitement « éditable par quiconque a `cards.write` », et la propriété
perdrait tout son sens dès qu'un tiers pourrait réécrire le contenu de quelqu'un d'autre. Le garde
vit dans `services/leitner_visibility.ts`, `assertOwnedOrAdmin(row, userId, isAdmin)` — il **lève**
(`ForbiddenException`), il ne retourne jamais un booléen que l'appelant pourrait oublier de tester.
`assertVisibleOrAdmin` est son pendant en lecture, pour les chemins qui relisent une ligne par id
(`review()`, `judge()`) plutôt que par une requête déjà filtrée — `applyVisibility` ne protège que
les requêtes qui l'appellent, pas un `findOrFail(params.id)`.

⚠️ **`leitner_settings` reste un réglage d'INSTALLATION, et c'est une décision, pas un reste.** Les
intervalles décrivent la **méthode** de répétition espacée, pas la personne qui la suit : une seule
ligne (`check('id = 1')`), un réglage posé par quelqu'un s'applique à tout le monde. C'est la
dernière écriture du module qui touche du **partagé sans être du contenu** — les autres écritures
fermées à l'invité le sont parce qu'elles touchent au contenu, au réseau ou aux deux.

⚠️ **L'absence de ligne de progression EST une valeur** — « boîte 1, due aujourd'hui » — et rien
n'est jamais semé, ni à la création d'un compte, ni à celle d'une carte. C'est ce qui donne sa file
à un nouveau venu et fait entrer une carte créée ce matin dans celle de tout le monde **qui peut la
voir** (CC-139 restreint le « tout le monde », il ne touche pas à ce principe). Semer obligerait à
un re-semis à chaque compte **et** à chaque carte, et une carte créée entre les deux resterait
invisible sans erreur. Toute lecture passe donc par une **jointure externe** avec un `coalesce` —
`services/leitner_progress.ts`, l'unique copie, dont les quatre pièges sont commentés sur place.
Elle reste **distincte** de `applyVisibility` : l'une dit « la carte existe-t-elle pour cette
personne ? », l'autre « cette personne peut-elle voir cette carte ? » — les deux se composent, l'une
n'implique pas l'autre.

⚠️ **`leitner_categories.name` n'est plus unique globalement, mais `unique(owner_id, name)`.**
Deux comptes peuvent chacun avoir une catégorie privée « DevOps » sans se marcher dessus — une
contrainte globale aurait cassé la fonctionnalité dès le premier cas réel à deux comptes actifs.
`ensureTheme`/`ensureCategory` (catalogue **et** import) ne réutilisent qu'une catégorie/thème
**visible** de l'appelant ; un homonyme privé chez un autre compte n'est jamais réutilisé, il en
naît un second, privé, appartenant à l'appelant — sans quoi du contenu neuf s'attacherait en
silence à une taxonomie que son créateur ne peut même pas parcourir lui-même.

⚠️ **Le fichier d'export est PERSONNEL depuis la v2 (CC-119), et FILTRÉ depuis la v3 (CC-139)** :
il ne rend plus tout le contenu, mais **le visible par l'exportateur** — sa carte privée, plus tout
ce qui est marqué partagé — avec la progression et l'historique de celui qui exporte. Voir la
section « Sauvegarde » plus bas.

### Ce que le rôle invité peut faire depuis CC-121, et ce qu'il ne peut toujours pas

`leitner.review` est **accordée au rôle invité** : un collègue révise pour de vrai — il choisit son
paquet, note, fait juger sa réponse écrite, et sa session se déroule jusqu'à la file vide. C'est la
raison d'être de l'épique CC-77, et ça n'a demandé **aucune ligne de code** : la capacité, les deux
routes et le masquage de l'écran existaient déjà ; c'est le cloisonnement de CC-119 qui les a rendus
sûrs. Le lot n'a livré que la preuve — `tests/functional/modules/leitner_guest.spec.ts`.

⚠️ **Le « rôle invité » n'existe nulle part dans le dépôt.** Les rôles sont des lignes en base,
réglées depuis `/admin/roles` ; le seul rôle codé est « Lecteur » — posé par une migration
idempotente depuis CC-138 (`app/core/auth/migrations/1785880000000_seed_lecteur_role.ts`, les
seeders n'existent plus) — et il ne porte **pas** `leitner.review`. L'accorder est un geste
d'administration, pas un déploiement — et il ne faut pas « simplifier » en l'ajoutant à la
migration : une migration future qui re-poserait la capacité re-accorderait un droit retiré
depuis l'écran, sans erreur ni log. Même famille que CC-106.

Restent fermées, chacune pour sa raison : `leitner.cards.write` et `leitner.taxonomy.write` (la
saisie de contenu — le sien ou du partagé, voir CC-139 plus haut), `leitner.ingest` (elle écrit
**et** fait sortir des requêtes), `leitner.llm` (la
surface la plus proche d'une SSRF du dépôt), `leitner.settings` (le réglage d'installation ci-dessus)
et `leitner.backup`.

⚠️ **`leitner.backup` : la raison qu'on croyait est fausse, celle qui compte est ailleurs.** On la
gardait fermée parce que « l'export rend l'intégralité du contenu, réponses écrites comprises » —
vérifié en CC-121, et faux depuis la v2 : `export(userId)` filtre `reviews` et `progress` sur
`user_id`, le fichier ne porte que la progression et l'historique de **celui qui exporte**. Ce qui la
ferme vraiment tient en deux points, et le premier est décisif :

- **l'import crée des cartes et de la taxonomie** — l'accorder contournerait `leitner.cards.write`
  **et** `leitner.taxonomy.write` d'un seul geste. Une capacité qui en ouvre deux autres par la bande
  ne s'ouvre pas par commodité ;
- l'export emporte en un fichier portable tout ce que l'exportateur peut voir — depuis CC-139 ce
  n'est plus « plus que `leitner.view` » (le fichier est filtré par visibilité, exactement comme
  l'écran), mais **un fichier téléchargeable** reste un geste différent de la consultation à
  l'écran : voir les cartes n'est pas repartir avec une copie autonome.

Cinq écrans, une barre d'onglets : **Révision** (`/revision`) · **Cartes** (`/revision/settings`) ·
**Stats** (`/revision/stats`) · **Ingestion** (`/revision/ingest`) · **Configuration**
(`/revision/llm`).

⚠️ **`components/` n'est pas `pages/`.** La résolution Inertia fait un glob sur les `.vue` de tout
dossier `pages/` : un composant partagé posé là deviendrait une page. Les composants du module
vivent dans `components/` et s'importent relativement.

```
controllers/leitner_controller.ts           révision seule : index (choix OU session) · review
                                            · judge (JSON nu, n'écrit RIEN)
controllers/leitner_settings_controller.ts  CRUD cartes + taxonomie + intervalles + export/import
controllers/leitner_ingestion_controller.ts formulaire · extraction (n'écrit RIEN) · suivi d'UN
                                            travail · renommage · brouillons, relecture, promotion
controllers/leitner_llm_controller.ts       détection, /models, génération de contrôle — n'écrit
                                            RIEN (ni base, ni disque)
services/leitner_service.ts                 règle métier ← source de vérité + la FILE :
                                            dueCards(scope), resolveScope, dueScopeChoices
services/leitner_judge_service.ts           le JUGE : court-circuit sans réseau, verdict, repli
                                            obligatoire — il PROPOSE une note, jamais ne la choisit
services/leitner_fluency.ts                 la FLUENCE : seuils relatifs, choix de la référence,
                                            mesure exploitable ou non — CODE PUR, sans base
services/leitner_fluency_service.ts         sa partie base : médianes carte/boîte, « déjà notée
                                            aujourd'hui ? »
services/leitner_scope.ts                   `CardScope` + `applyScope` — l'UNIQUE copie de la
                                            sous-requête catégorie → thèmes
services/leitner_progress.ts                la PROGRESSION par personne — l'UNIQUE copie de la
                                            jointure externe, du `coalesce` et de l'ORDRE de file
services/leitner_visibility.ts              la VISIBILITÉ par propriétaire (CC-139) — l'UNIQUE
                                            copie d'`applyVisibility` + le garde d'écriture
                                            `assertOwnedOrAdmin`/lecture `assertVisibleOrAdmin`
services/leitner_account_deletion_guard.ts  ce que `AdminUsersController#destroy` (HORS module)
                                            vérifie avant de supprimer un compte
services/leitner_sessions.ts                l'INFÉRENCE de session — CODE PUR, sans base ni horloge
services/leitner_habits.ts                  séries, heatmap, régularité, rythme — CODE PUR, le jour
                                            courant est un PARAMÈTRE
services/leitner_weakness.ts                les POINTS FAIBLES : rétention, taux d'again, seuils —
                                            CODE PUR, sans base
services/leitner_mastery.ts                 le CRITÈRE DE MAÎTRISE (CC-260) : horloge de boîte 5 et
                                            date d'acquisition — CODE PUR, `now` en paramètre
services/leitner_stats_service.ts           les stats d'HABITUDE, d'EFFORT et les POINTS FAIBLES —
                                            globales, jamais par paquet
services/leitner_catalog_service.ts         seul point d'écriture d'une carte, porte la dédup
services/leitner_backup_service.ts          export/import JSON — le filet de sécurité du module
services/leitner_ingestion_service.ts       découpage, appels LLM, TÂCHE DE FOND, brouillons au fil
                                            de l'eau + `sweepInterruptedIngestions`
services/leitner_pdf_service.ts             fichier → texte : octets magiques, unpdf, nettoyage, et
                                            les six refus
services/llm_client.ts                      /v1/chat/completions + sonde /v1/models — INJECTÉ
models/leitner_card_progress.ts             (personne, carte) → boîte + échéance. ABSENCE =
                                            boîte 1, due aujourd'hui — jamais un trou
models/leitner_settings.ts                  UNE seule ligne (id = 1) — réglage d'INSTALLATION
models/leitner_draft_card.ts                une carte PROPOSÉE, rattachée à son ingestion
validators/leitner.ts                       … · courseIngestion (SANS fichier) · documentExtract
                                            (le seul à porter un fichier) · llmTest (LISTE BLANCHE)
components/LeitnerScopeSearch.vue           la barre de recherche du choix — NE réutilise PAS
                                            TaxonomyCombobox (voir plus bas)
components/leitner_csrf.ts                  le jeton `x-xsrf-token` des routes JSON — l'UNIQUE copie
components/leitner_scope_search.ts          son filtrage — CODE PUR
components/TaxonomyCombobox.vue             sélecteur de la relecture — rend une CHAÎNE, texte libre
components/leitner_markdown_preview.ts      l'aperçu (CC-257) : QUAND demander, jamais QUOI rendre
                                            — l'UNIQUE copie, les deux écrans de saisie
components/MarkdownPreviewPanel.vue         son affichage — porte la classe `markdown`, et c'est
                                            sa raison d'exister
shared/card_preview.ts                      PUR · PREVIEW_MAX_CHARS (UNIQUE déclaration, lue aussi
                                            par le validateur) + previewTooLong
shared/review_page.ts                       PUR · MEASURE_MAX_MS (UNIQUE déclaration) + duration
                                            / fluencyMeasure + boxIntervalLabel / dueLabel
shared/draft_review.ts                      PUR · la relecture des brouillons d'ingest_show.vue
shared/settings_page.ts                     PUR · scrollTopKeepingAnchor — le recalage du
                                            défilement après un import (CC-67)
migrations/                                 cards PUIS reviews PUIS categories/themes PUIS settings
                                            PUIS ingestions PUIS draft_cards PUIS card_progress
                                            PUIS owner_id/is_shared (CC-139, categories → themes →
                                            cards → ingestions ; PAS draft_cards)
                                            PUIS les marques de maîtrise (CC-260, UNE migration
                                            pour les 5 colonnes des DEUX tables)
                                            (FK : l'ordre du nom de fichier compte)
```

**Aucun seeder, et c'est voulu** : tout le contenu est saisi depuis l'UI, `config/database.ts` ne
déclare aucun path de seeder pour ce module. Ne réintroduis pas de données de
démo : elles écraseraient le contenu réel au prochain `db:seed`. La ligne de `leitner_settings`
insérée par la migration n'est pas une donnée de démo mais la configuration du module.

Le filet n'est donc pas un seeder mais **l'export JSON** — les cartes n'existent qu'en base, sans
autre copie. `./pgdata` survit à un `docker compose down -v` (voir le `CLAUDE.md` racine), pas à une
corruption ni à un changement de machine.

⚠️ **Treize fichiers hors du module** : `start/routes.ts` · `start/env.ts` et `.env.example` (les
variables LLM) · `config/llm.ts` · `config/env_isolation.ts` (voir ci-dessous) ·
`providers/leitner_provider.ts` (le **balayage au démarrage** des
ingestions interrompues, déclaré dans `adonisrc.ts` sous `environment: ['web']`) ·
`start/capabilities.ts` (la ligne qui enregistre `capabilities.ts` au registre) ·
`start/navigation.ts` (celle qui enregistre `destinations.ts`) · et depuis CC-119
`app/core/shared/services/nav_stats_service.ts` (le compteur « dû » de la barre latérale) et
`app/core/dashboard/controllers/home_controller.ts` (la carte d'accueil) — les deux filtrent
désormais par visibilité (`applyVisibility`) depuis CC-139, pas seulement par personne. Depuis
CC-139, `app/core/auth/controllers/admin_users_controller.ts` s'y ajoute : le garde de
suppression de compte qui refuse d'emporter du contenu partagé (voir plus haut). Depuis CC-137,
`config/modules.ts` s'y ajoute : c'est lui qui décide si `leitner` existe du tout sur
l'installation — les quatre fichiers ci-dessus (routes, capabilities, navigation, migrations
de `config/database.ts`) le consultent avant d'enregistrer quoi que ce soit pour ce module.
⚠️ Oublier `start/capabilities.ts` ne casse
rien tout de suite : les capacités n'entrent pas au registre, personne ne peut les accorder, et le
module devient inaccessible à tout non-admin — `capabilities_routes.spec.ts` attrape ce cas.
Depuis CC-133, `app/core/shared/services/markdown_renderer.ts` s'y ajoute — le **rendu Markdown**,
volontairement logé dans le noyau et non ici (voir la section dédiée plus bas). C'est le seul de
la liste dont l'oubli ne casse rien : le module le consomme, il ne l'enregistre nulle part.
⚠️ Oublier `start/navigation.ts` est plus sournois : `/revision` disparaît de la barre latérale, et un
compte qui n'aurait de droits que sur ce module atterrit sur « aucun accès » **alors qu'il y a
accès** — `navigation_registry.spec.ts` attrape celui-là.
⚠️ **Les deux derniers comptent « ce qui est dû », donc dépendent de la progression** — et ils
passent le nom de colonne en **chaîne** : les oublier ne casse **pas** le typecheck, ça casse au
runtime. Ils appellent les helpers de `leitner_progress.ts` plutôt qu'une seconde formulation de
« dû » : deux définitions finiraient par diverger, et la pastille annoncerait un nombre que
`/revision` ne montre pas. `nav.spec.ts`, `dashboard_scope.spec.ts` et `leitner_multi_user.spec.ts`
les couvrent.

## Où vit la logique d'une page — `shared/`, jamais le `<script setup>`

⚠️ Japa n'a aucun compilateur Vue : ce qui vit dans un `<script setup>` est **structurellement** hors
de portée de la suite. Règle (CC-60) : prédicat, dérivation, écrêtage, libellé qui régresse en
silence → `shared/*.ts` ; `router.post`, modale, `ref` → dans le `.vue`. C'est pourquoi
**`settings.vue` n'avait rien à extraire** malgré sa taille : ses vingt fonctions sont des
gestionnaires d'action, pures ni en entrée ni en sortie. **Une seule ligne y a échappé** (CC-67) —
`scrollTopKeepingAnchor`, de l'arithmétique dont le signe inversé *doublerait* le saut qu'elle
annule : le critère n'est pas la taille du fichier, c'est qu'une régression y serait invisible à
la relecture.

- ⚠️ **Un fichier de `shared/` n'importe JAMAIS par un alias `#modules/*`** : l'alias mappe vers
  `./app/modules/*.js`, qui n'existe qu'après un build — Vite ne le résout pas, la page casse. C'est
  ce qui interdisait à `index.vue` d'importer `leitner_fluency.ts`, un fichier pourtant **pur** dont
  la seule faute est d'importer `median` par l'alias. **« C'est du code pur » ≠ « c'est importable
  depuis une page ».** Le garde-fou est `npm run build` ; `tsc` ne lit pas les `.vue`.
- ⚠️ **L'extraction crée une couture** : l'enveloppe. Un module vert et une enveloppe fausse donnent
  une page cassée, en silence. D'où : l'enveloppe reste d'**une ligne**, et l'état part en **objet
  nommé** dès qu'il y a deux champs du même type. `fluencyMeasure` est le cas limite — quatre
  timestamps positionnels rendraient une inversion invisible, et un `firstInputAt` mis à la place de
  `revealedAt` proposerait `easy` sur la carte qu'on vient de rater.

## Un seul point de saisie : `/revision/settings`

`/revision` **ne fait que réviser**. Toute écriture sur une carte passe par `settings.vue` et
`LeitnerSettingsController` — `POST /revision/cards` compris, alors que l'URL vit sous `/revision`.
Ne réintroduis pas de formulaire dans `index.vue`. Deux autres voies **ajoutent** des cartes (import
JSON, ingestion), mais aucune n'écrit sur `LeitnerCard` : toutes passent par `LeitnerCatalogService`,
seul point d'écriture, qui porte la déduplication.

La modale de `settings.vue` crée (`editing === null`) et édite. « Créer et enchaîner »
(`submitCard(true)`) la laisse ouverte en conservant le thème — la saisie se fait par séries.
⚠️ `@submit.prevent="submitCard()"` s'écrit **avec les parenthèses** : sans elles, Vue passe
l'événement en `keepOpen` et la modale ne se ferme jamais.

### Sa structure en trois bandes, et les classes qui la tiennent (CC-66)

En-tête et pied **figés**, corps **défilant** : `<form>` plafonné par `max-h-[calc(100vh_-_8rem)]` en
`flex flex-col`, champs en `overflow-y-auto`. Raison unique — « Enregistrer » et « Annuler » ne
quittent jamais l'écran. Avant, l'overlay `fixed` sans défilement rendait le pied **inatteignable** :
la seule sortie était `Échap` ou un clic sur le fond, qui perdent la saisie, sur le seul écran où une
carte se saisit, dans une base qui est l'unique copie.

⚠️ **Quatre points dont le retrait rétablit le bug sans rien casser de visible :**

- **`min-h-0` sur le corps** — un enfant flex a `min-height: auto` et refuse de rétrécir sous son
  contenu : sans lui le plafond du `<form>` est **ignoré**, et le pied redevient inatteignable.
- **`shrink-0` sur les deux textareas** — le corps est lui-même `flex flex-col` : un textarea agrandi
  à la poignée (donc portant un `height` inline) serait ré-écrasé à ses `rows`. On tirerait la
  poignée **sans que rien ne bouge**.
- **Les tirets bas de `calc(100vh_-_8rem)`** — CSS exige des espaces autour du `-`, Tailwind
  convertit `_` en espace. Écrit `calc(100vh-8rem)` (la forme qui *paraît* juste, et celle que CC-66
  prescrivait) **aucune règle n'est générée** : le correctif entier est inerte.
- **`overflow-hidden` reste sur le `<form>`** (il découpe les enfants aux coins arrondis) et n'entre
  pas en conflit : le défilement est porté par le corps.

⚠️ **Et rien ne le dit** : ni `lint`, ni `typecheck`, ni les 518 tests ne lisent le CSS produit — les
trois étaient verts sur la version cassée. C'est **`npm run build`** qui tranche : grep le `.css` de
`public/assets/` pour la règle attendue. jsdom ne fait aucun layout, donc **aucun test de composant
ne peut couvrir ça** ; ça se vérifie au navigateur, en agrandissant le verso au maximum.

`resize-y` garde la poignée verticale (agrandir pour relire un long verso est légitime) et ferme le
défaut `resize: both`, qui laissait tirer le champ plus large que la modale.

⚠️ **Périmé depuis CC-209 (2026-08-07), gardé pour la trace historique du bug CC-66** : la phrase
ci-dessus disait qu'un composant `Modal` partagé n'était pas justifié pour deux occurrences dont
une inerte. CC-207 en a créé un quand même (`inertia/components/AppModal.vue`, pour le coffre) ;
CC-209 y a ramené **les deux** overlays restants, y compris la palette ⌘K — `settings.vue` importe
désormais `AppModal` et ne porte plus son propre `<div class="fixed inset-0 …">`. L'ossature en
trois bandes décrite ci-dessus (`max-h-[calc(100vh_-_8rem)]`, `min-h-0`, `shrink-0`) **reste
inchangée, dans le contenu du `<slot>`** : c'est une décision explicite de CC-207, le chassis ne
porte aucune structure interne. Seul l'overlay a changé de main, et son rembourrage vertical est
sorti du chassis pour être reporté en `mt-16` sur le `<form>` de cette page. ⚠️ **Le chassis est
documenté dans le `CLAUDE.md` RACINE**, section « Une seule modale dans tout le dépôt » — il vit
dans `inertia/components/`, c'est du châssis et non le bien d'un module ; le `CLAUDE.md` du coffre
ne garde que l'histoire de sa création (CC-207).

### Après un import, la vue suit le bloc Sauvegarde (CC-67)

Le formulaire d'import se retrouvait hors de l'écran dès qu'on importait un vrai lot, ce qui
interdisait d'en enchaîner un second sans re-défiler. **Trois explications tentantes, et toutes les
trois sont fausses** — les vérifier coûte moins cher que de « corriger » deux fois le même bug :

- ⚠️ **Ce n'est pas `preserveScroll` qui manque** : il est là, et il n'y a rien à ajouter.
- ⚠️ **Ce n'est pas non plus le tableau qui pousse le formulaire vers le bas.** La page est un
  `grid grid-cols-[1fr_320px] items-start` : le tableau est l'item **gauche**, taxonomie /
  intervalles / Sauvegarde forment l'item **droit**. `items-start` cale chaque item en haut de la
  ligne — un tableau plus haut allonge la page **sans déplacer la colonne de droite d'un pixel**.
- ⚠️ **Et `preserveScroll: true` ne gouverne pas cette page.** Inertia ne réinitialise et ne restaure
  que `window` et les éléments portant l'attribut `[scroll-region]` ; le conteneur qui défile est le
  panneau `overflow-y-auto` d'`AppLayout`, qui n'est ni l'un ni l'autre — et **aucun `scroll-region`
  n'existe dans le dépôt**. Le drapeau est donc inerte ici. Il reste (il ne coûte rien et
  redeviendrait porteur si un `scroll-region` apparaissait), mais ne compte pas sur lui.

La cause réelle est **l'ancrage de défilement du navigateur** (`overflow-anchor`, actif par défaut).
`cards()` trie `id desc` : les cartes importées s'insèrent **en tête** du tableau, donc au-dessus de
la ligne sur laquelle le navigateur s'était ancré, et il remonte `scrollTop` de la hauteur insérée
pour garder cette ligne fixe. La colonne de droite, elle, n'a pas bougé du document : elle part
simplement hors de l'écran, d'autant plus loin que l'import est gros.

La correction suit **l'élément** : position à l'écran du bloc relevée avant la requête, relue après
le rendu, `scrollTop` corrigé du delta (`shared/settings_page.ts`). Elle annule aussi le second cas,
plus discret — un import qui crée des catégories allonge la taxonomie, elle vraiment **au-dessus** du
bloc dans la même colonne.

⚠️ **Trois détails dont le retrait rend le correctif inerte sans rien casser de visible :**

- **`await nextTick()` avant de mesurer.** `onSuccess` se déclenche à l'échange des props, quand Vue
  n'a pas encore écrit les lignes : mesurer là lit l'**ancien** tableau. Le piège est qu'un import
  d'**une** carte paraît alors corrigé (l'écart est d'une ligne) et qu'un vrai lot ne l'est pas.
- **Le conteneur défilant, jamais `window`.** `window.scrollY` vaut éternellement 0 sur cette
  application et `window.scrollTo` n'y fait rien : le correctif passerait lint, typecheck et tests
  sans jamais bouger l'écran.
- **Le `ref` est sur le bloc entier, donc sur son bord haut.** Rapport d'import et liste d'erreurs
  apparaissent **sous** lui : ils ne peuvent pas déplacer l'ancre qui sert à les ramener sous les
  yeux. Un ancrage plus bas ferait sauter le cas témoin (import entièrement dédupliqué).

Seul l'import est traité. Les autres actions de la page relèvent du même mécanisme mais ne le
déclenchent pas de la même façon (créer une catégorie n'allonge pas le tableau, une suppression le
raccourcit alors qu'on est déjà devant lui) : si le helper leur sert un jour, ce sera avec ses
propres cas.

⚠️ **Le test unitaire ne prouve que l'arithmétique et son signe.** jsdom ne fait aucun layout : ni
hauteur de tableau, ni `scrollTop`, ni `getBoundingClientRect` réel, ni ancrage de défilement. Le
reste se vérifie **au navigateur**, sur un lot de plusieurs dizaines de cartes — un import d'une
carte ne prouve rien.

## Le Markdown des cartes est rendu — et c'est le premier `v-html` du dépôt (CC-133)

Recto et verso s'écrivent en **Markdown** : gras, listes, titres courts, et surtout des **blocs de
code** qui gardent leur indentation. Rien n'a migré — `front`/`back` étaient déjà des colonnes
`text` sans plafond, et **la colonne reste la source** : c'est le rendu qui a changé, pas le
stockage.

**Le rendu est SERVEUR, en prop dérivée.** `LeitnerController#index` pose `frontHtml`/`backHtml`
sur chaque carte due, `LeitnerLlmController#test` fait de même dans son JSON. La brique est
`renderMarkdown`, dans **`app/core/shared/services/markdown_renderer.ts`** — hors du module,
délibérément : elle ne sait rien des cartes, CC-251 (corpus de cours) la consommera, et un service
générique logé chez un module détachable est exactement la faute que le point 7 du `CLAUDE.md`
racine documente (leçon CC-180). **Lis son en-tête avant d'y toucher** ; il porte la mesure des
deux couches, qui ne dit pas ce qu'on attend.

⚠️ **Ne rends JAMAIS `front`/`back` en `v-html`** — c'est le Markdown source, et le contenu d'une
carte n'est pas de confiance : ingestion LLM, import JSON, et cartes communales depuis CC-121 (un
compte porteur de `leitner.cards.write` peut viser qui révise, administrateur compris). Seuls
`frontHtml`/`backHtml`, assainis côté serveur, s'affichent.

⚠️ **Quatre écrans rendent, deux ne rendent pas, et ce n'est pas un oubli :**

| écran | rend ? | pourquoi |
| --- | --- | --- |
| `pages/index.vue` — la révision | **oui** | c'est l'écran qui compte |
| `pages/llm.vue` — l'aperçu de génération | **oui** | on y juge la sortie du modèle *telle qu'elle s'affichera une fois promue* |
| `pages/settings.vue` — la **modale de saisie** | **oui, depuis CC-257** | panneau d'aperçu sous chaque champ — voir la section suivante |
| `pages/ingest_show.vue` — la **relecture des brouillons** | **oui, depuis CC-257** | idem, par brouillon. ⚠️ CC-133 avait tranché « non » sur cet écran en constatant qu'« il n'y a rien à y rendre, la relecture se fait dans des `<textarea>` » — c'était vrai, et c'est précisément ce que CC-257 corrige en ajoutant l'aperçu que cette phrase désignait comme la seule voie possible |
| `pages/settings.vue` — le **catalogue** | non | `line-clamp-2` couperait au milieu d'une balise, et le recto est la clé de `confirmDeleteCard` |
| `pages/stats.vue` — les cartes à problème | non | `truncate`, et `cardLink(front)` **construit une URL de recherche** — rendre y casserait une identité, pas une apparence |

⚠️ **Les listes d'acceptés / rejetés d'`ingest_show.vue` restent en texte brut** : ce sont des
`truncate` de trace, pas de la saisie. Seuls les `<textarea>` de relecture ont gagné un aperçu.

⚠️ **L'habillage vit dans le châssis, pas ici** : la classe `.markdown` de `inertia/css/app.css`.
Elle n'est **pas décorative** — sans elle le Preflight de Tailwind laisse les `ul` sans puces et
les titres à la taille du texte, avec les trois gates au vert. Elle porte aussi le
`text-align: left` sans lequel un bloc de code serait **centré** dans la carte (le conteneur est
`text-center`), et ça, aucun test ne peut le voir.

⚠️ **Les images Markdown sont RETIRÉES à l'assainissement.** La CSP (`imgSrc: ['self', 'data:']`)
refuserait une image externe **en silence** ; et laisser passer `img` rouvrirait par la porte de
derrière l'image tierce que **CC-134** écarte explicitement — il rouvrira la balise avec sa propre
règle de source.

⚠️ **Deux conséquences à connaître, aucune n'est un bug :**

- **Le court-circuit du juge se déclenche moins souvent.** Il compare la réponse tapée au verso
  **source** via `normalizeForSearch` : un verso passé en `**gras**` ne correspond plus à la même
  réponse tapée sans les astérisques, donc un appel LLM là où il n'y en avait pas. Aucune
  conséquence de justesse — c'est une optimisation de latence.
- **La déduplication `(recto, thème)` porte sur la source** : le même contenu écrit une fois en
  texte et une fois en Markdown fait deux cartes.

**L'export JSON n'a pas bougé** : le Markdown est du texte, aucune clé ne change de nom ni de
sens, `BACKUP_VERSION` reste à **3**. Vérifié, pas supposé.

## L'aperçu du rendu pendant la saisie (CC-257)

CC-133 a rendu le Markdown à la révision, mais on continuait de l'**écrire à l'aveugle** : deux
`<textarea>` nus, rien qui dise même que le Markdown est interprété. Le défaut s'est vu le jour de
la livraison — une clôture ``` non refermée fait basculer tout le reste de la carte dans un bloc de
code (comportement CommonMark **correct**), et ça ne se découvrait qu'en révision, des jours plus
tard. ⚠️ **Ce lot rend le comportement VISIBLE ; il ne le change pas.** Deviner où l'auteur voulait
fermer serait imprévisible et casserait tout Markdown collé depuis ailleurs.

**Deux routes, `POST /revision/cards/preview` et `POST /revision/ingest/drafts/preview`.** Elles
n'écrivent rien, rendent du **JSON nu** (`fetch` + `x-xsrf-token` + `accept: application/json`) et
appellent **`renderMarkdown` directement** — la même fonction que `LeitnerController#index`.

- ⚠️ **Deux routes et non une, parce que `middleware.can()` n'accepte qu'UNE capacité**, et les
  deux écrans n'ont pas la même : `leitner.cards.write` pour la modale, `leitner.ingest` pour les
  brouillons — laquelle laisse déjà créer des cartes par `drafts/accept`, donc lui refuser
  l'aperçu serait arbitraire. Ce n'est pas une duplication qu'on aurait pu éviter : c'est ce que
  coûte le refus d'un « rendu de Markdown générique » ouvert à qui n'a ni l'un ni l'autre écran.
- ⚠️ **Ne fabrique pas d'enveloppe pour mutualiser les deux lignes de rendu.** Un `previewOf()`
  partagé paraîtrait plus propre ; ce serait le seul endroit où l'aperçu pourrait un jour diverger
  de la révision, sans que rien ne le dise. Ce qui tient la promesse est le test d'**égalité
  stricte** entre les deux sorties (`leitner_preview.spec.ts`), pas une abstraction.
- ⚠️ **Rien n'est rendu côté client, et il ne faut jamais que ça change.** Un rendu dans la page
  demanderait `markdown-it` **et** `sanitize-html` dans le bundle du navigateur, et créerait un
  **second** rendu dont la sortie pourrait diverger sans que rien ne les compare — toute la raison
  d'être de la brique unique. Corollaire concret : **un fichier de `shared/` ne doit jamais
  importer `renderMarkdown`**, puisqu'un `.vue` l'importe et que Vite embarquerait la dépendance.

**Le mécanisme côté page** vit dans `components/leitner_markdown_preview.ts` (l'unique copie, les
deux écrans l'utilisent) et son affichage dans `components/MarkdownPreviewPanel.vue`.

- **Replié par défaut, vivant une fois ouvert.** Mesuré avant d'être choisi : `renderMarkdown` coûte
  0,11 ms sur une carte réelle et l'aller-retour ~10 ms sur ce poste — le coût n'est donc pas la
  latence mais le **nombre de requêtes**, et il est nul tant que personne n'a demandé. Ouvert, un
  débounce de 400 ms suit la frappe : un aperçu figé qu'il faudrait re-cliquer manquerait la
  cible, puisque la clôture ouverte apparaît **pendant** qu'on tape.
- ⚠️ **Aucun `watch`, et c'est structurel** : `ingest_show.vue` crée ses instances à la volée, hors
  de tout `EffectScope` — un `watch` créé là n'aurait aucun propriétaire et ne s'arrêterait jamais.
  Le déclenchement est explicite (`@input="…onInput()"`).
- ⚠️ **`refresh()` existe pour les changements qui n'émettent AUCUN événement de saisie** :
  « Créer et enchaîner » qui vide les champs, une modale d'édition qui s'ouvre sur une autre carte.
  Sans lui, le panneau afficherait la carte précédente à côté de champs qui ne la portent plus.
- ⚠️ **La requête en vol est annulée, jamais départagée après coup** (`AbortController`) : deux
  réponses débouncées qui se croisent afficheraient le rendu d'un texte qu'on vient de corriger, en
  paraissant parfaitement fonctionner. L'annulation rend le cas impossible au lieu de le rattraper.
- ⚠️ **`PREVIEW_MAX_CHARS` (20 000, `shared/card_preview.ts`) est l'unique déclaration**, lue par
  le validateur **et** par la page : recopiée, elle rejouerait CC-60 — la page posterait ce que le
  validateur refuse, le 422 ne serait lu par personne, et le panneau resterait vide sans dire
  pourquoi. Elle ne borne **que l'aperçu** : `cardValidator` n'a toujours aucun plafond, donc une
  carte plus longue **s'enregistre** mais ne se prévisualise pas — et le panneau le dit.
- ⚠️ **`markdown` sur le conteneur du `v-html`** : sans elle, ni puces, ni titres, ni bloc marqué —
  avec les trois gates au vert. C'est la seule raison pour laquelle le panneau est un composant
  plutôt que deux copies de balisage. `leitner_card_preview.spec.ts` balaie **tout** le module.
- **Le panneau est SOUS le champ, pas à côté** : la modale fait 560 px, deux colonnes en donnent
  ~250 où un bloc de code se replie en confettis — or ce qu'on doit voir est une structure
  *verticale*. Sous le champ, il vit dans le corps `overflow-y-auto` : il allonge le défilement,
  jamais la modale, donc le `max-h-[calc(100vh_-_8rem)]` de CC-66 reste intact.

Une **ligne d'aide** (`leitner.markdown.hint`) accompagne les deux écrans — une fois par formulaire
dans la modale, une fois pour tout l'écran des brouillons. Elle ne remplace pas l'aperçu : elle dit
qu'il y a quelque chose à prévisualiser, ce que rien ne faisait.

⚠️ **CC-259 en dépend** : apprendre au LLM d'ingestion à produire du Markdown avant que son
relecteur puisse le voir n'aurait fait que déplacer le problème d'un écran.

## Le paquet à réviser : `/revision` a deux visages

⚠️ **Un seul mot français : « paquet »** — à l'écran, dans cette doc, dans les commentaires, dans les
noms de tests. « Portée » n'a plus cours. Le code et l'URL disent **`scope`** (`CardScope`,
`applyScope`, `?scope=all`) et ça reste : c'est la traduction habituelle du module (`LeitnerCard`,
`box`, `review`), et la query string est un contrat qui vit dans les signets et dans le `withQs()` de
chaque note. **Ne renomme pas `scope`.**

`/revision` **nu** = l'écran de **choix** ; `?scope=all|unclassified`, `?category=<id>`, `?theme=<id>`
= la **session**. Une seule page Inertia, un prop `view` qui tranche.

### Le paquet vit dans l'URL, et nulle part ailleurs

**Rien en base, rien en session** : le paquet est un *geste*, pas un *réglage*. Une colonne
`current_scope` serait un état à invalider (thème supprimé, plus rien de dû, deux onglets) pour un
gain nul — et `leitner_settings` porte la **configuration**, pas ce que l'utilisateur est en train de
faire. Deux onglets, deux paquets, aucun conflit : c'est la propriété qu'on achète. C'est gratuit
parce que **la page n'a aucun état** : `currentCard` vaut `dueCards[0]`, `review()` redirige en
arrière, la page se recharge et re-requête.

⚠️ **`response.redirect().withQs().back()` — le `withQs()` n'est pas décoratif.** `back()` renvoie
sur le `referer` mais **sur son seul `pathname`** : il jette la query string
(`#forwardQueryString` vaut `false` par défaut). Sans lui, `?theme=3` disparaîtrait **à chaque
note**, en silence, et la session repartirait sur toutes les cartes dues. Ne le retire pas, et ne
remplace pas ce `back()` par un `toRoute()`. **C'est le piège n° 1 du module.**

### La fin d'un paquet est une file vide — jamais un compteur

⚠️ `again` laisse la carte due le jour même : elle reste dans `dueCards` et revient en fin de file,
**dans le paquet**. Donc « la fin d'un thème » n'arrive que quand plus aucune de ses cartes n'est due
— y compris celles qu'on vient de rater. L'écran de fin se déclenche sur une **re-requête vide**,
jamais sur un compteur de cartes vues : compter et s'arrêter à N ferait disparaître une carte ratée
de la session.

- **Aucune redirection automatique** : l'utilisateur doit *voir* qu'il a fini. Deux gestes,
  « Choisir un autre paquet » et « Arrêter ».
- ⚠️ **« Terminée » et « vide dès le départ » sont la même file vide** : ouvrir `?theme=7` sur un
  thème sans carte due doit dire « rien à réviser », pas « terminé, bravo ». Seul
  `hasReviewedTodayInScope(scope)` les sépare, et il rend un **booléen, pas un compteur** —
  `reviewedToday()` est **global**, il annoncerait les cartes revues dans *tous* les thèmes, et un
  chiffre faux est pire que pas de chiffre. Limite acceptée : une carte révisée ce matin puis
  déplacée dans un autre thème fait dire « rien à réviser » à son ancien thème.

### Le refus, jamais le repli

⚠️ **Un id inexistant ne retombe JAMAIS sur « tout »** — un thème supprimé depuis un autre onglet, et
l'utilisateur réviserait l'intégralité de sa base en croyant travailler Docker. `resolveScope` rend
un résultat **ou** un refus : son type n'a pas de troisième cas, ni de valeur par défaut. `category`
**et** `theme` ensemble : refus aussi — pas de « le dernier gagne », pas de « le plus précis gagne ».

Le refus **redirige vers `/revision` avec un flash** plutôt qu'un 404 : le cas réel n'est pas une URL
bricolée mais un thème supprimé, l'utilisateur doit atterrir là où il peut agir. `reviewScopeValidator`
est enveloppé dans un `try/catch` pour la même raison — laisser filer l'exception redirigerait sur le
`referer`, donc sur l'URL fautive.

### L'écran de choix : des comptes DUS, et une barre qui s'ajoute à l'arbre

Chaque ligne montre son nombre de cartes **dues**, pas son total. ⚠️ **`categoryTree()` ne convient
donc pas** — son `withCount('cards')` compte les cartes **totales**. C'est `dueScopeChoices()`, qui
compte en **une requête** (`group by leitner_theme_id`) agrégée en JS. ⚠️ Postgres rend `count(*)` en
`bigint`, donc en **chaîne** : sans `Number()`, les sommes de catégorie concatèneraient (`'1' + '1'`
= `'11'`) — le test porte sur le total d'une catégorie, un compte de thème seul ne l'attraperait pas,
`assert.equal` de chai étant laxiste.

⚠️ **Ne retire pas l'arbre au profit de la barre** : ce sont deux gestes — la barre est l'accès
rapide quand on sait ce qu'on veut, l'arbre est la **seule vue d'ensemble** de ce qui est dû ce soir.
Trois règles de la barre, pas une décorative :

- **Les accents.** Les catégories s'appellent « Sécurité », « Modèles » ; personne ne tape les
  accents. `normalizeForSearch` reprend l'approche de `draftKey` (NFD + `\p{Diacritic}` + minuscules)
  — un `toLowerCase().includes()` **ne trouve rien** pour `securite`.
- **Le chemin, toujours complet** (`Catégorie · Thème`) : « Linux » est à la fois une catégorie **et**
  un thème de DevOps dans les données réelles.
- **Un paquet à 0 se trouve mais ne s'ouvre pas** — ni au clic, ni à l'Entrée, et ↑↓ le **sautent**
  (s'arrêter dessus laisserait Entrée sans effet, sans dire pourquoi). Il n'est **jamais masqué** :
  disparaître ferait croire qu'il n'existe pas.

**Aucune requête** : l'arbre entier est déjà dans la prop `choices` (5 catégories, 15 thèmes), le
filtrage est côté client. Ni route, ni debounce. Et `/revision` ne faisant que réviser, la barre
n'offre **aucun** « Créer « X » ».

⚠️ **Elle ne réutilise pas `TaxonomyCombobox`, et il ne faut pas les fusionner.** Ils partagent une
**interaction** (champ + chevron + liste filtrée, et les mêmes pièges de focus/blur —
`mousedown.prevent`), pas une **donnée** :

| | `TaxonomyCombobox` | `LeitnerScopeSearch` |
| --- | --- | --- |
| rend | une **chaîne** | une **navigation** vers `?category=` / `?theme=` |
| options | `string[]` plat | (catégorie, thème) avec **ids** et **comptes dus** |
| texte libre | oui — « Créer « X » » | **non** : `/revision` ne crée rien |
| filtre | `toLowerCase().includes()` | **accents normalisés** |
| clavier | aucun | ↑ ↓ Entrée Échap |

Le seul tronc partagé serait le couple champ/chevron ; chaque appelant reprendrait ses options, son
filtre, son rendu et son action. `TaxonomyCombobox` a en plus un `filtering` que la barre n'a **pas**,
et c'est structurel : son champ porte une **valeur déjà choisie**, celui de la barre ne porte qu'une
**requête**.

⚠️ **L'aide clavier n'est affichée que parce que ↑ ↓ Entrée Échap sont réellement implémentés.** Si
tu touches à cette navigation, retire l'aide ou répare-la : annoncer un raccourci qu'on n'a pas est
le défaut que la palette ⌘K traîne déjà.

### Stats de paquet vs stats globales — la distinction n'est pas devinable

| mesure | paquet ? | pourquoi |
| ------ | -------- | -------- |
| `dueCount`, grille des 5 boîtes | **suit le paquet** | c'est ce qu'on est en train de réviser |
| `streak`, `reviewedToday`, `retention` | **globaux** | mesures d'**habitude**, pas de thème : une série de 40 jours qui retomberait à zéro parce qu'on a ouvert un autre thème serait absurde |
| `totalCards` | **global** | un inventaire. Contrepartie assumée : la grille d'un paquet ne somme pas au « total cartes » affiché |

## L'onglet « Stats » : la session est INFÉRÉE, jamais enregistrée

`/revision/stats` raconte trois choses : l'**habitude** (séries, heatmap de l'année, régularité,
rythme), l'**effort** (combien de sessions, de quelle durée, combien de cartes) et les **points
faibles** (rétention par fenêtre, taux d'`again` par thème, cartes à problème — voir la section
dédiée plus bas, CC-47). **Aucune colonne n'a été ajoutée** : tout se déduit des révisions
(horodatages et notes), donc rétroactivement sur l'historique existant.

L'inférence tient à une propriété de l'écran de révision, et à elle seule : **la page est sans état**
— noter une carte recharge `/revision` et affiche la suivante aussitôt. L'horodatage de la note N
marque donc aussi le **début** de la carte N+1. D'où le **temps par carte** = l'écart entre deux
`reviewed_at` consécutifs (indisponible pour la **première de chaque session**), et une **session** =
une grappe séparée de la suivante par plus de `SESSION_GAP_MINUTES`.

⚠️ **Si la révision devenait un jour *stateful*** (SPA qui enchaîne sans recharger, file préchargée),
**toute cette mesure deviendrait fausse en silence** — les chiffres continueraient de s'afficher,
plausibles, et plus rien ne les rattacherait au temps réellement passé.

**Trois décisions à ne pas rouvrir sans y penser :**

- **Le seuil de 30 minutes est une convention** : rien ne distingue une pause café d'une carte
  ruminée. C'est pourquoi tout ce qui en découle est publié en **médiane** — ne remplace pas `median`
  par `avg`, une session à deux cartes rendrait la moyenne absurde.
- **Une session à une seule carte dure 0, et s'affiche telle quelle** : la masquer serait mentir sur
  l'effort.
- **Les stats d'effort sont globales, jamais restreintes à un paquet** : une session est un moment de
  **travail**, pas de thème, et en traverse volontiers plusieurs. **Pas de `?theme=` sur cet écran.**

**Deux pièges du calcul :**

- ⚠️ **Fenêtrer avant de regrouper ≠ regrouper puis fenêtrer** : une session à cheval sur la frontière
  des 30 jours serait coupée en deux et **comptée deux fois**. `LeitnerStatsService` charge donc une
  seule fois sur la fenêtre la plus large (365 j), regroupe une seule fois, puis range par
  `startedAt`. Reste la troncature au bord des 365 j : inévitable, sans effet visible.
- ⚠️ **`groupIntoSessions` retrie son entrée** : une requête sans `orderBy` rend un ordre arbitraire,
  et un découpage sur une suite désordonnée produit des sessions absurdes — sans lever, sans log,
  avec des chiffres plausibles. Le service trie **aussi**, côté SQL : le doublon est voulu. Même
  logique pour `median` et son comparateur numérique (`[9, 10, 100].sort()` rend `[10, 100, 9]`).

`median` rend **`null` quand il n'y a rien à mesurer, jamais `0`**, et la page affiche `—` : un
« 0 s par carte » sur une base neuve se lirait comme une mesure. Une vraie durée de 0 (la session à
une carte) s'affiche, elle.

⚠️ **Le « temps total » est un plancher, pas un total** : une session dure `dernier − premier`, donc
le temps de sa **première** carte n'y est pas — inconnu par construction, et loin d'être négligeable
sur des sessions courtes. Ne « corrige » pas ça en imputant à la première la médiane des autres : ce
serait fabriquer une mesure qu'on n'a pas, dans le seul chiffre que l'utilisateur lira comme un fait.

**Limites assumées** : un onglet laissé ouvert dix minutes gonfle le temps d'une carte (la médiane
l'absorbe) ; deux onglets révisant en parallèle entrelaceraient les horodatages.

### L'habitude : la journée se découpe en JS, et à un seul endroit (CC-46)

⚠️ **Il n'existe qu'une voie pour dire à quel jour appartient une révision, et c'est
`reviewedAt.toISODate()`** — donc le fuseau du **process Node**, le même que le `DateTime.now()` des
séries. La voie SQL (`group by date(reviewed_at)`, fuseau du serveur Postgres) **n'est pas prise**.
Ce n'est pas une préférence : deux voies feraient diverger la heatmap et la série d'**une case au
voisinage de minuit**, avec deux chiffres plausibles qui se contredisent et rien pour le signaler.
N'ajoute pas d'agrégat SQL « pour aller plus vite » sur cet écran.

Deux corollaires du choix : il n'y a **aucun `count(*)`**, donc pas de `bigint` rendu en chaîne à
reconvertir (le piège de `dueScopeChoices` est écarté par construction, pas désamorcé) ; et changer
`TZ` déplace **rétroactivement** les cases de la heatmap, ce qui est le comportement voulu — la
journée est celle de l'utilisateur, pas celle du conteneur.

**Deux séries, et elles ne disent pas la même chose :**

- `currentStreak` **vaut 0 toute la journée tant qu'on n'a rien noté**, et ça ne change pas : c'est la
  définition qu'affiche `/revision` depuis toujours. `LeitnerService.streakDays()` **délègue**
  désormais à `leitner_habits.ts` au lieu de porter sa propre boucle — deux définitions de « série »
  auraient fini par diverger, sur le fuseau ou sur la question de savoir si aujourd'hui compte.
- `longestStreak` lit **tout l'historique, sans fenêtre**. C'est la seule mesure de cet écran qui
  charge la table entière, et c'est irréductible : une série de 40 jours tenue il y a deux ans reste
  la meilleure jamais tenue. La contiguïté se vérifie par arithmétique de dates, **jamais** en
  comparant des chaînes — le 31 janvier est suivi du 1ᵉʳ février.

**La heatmap, et les deux calages qui ne lèvent rien s'ils disparaissent :**

- La grille **commence au lundi qui précède** la fenêtre. Sans ce calage la première colonne est
  incomplète, tout glisse d'un cran, et **chaque jour s'affiche sur la mauvaise ligne** : une grille
  pleine, plausible, et fausse. `heatmapCells` le fait, et le test asserte le `weekday` de la
  première cellule — pas seulement le nombre de cases.
- La dernière colonne, elle, **n'est jamais complétée** : un jour à venir rendu au palier 0 serait
  indiscernable d'un jour sans révision. On s'arrête à aujourd'hui, la colonne reste partielle.
- Le palier est **relatif au maximum de la fenêtre affichée**, et `level 0` ↔ `count 0` exactement :
  un jour à une seule révision ne doit jamais être gris.

⚠️ **Le piège de rendu, et c'est le pire du lot : les classes Tailwind construites.**
`` :class="`bg-accent/${level * 25}`" `` ne génère **aucune règle** — Tailwind scanne du texte, il ne
résout pas d'expression. La heatmap serait uniformément grise avec `lint`, `typecheck` et **toute la
suite verts**, jsdom ne faisant aucun layout. D'où la table `LEVEL_CLASS` de `stats.vue`, en
**classes littérales complètes**. Ça se vérifie à `npm run build`, en greppant le `.css` de
`public/assets/` — même famille que le `calc(100vh_-_8rem)` de la modale. Les hauteurs de barres des
histogrammes passent par un **style inline**, une valeur continue ne pouvant de toute façon pas être
une classe.

**Le dénominateur de la régularité est la fenêtre, pas l'âge de la base** — « 12 jours sur 30 » garde
le même sens d'un mois à l'autre, là où un dénominateur mobile serait une seconde règle invisible.
Sur une base jeune le pourcentage paraît donc bas : c'est pourquoi l'écran affiche **le brut à côté
du pourcentage**, jamais le pourcentage seul.

**Limite assumée** : l'histogramme d'heures range une révision à l'heure de sa **note**, pas de sa
présentation — une carte affichée à 22h58 et notée à 23h01 compte pour 23 h.

## Les points faibles : rendre la rétention actionnable (CC-47)

Le même onglet Stats porte, au-dessus de l'habitude et de l'effort, la couche **analyse** — ce que
l'historique dit des thèmes et des cartes qui résistent. Comme le reste de l'écran, tout se déduit de
`leitner_reviews`, **aucune colonne ajoutée**. La logique qui régresserait en silence vit dans
`leitner_weakness.ts` — **pur, sans base ni horloge**, comme `leitner_sessions.ts` et
`leitner_habits.ts` ; `LeitnerStatsService` charge et délègue.

**Rétention par fenêtre 7 / 30 / 90 j.** ⚠️ **Ce n'est pas le `retention` de `/revision`.** Ce
dernier reste un chiffre unique 30 j sur l'écran de révision (une mesure d'**habitude**, cf. le
tableau « stats de paquet vs globales ») et **n'a pas bougé** — il vit toujours dans le `globalStats`
privé de `LeitnerController`. Les fenêtres, elles, disent une **tendance**, et vivent sur l'onglet
Stats. Doctrine identique et non négociable des deux côtés : `grade !== 'again'` = réussite, **`hard`
compte comme une réussite**, seul `again` est un échec. `retentionRate` rend **`null`, jamais 0**,
quand une fenêtre est vide — « 0 % » se lirait comme une rétention effondrée. La page affiche `—`.

**Taux d'`again` par thème, agrégé par catégorie** — la mesure la plus utile du lot : elle désigne
les points faibles réels.

- ⚠️ **UNE seule requête**, `group by leitner_theme_id`, jointure reviews → cards (`db.rawQuery` +
  `count(*) FILTER`, patron `VeilleStatsService`, `?` paramétré). Jamais une requête par thème.
- ⚠️ **La remontée à la catégorie se fait en JS**, via la taxonomie préchargée — une carte ne connaît
  que son thème (`leitner_cards` n'a pas de `leitner_category_id`). C'est **exactement l'approche de
  `dueScopeChoices`**, et surtout **pas une 3ᵉ copie** de la sous-requête catégorie → thèmes (l'unique
  copie reste `applyScope`).
- ⚠️ **`count(*)` revient en `bigint`, donc en chaîne** — le piège de CC-46 : sans `Number()`, les
  totaux de catégorie concatèneraient (`'12' + '7' = '127'`). Le `Number()` est fait **dans
  `aggregateWeakness`**, donc dans le code testé (avec des `count` en chaîne dans le test).
- ⚠️ **Les cartes non classées sont une ligne « Non classées », jamais absente de l'agrégat.** Un
  `theme_id` null y tombe (ainsi qu'un thème introuvable, par sécurité) au lieu de disparaître.

**Deux seuils, tous deux des conventions** (comme `SESSION_GAP_MINUTES`), qui ne se vérifient qu'à
l'usage :

- `WEAKNESS_MIN_REVIEWS = 10` — sous ce volume, un « taux » est du bruit (un thème à 3 révisions dont
  une ratée afficherait 33 % et trônerait pour rien). ⚠️ **Le seuil masque du _classement_, jamais de
  l'_agrégat_** : les lignes sous le seuil restent comptées dans le total de leur catégorie ; c'est le
  drapeau `enoughData` qui décide de leur affichage, et **c'est la page qui tranche** — « Non classées »
  reste toujours visible même sous le seuil. Le `n` est affiché à côté du `%`, sinon le classement est
  du bruit statistique.
- `STUCK_MIN_REVIEWS = 3` — une carte « coincée en boîte 1-2 » doit avoir été **tentée** plusieurs
  fois : une carte neuve (boîte 1, jamais révisée) n'a pas échoué à progresser, elle n'a pas eu sa
  chance. Sans ce plancher, la liste des coincées serait pleine de cartes qu'on vient de créer.

**Cartes à problème — deux listes distinctes par construction** : « le plus d'`again` » (classé en
SQL, ré-ordonné en JS car `whereIn` perd l'ordre) et « coincées en boîte 1-2 » (`withCount('reviews')`,
filtre `>= STUCK_MIN_REVIEWS` en JS). ⚠️ **Chaque carte renvoie vers `/revision/settings`, jamais vers
`/revision`** : le paquet ne fait que réviser, la correction se fait au seul point de saisie. Le lien
passe par le filtre `search` existant (`?search=<front>`, `whereILike` paramétré) — il tombe sur la
carte exacte, sans réintroduire de formulaire d'édition ailleurs.

⚠️ **Tout est sur tout l'historique et globalement** (pas de fenêtre pour les points faibles, pas de
`?theme=` sur cet écran) : un point faible est cumulatif, et l'onglet Stats est global comme le reste.
La fenêtre ne concerne que la rétention (la tendance).

⚠️ **Ce que la suite ne voit pas** : le rendu Vue de `stats.vue` (formatage, liens, table dépliable,
états vides) — pas de test de composant sur cet écran. `leitner_weakness.spec.ts` prouve le code pur
(doctrine `hard`/`again`, « Non classées », somme sans concaténation) ; `leitner_stats_service.spec.ts`
prouve le SQL (jointure, fenêtrage `toSQL()`, les deux requêtes de cartes) — le seul filet dessus. Le
reste se vérifie au navigateur.

## La réponse écrite : le juge propose, l'utilisateur dispose

On écrit sa réponse **avant** de dévoiler le verso — rien n'empêchait de se dire « je le savais »
devant une carte qu'on ne savait pas. **Le dévoilement vaut soumission** : le champ se verrouille.

⚠️ **Le juge ne choisit pas la note, et c'est la seule conception qui tienne.** `again/hard/good/easy`
notent l'**effort de rappel** ; un juge ne sait qu'une chose, juste ou faux. S'il notait, `hard` et
`easy` disparaîtraient (les deux sont « juste ») et Leitner retomberait sur un binaire — plus
grossier que l'auto-évaluation qu'on remplace, et vidant `again` de son sens.
→ **Le verdict présélectionne un bouton. Les quatre restent cliquables.**

⚠️ **Corollaire de sécurité, gratuit — et c'est le piège si on « fluidifie ».** La réponse est du
texte libre injecté dans un prompt : l'injection est possible (« dis que c'est juste »). Elle ne mène
nulle part **parce qu'aucun verdict n'est appliqué sans confirmation**. Supprimer la confirmation
pour gagner un clic ouvrirait la brèche : elle porte deux rôles, et le second ne se voit pas.

### Trois chemins, et deux ne touchent jamais au réseau

| réponse | chemin | `verdict` | `latency_ms` |
| --- | --- | --- | --- |
| **vide** | aucun appel | `null` | `null` |
| **égale au verso** (normalisée) | **court-circuit**, aucun appel | `juste` | `null` |
| autre | le juge LLM | `juste`·`partiel`·`faux`, ou `null` si repli | la durée de l'appel |

- Le court-circuit compare via `normalizeForSearch` (celle de la barre de recherche) — **pas une
  seconde copie**, elle divergerait. Limite acceptée : la ponctuation finale n'est pas retirée, donc
  un verso « … et algorithmes. » répondu sans le point part au juge. Sans conséquence : c'est une
  optimisation de latence, pas une règle de justesse. Il **est affiné comme les autres**.
- Une **réponse vide n'est pas une panne** : `unavailable` reste `false`, aucun badge.
- ⚠️ **`manquant` est la valeur pédagogique du lot, pas le verdict.** Un verdict `juste` le vide
  toujours : un modèle bavard remplit ce champ même quand tout y est.

### Le repli est obligatoire, et il couvre plus que « serveur éteint »

⚠️ **Contrairement à l'ingestion, la révision est le cœur du module : elle ne tombe jamais.** Tout
échec du juge retombe **exactement** sur l'auto-évaluation d'avant ce lot (`verdict: null`, aucune
présélection, aucune erreur bloquante). Trois causes, un seul comportement : `LlmUnavailableError` ;
**une sortie illisible** (prose au lieu de JSON — le **régime normal** d'un petit modèle local, pas
une panne) ; **un verdict hors énumération**, où `parseVerdict` rend `null` plutôt que de deviner.

**Aucune réparation**, contrairement à l'ingestion : elle peut s'offrir un second appel en tâche de
fond, l'utilisateur qui attend, non. ⚠️ **Le repli garde `easy` en avant**
(`highlightedGrade = suggestedGrade ?? 'easy'`) : c'est le bouton que l'écran mettait en avant avant
le juge, et une panne de LM Studio ne doit pas changer l'apparence de la révision. Le mot « suggéré »
ne s'affiche que si un juge l'a vraiment dit.

### Ce que l'historique retient, et pourquoi `null` n'est pas `faux`

`leitner_reviews` porte `answer`, `verdict`, `latency_ms`, `thinking_ms`, `total_ms` — **tous
nullables, et la nullabilité est du sens** : `verdict = null` veut dire « aucun juge n'a tranché »,
jamais « jugé faux ». C'est ce qui permettra de rejuger a posteriori ce qui a été écrit pendant une
panne.

- ⚠️ **`latency_ms` mesure le seul appel au LLM — la vitesse de LM Studio, pas celle du souvenir**
  (`null` sur court-circuit et sur repli). Mesurer tout le cycle mélangerait deux populations dans
  une colonne. La fluence **ne pouvait pas s'en servir** : il a fallu `thinking_ms`.
- ⚠️ **`verdict` et `latencyMs` sont DÉCLARATIFS**, comme `source`/`sourceName` : juger et noter sont
  deux requêtes. Acceptable parce qu'ils sont bornés, jamais interprétés, **et ne calculent rien** —
  le dégât maximal est une ligne qui ment dans son propre historique.
- ⚠️ **`thinking_ms`, lui, calcule — et c'est la seule entorse à cette doctrine** (voir plus bas).

### Les deux temps, et le piège de l'état qui survit

`POST /revision/:id/judge` rend du **JSON nu** : la page l'appelle en `fetch`, donc avec
**`x-xsrf-token`** repris de `components/leitner_csrf.ts`, **l'unique copie** des trois écrans qui
appellent du JSON nu. Elle **n'écrit rien** (l'historisation se fait à la note, un double-clic est
sans conséquence) et rend **200 même en échec** — un 500 casserait le dévoilement.

⚠️ **Le verso s'affiche sans attendre le verdict**, ce qui rend `JUDGE_TIMEOUT_MS` (90 s) généreux à
dessein : un juge lent ne bloque rien, et un verdict qui arrive après la note est ignoré. Une valeur
serrée transforme une machine lente en « juge indisponible » permanent. Mesuré sur un 24B local :
~6 s sur une réponse courte, ~10 s sur une carte réelle, davantage à froid. Ce que le délai borne
vraiment, c'est un serveur qui accepte la connexion **puis se tait**.

⚠️ **Le repli est muet pour l'utilisateur, jamais pour l'exploitant** : le badge est le même quelle
que soit la cause, donc sans les `logger.warn` de `LeitnerJudgeService` un serveur éteint, un délai
dépassé et un modèle qui rend de la prose sont **indiscernables**. Le log du dépassement porte
`elapsedMs` et `timeoutMs` ; celui de la sortie illisible porte la réponse brute tronquée.

⚠️ **L'état de l'écran se remet à zéro sur la référence de `dueCards`, PAS sur `currentCard.id`** —
piège n° 1 de cet écran, et contre-intuitif. `again` remet la carte dans la file ; sur une file d'une
seule carte (le cas normal en fin de session, précisément sur celle qu'on vient de rater) la carte
qui revient porte le **même id**. Un `watch` sur l'id ne se déclencherait pas : verso encore affiché,
réponse encore dans le champ, verdict encore là — **on ne pourrait plus réviser honnêtement cette
carte**, exactement la triche que ce lot supprime. Inertia renouvelle la référence de `dueCards` à
chaque réponse. **N'ajoute jamais un `ref` de jugement sans l'ajouter à ce `watch`.** La réponse du
`fetch` vérifie **aussi** que la carte n'a pas changé pendant l'appel.

⚠️ **`temperature: 0` est demandé appel par appel**, et `DEFAULT_TEMPERATURE` (0.2) reste celui de
l'ingestion — n'abaisse pas ce défaut « puisque le juge veut 0 » : les deux appelants partagent ce
client et veulent l'inverse (noter vs synthétiser). Et c'est `?? DEFAULT_TEMPERATURE`, jamais `||` :
`0` est falsy, un `||` ferait improviser le juge en silence.

## Le timer fantôme : la fluence AFFINE la proposition

Le juge dit la **justesse** et laisse `hard`, `good`, `easy` indistincts. Le **temps jusqu'à la
première frappe** récupère la nuance : juste + très rapide → `easy` · normal → `good` · lent → `hard`.

- ⚠️ **Le chrono ne s'affiche JAMAIS** — c'est le sens du mot « fantôme ». Un chrono visible change le
  comportement qu'il prétend mesurer : il stresse et fait bâcler la réponse.
- ⚠️ **On mesure jusqu'à la première frappe, pas le temps total** — piège central du lot. Le temps
  total est dominé par la **longueur de la réponse à taper**, pas par la difficulté du rappel : le
  facteur parasite croît avec exactement la variable qu'on veut isoler. Une fois qu'on tape, on sait.
  `total_ms` est stocké quand même, en **donnée d'observation**, et aucune règle ne le lit.
- ⚠️ **Deux services, et ils ne se fondent pas** : `LeitnerJudgeService` (justesse, appelle le LLM,
  aucune base) puis `LeitnerFluencyService` (effort, lit l'historique). Fusionner ferait perdre au
  juge sa testabilité contre un faux client.

### Trois conditions sans lesquelles la mesure ment

Elles gouvernent **à la fois la proposition et l'écriture**, qui ne peuvent pas diverger.

1. **Première présentation du jour uniquement.** `again` redonne la carte quelques minutes plus tard :
   la seconde réponse est rapide par **mémoire de travail**, pas par apprentissage — proposer `easy`
   promouvrait une carte qu'on vient de rater. ⚠️ C'est le **serveur** qui tranche
   (`wasPresentedToday`), jamais la page.
2. **Interruption.** Document masqué ou fenêtre défocalisée avant la première frappe → mesure écartée.
   `document.hidden` est **lu à l'arrivée de la carte**, pas seulement écouté : une carte présentée
   dans un onglet déjà en arrière-plan n'émettrait aucun événement. ⚠️ Le plafond de 120 s
   (`MAX_THINKING_MS`) reste le filet des distractions longues — `visibilitychange` ne se déclenche
   pas quand on bascule vers une autre application, et *rien* ne se déclenche quand on se détourne de
   l'écran. ⚠️ **Une bande reste découverte, 20 à 120 s** : la distraction la plus courante, et la
   seule qui produise un `hard` *plausible*, donc invisible.
3. **Aucune référence → aucune proposition affinée, en silence.** Le seuil est **relatif** : 10 s sont
   rapides pour « explique le théorème CAP » et très lentes pour « quel port pour Postgres ». Médiane
   de la carte si ≥ 5 mesures, de sa **boîte** si ≥ 20, sinon rien — et « rien » doit être
   **indiscernable de l'absence de ce lot** : pas de badge, pas de message.

Un quatrième garde-fou vient de l'arithmétique : `MIN_REFERENCE_MS` (2 s). Sur une carte répondue en
1,5 s, les seuils tomberaient à 0,9 s et 2,4 s — on classerait sur du bruit de frappe.

- ⚠️ **Seul un verdict `juste` est affiné.** `faux → again` et `partiel → hard` ne bougent pas : la
  vitesse ne dit rien de la justesse d'une réponse fausse, et `again` doit rester hors d'atteinte du
  timer.
- ⚠️ **La fluence ne rend jamais la note automatique.** Une réponse **devinée** est rapide et juste :
  le timer dira `easy`, le juge dira `juste`, et seul l'utilisateur sait qu'il a deviné. C'est
  l'argument irréductible — la confirmation reste, et elle porte aussi la neutralisation de
  l'injection de prompt.

### Ce que le couplage écriture/lecture achète

`thinking_ms` n'est **écrit** que sur une mesure exploitable : la colonne ne contient donc, par
construction, que des mesures comparables. C'est ce qui permet de lire la référence par un simple
`median(thinking_ms IS NOT NULL)`, **sans jamais filtrer**. Si tu relâches l'écriture, il faut
filtrer à la lecture — sinon les mesures de re-présentation feraient dériver la médiane vers le bas,
et une carte mal sue finirait par se voir proposer `easy`.

- ⚠️ **L'ordre dans `LeitnerService.review()` n'est pas négociable** : « déjà présentée aujourd'hui ? »
  compte les révisions **existantes**, donc la question se pose **avant** le `LeitnerReview.create()`.
  Posée après, elle répondrait toujours « oui » et la colonne resterait éternellement vide — sans
  erreur, sans log, avec un lot qui paraît livré.
- ⚠️ **`thinking_ms` est DÉCLARATIF, et la doctrine des champs déclaratifs s'arrête ici.** Les autres
  étaient sûrs parce qu'ils **ne calculaient rien** ; celui-ci choisit le bouton mis en avant et
  alimente la référence des propositions futures. Ce qui le rend acceptable est plus étroit : la
  proposition n'est **jamais appliquée sans confirmation**, la valeur est bornée au validateur, et un
  client qui mentirait ne dégraderait que **ses propres** suggestions. Le jour où une règle lirait
  cette colonne pour décider d'une **boîte**, c'est ce raisonnement-là qu'il faudrait rouvrir.
- ⚠️ **`MEASURE_MAX_MS` (1 h) est un plafond de transport, pas de vraisemblance** : il existe pour
  qu'une mesure absurde ne fasse jamais **échouer une note**. Un onglet ouvert trois heures produit
  onze millions de millisecondes ; sous une borne plus serrée, `POST /review` partirait en 422 et
  l'utilisateur cliquerait un bouton sans que rien ne se passe. La page écrête **avant** l'envoi ; le
  seuil réellement exploitable (120 s) s'applique plus loin, dans la règle.
- ⚠️ **Il vit dans `shared/review_page.ts`, et c'est sa seule déclaration.** Il en existait **deux**,
  parce que l'alias `#modules/*` n'est pas résolvable depuis un `.vue` : baisser le plafond serveur
  sans toucher la copie produisait exactement le 422 ci-dessus, rien à l'écran, rien de rouge.
  `leitner_review_page.spec.ts` **relit `index.vue`** et rougit si le littéral y réapparaît, **même en
  commentaire** — mais il n'attrape que la recopie littérale, un `60 * 60 * 1000` passerait.

### Deux biais assumés

- **La référence de boîte est biaisée sur deux axes.** *La longueur du recto* — le temps jusqu'à la
  première frappe inclut la lecture de la question ; contre sa *propre* médiane le biais s'annule,
  contre sa boîte non. *L'âge des mesures* — `leitner_reviews` ne porte pas de boîte, donc chaque
  mesure est attribuée à la boîte où sa carte est **aujourd'hui** : le vivier d'une boîte haute est
  dominé par des mesures prises plus bas, quand ces cartes étaient moins sues. Les deux poussent vers
  un `easy` sur-proposé en boîte haute. Borné — ce repli ne sert que tant qu'une carte n'a pas 5
  mesures à elle.
  ⚠️ **Depuis CC-260 la colonne existe** (`box_before`/`box_after` sur `leitner_reviews`), donc le
  second axe est corrigeable — mais **seulement en avant** : elle est `null` sur tout l'historique
  antérieur au lot, et ça ne se rattrape pas. Un correctif devrait donc composer avec deux
  populations dans la même colonne. Reste un lot à part, et la phrase « il faudrait une colonne »
  n'est simplement plus la bonne raison de le reporter.
- **Les ratios 0,6 / 1,6 sont des conventions**, comme `SESSION_GAP_MINUTES` : ils ne se vérifient
  qu'à l'usage.

⚠️ **L'écrêtage est prouvé, le chronométrage ne l'est pas** : `duration` et `fluencyMeasure` ont leurs
tests, mais ce qui les **alimente** — `Date.now()`, `visibilitychange`, `blur`, la remise à zéro entre
deux cartes, l'enveloppe qui rabote les quatre `ref` — reste sans filet, `pages/index.vue` n'ayant
pas de test de composant. D'où le fait que la page ne décide de **rien** : elle chronomètre et
transmet, toute la règle est côté serveur. Les **quatre** `ref` du chrono (`presentedAt`,
`firstInputAt`, `revealedAt`, `interrupted`) sont dans le `watch` sur la référence de `dueCards` —
un `firstInputAt` qui survivrait à une note donnerait une durée quasi nulle, donc `easy` sur la
carte qu'on vient de rater.

⚠️ **Une durée négative se rend `null`, jamais `0`** : une correction NTP recule l'horloge, et la
ramener à zéro donnerait la **meilleure valeur possible** — `easy` proposé, et un `0` écrit qui
tirerait la médiane vers le bas durablement. Une mesure qu'on n'a pas ne vaut pas zéro.

## Les marques de maîtrise — posées, jamais lues (CC-260)

Premier des trois lots qui donneront au module un **inventaire d'acquis**. Celui-ci pose le schéma
et les marques. ⚠️ **Il ne change AUCUN comportement visible** : aucune file, aucun compteur, aucun
écran ne bouge — `mastered_at` se remplit et personne ne le lit. CC-261 (sortie de file, régime
d'entretien) puis CC-262 (l'inventaire visible) le consommeront.

**Le défaut réel qu'il corrige** : on ne pouvait pas savoir depuis quand une carte est en boîte 5,
et on ne pouvait pas le reconstituer. `leitner_reviews` ne portait ni `box_before` ni `box_after`,
et rejouer `nextBox` depuis la boîte 1 aurait été faux dès qu'un import est passé — l'import écrit
`box` **directement** depuis le JSON, sans que les révisions correspondantes produisent ce chemin.
Les colonnes ne sont que la réponse ; le défaut est là.

**Cinq colonnes, une seule migration** (`1786600000005_add_mastery_marks_to_leitner_tables.ts`) :

| table | colonne | rôle |
| --- | --- | --- |
| `leitner_card_progress` | `box5_entered_at` | l'horloge — posée à l'entrée en boîte 5, réarmée par `again`, effacée à la sortie |
| `leitner_card_progress` | `mastered_at` | la date d'acquisition. `null` = pas (ou plus) maîtrisée |
| `leitner_reviews` | `kind` | `normal` \| `maintenance` — **de quelle file la carte venait** |
| `leitner_reviews` | `box_before` / `box_after` | la boîte avant et après la note, **nullables** |

⚠️ **Les cinq voyagent ensemble, avec UNE seule montée de `BACKUP_VERSION` (→ 4)** : chaque montée
est une occasion d'oublier le `snapshot()` de `leitner_backup.spec.ts`, et cet oubli fait perdre des
données **sans qu'aucun test ne rougisse** — c'est ce qui a laissé passer CC-51.

### Le critère, et le plancher qui le fonde

Une carte devient maîtrisée quand, **au moment de la noter** : *(1)* elle était **déjà** en boîte 5 ;
*(2)* la note est `good` ou `easy` ; *(3)* il s'est écoulé au moins **`max(box5Days, 30)` jours**
depuis `box5_entered_at`. Le tout vit dans `services/leitner_mastery.ts`, **pur** — ni base, ni
horloge (`now` est un paramètre), comme `leitner_habits.ts` : c'est ce qui permet d'éprouver
« trente jours » sans attendre trente jours.

⚠️ **Le plancher de 30 jours est constant, indépendant du réglage.** `leitner_settings` est un
réglage d'**installation** (une ligne, partagée, réglable de 1 à 365 jours) : si le critère le
suivait seul, « maîtrisée » voudrait dire deux choses différentes avant et après que quelqu'un l'ait
touché, **sur des cartes déjà marquées**. Un inventaire d'acquis est une affirmation sur la mémoire
d'une personne, pas sur la configuration de l'application. Par défaut (`box5Days = 30`) le plancher
est **inerte** ; il ne mord que si on raccourcit l'intervalle.

⚠️ **`hard` est une réussite mais ne valide pas — écart VOULU avec `retentionRate`.** La rétention
(`leitner_weakness.ts`, et le `retention` 30 j de `/revision`) compte `hard` comme une réussite ;
la maîtrise non. Ce sont deux barres différentes : l'une mesure « l'ai-je retrouvé », l'autre « le
sais-je solidement ». **Ne les aligne pas « par cohérence »** — quelqu'un le remarquera, et c'est
prévu.

⚠️ **`hard` ne réarme PAS l'horloge — décision prise faute de consigne, à confirmer.** Raison :
`hard` ayant été qualifié de réussite, réarmer serait une punition. Conséquence mesurable — avec
`box5Days < 30`, un `hard` retarde la maîtrise d'un intervalle au lieu de la repousser au-delà du
plancher. Si l'arbitrage bascule, c'est **une ligne** dans `nextMasteryState`, et
`leitner_mastery.spec.ts` porte le test qui rougirait.

Deux règles que le ticket ne portait pas et qui ont été tranchées à l'implémentation :

- ⚠️ **La sortie de boîte 5 efface les deux marques** (2ᵉ `hard` d'affilée, seul chemin de
  rétrogradation). Laissées en place, la colonne affirmerait « en boîte 5 depuis X » d'une carte en
  boîte 1, et tout consommateur de CC-261/262 qui lirait `box5_entered_at IS NOT NULL` comme « est
  en boîte 5 » serait faux.
- ⚠️ **Une carte importée directement en boîte 5 reçoit son horloge à sa première note.** Elle
  arrive sans horloge (l'import écrit `box` sans qu'aucune note ne l'y ait amenée) : la laisser
  `null` la rendrait **définitivement** non maîtrisable, en silence. On ne sait pas quand elle est
  entrée, donc on compte à partir de maintenant — et cette note-là ne peut donc pas la valider.
- **La date d'acquisition ne dérive pas** : posée une fois, les réussites suivantes la conservent.
  Elle avancerait à chaque `good` et ne daterait plus rien.

### Le piège d'implémentation, et il a un précédent exact

⚠️ **`kind` dit de quelle file la carte VENAIT, pas où elle finit.** Une carte maîtrisée ratée en
entretien produit une révision `maintenance` **alors qu'elle en ressort non maîtrisée**. `kind` et
`box_before` se calculent donc **avant** que la note ne modifie quoi que ce soit, au même endroit et
pour la même raison que `lastGrade` (« l'ordre n'est pas négociable »). Inversé, le symptôme est
indétectable : l'historique dirait qu'aucun entretien n'a jamais échoué.

⚠️ **Et le piège dans le piège : `firstOrNew` rend `undefined`, pas `null`.** Sur un modèle neuf,
`progress.masteredAt` vaut `undefined` — un `!== null` posé directement dessus classerait **toute
première note** en `'maintenance'`, sans erreur ni log. D'où l'objet `before` normalisé par `?? null`
dans `review()`, et le test dédié « la première note d'une carte jamais révisée est `normal` ».

⚠️ **`columnName: 'box5_entered_at'` est explicite sur le modèle**, exactement comme
`leitner_settings.box5Days` : la conversion automatique rend `box_5_entered_at`. Sans ce mappage
l'insertion échoue sur une colonne inexistante — mesuré, même piège que le module documentait déjà
pour un identifiant qui mêle lettres et chiffres.

### Ce que les backfills valent, et ce qu'ils ne prouvent pas

- **`kind = 'normal'` sur l'historique est EXACTEMENT vrai**, pas une approximation : une révision
  d'entretien ne peut exister qu'après que la maîtrise existe, or elle n'existait pas avant ce lot.
  Le `default` de la colonne suffit, il n'y a rien à écrire — et `resolveReviewKind` fait le même
  raisonnement à l'import sur un fichier v < 4.
- ⚠️ **`box5_entered_at = updated_at` (lignes en boîte 5) EST une approximation assumée.** C'est la
  meilleure disponible — le module utilise déjà cette colonne comme marqueur d'ordre de file — et
  elle peut **surestimer** l'ancienneté si la ligne a été touchée pour autre chose.
- ⚠️ **`box_before`/`box_after` restent `NULL` sur tout l'historique, et ça ne se rattrape pas.**
  `null` = « antérieur au lot, inconnu ». Tout agrégat qui les lira devra le gérer **pour toujours** ;
  ce n'est pas un trou à combler un jour.
- ⚠️ **Le backfill n'est prouvable par AUCUN runner, et c'est MESURÉ, pas déduit** : le supprimer
  entièrement laisse la suite **verte** (`app_test` est vide, l'`update ... where box = 5` touche
  zéro ligne). La vérification est une empreinte relevée **avant et après** sur une base qui porte
  du contenu, modèle CC-119 — voir `TESTS.md`.

⚠️ **`rawQuery`, jamais `.update({ col: db.raw('autre_col') })` dans un backfill.** Le `RawBuilder`
de Lucid n'est pas une expression pour knex : il part en **binding**, sérialisé en
`{"sql":"updated_at"}`, et Postgres refuse. Mesuré sur ce lot. Une colonne référencée est du SQL,
pas une valeur.

## La règle métier

Les intervalles **vivent en base**, dans la ligne unique de `leitner_settings`, et se règlent depuis
`/revision/settings`. Lis-les avec `LeitnerService.boxIntervals()`.
`DEFAULT_BOX_INTERVAL_DAYS = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 30 }` n'est **que** la valeur de départ :
ne t'en sers jamais pour calculer une échéance.

| note    | boîte atteinte                            | `next_review`              |
| ------- | ----------------------------------------- | -------------------------- |
| `again` | **inchangée**                             | **aujourd'hui**            |
| `hard`  | inchangée — sauf **2ᵉ `hard` d'affilée** → 1 | intervalle de cette boîte |
| `good`  | +1                                        | intervalle de cette boîte  |
| `easy`  | +2                                        | intervalle de cette boîte  |

- Boîte plafonnée à 5. `next_review` = aujourd'hui + l'intervalle **réglé** pour la boîte **atteinte**
  (après mouvement). `again` est la seule note qui laisse la carte due le jour même.
- **`again` ne rétrograde pas** : c'est « remets-la moi maintenant », pas une sanction. La carte reste
  dans sa boîte, redevient due, revient **en fin de file dans la session en cours**. Rater une fois ne
  défait pas ce qui a été acquis — seule la promotion est suspendue.
- ⚠️ **Le « 2ᵉ `hard` d'affilée » est donc le seul chemin de rétrogradation du module.** Aucune
  quantité de `again` ne fait descendre une carte : une carte de boîte 5 ratée tous les jours reste en
  boîte 5 et repart à l'intervalle de la boîte 5 dès le premier `good`. Prix assumé d'un `again` sans
  sanction ; si ça gêne un jour, c'est **cette ligne** qu'il faut rouvrir, pas l'ordre de la file.
- « Deux `hard` d'affilée » = la **dernière révision enregistrée** était déjà `hard`, quel que soit le
  délai (`lastGrade`). Un `hard` séparé du précédent par une autre note ne rétrograde pas — **y
  compris par un `again`**, qui remet donc le compteur à zéro.

⚠️ **L'ordre de la file dépend de cette règle** : `dueCards(userId, scope)` trie `next_review` asc →
`updated_at` asc → `id` asc. **Ne trie jamais par `box`** — depuis qu'`again` laisse la boîte intacte,
un tri par `box` rendrait la carte ratée **à la même place** qu'avant la note : elle se
re-présenterait aussitôt, en boucle, session bloquée. C'est `updated_at` qui la renvoie en fin de
file. Le ciblage par thème n'y change rien : le paquet retire des cartes, il ne réordonne pas. La
requête vit dans le **service**, pas dans le contrôleur.

⚠️ **Et c'est l'`updated_at` de la PROGRESSION, pas celui de la carte** — la traduction la plus
fragile de CC-119. Noter n'écrit plus sur `leitner_cards`, dont l'`updated_at` ne bouge donc qu'à
l'édition du contenu : s'y fier laisserait la carte ratée en tête et rejouerait la boucle
ci-dessus, avec un typecheck vert et toute la suite verte sauf les trois tests d'ordre. Les deux
`coalesce` de l'ordre vivent dans `leitner_progress.ts`, jamais recopiés — le repli sur
`leitner_cards.updated_at` ne sert que les cartes **jamais notées**, dont l'âge est tout ce qu'on
sait.

⚠️ **`review()` écrit deux tables, sous `db.transaction()`.** L'invariant « une note = un mouvement
de boîte ET une ligne d'historique » ne tenait plus tout seul : un échec entre les deux laisserait
une boîte avancée sans trace, ou une trace sans mouvement — qui réarmerait la règle du 2ᵉ `hard` sur
une note que la carte n'a jamais reçue.

⚠️ **La règle du 2ᵉ `hard` lit le `lastGrade` de la personne, jamais celui de la carte.** C'est
précisément ce qui rendait le cloisonnement de l'historique inséparable de celui de la progression :
lu sans filtre, le `hard` d'un collègue fait retomber ma carte en boîte 1 sur mon premier `hard` —
sans erreur, sans log. Même remarque pour `wasPresentedToday` (fluence) et
`hasReviewedTodayInScope` (« terminé, bravo »).

**Rétention** : `grade !== 'again'` — `hard` compte comme une **réussite** (la réponse a été rappelée,
péniblement), même depuis qu'il ne fait plus progresser la carte.

**Les boutons annoncent leur effet** : `index.vue` reçoit `boxIntervals` (envoyés par le serveur, la
page ne les redéclare jamais) et le `lastGrade` de chaque carte due — chaque bouton affiche la boîte
atteinte et l'échéance, y compris « 2ᵉ d'affilée · boîte 1 ». Ne réintroduis pas de libellés muets.

## Les intervalles se règlent : `leitner_settings`

Une **seule** ligne, `id = 1`, protégée par un `check` en base — n'en crée jamais une seconde,
`settings()` lit celle-là (`firstOrCreate`). Le modèle mappe `box_1_days` … `box_5_days`
**explicitement** (`columnName`), sans se fier à la conversion automatique d'un identifiant qui mêle
lettres et chiffres.

- Bornes **1 à 365 jours**. Un intervalle à **0 est refusé** : il laisserait la carte due le jour de
  sa réussite, donc éternellement en session — c'est le privilège de `again`, et de lui seul.
- `updateBoxIntervals()` **ne recalcule aucune échéance** : les cartes déjà notées gardent le
  `next_review` posé avec l'ancien intervalle. Rejouer les échéances déplacerait des cartes que
  l'utilisateur n'a pas revues.
- La valeur par défaut est dupliquée dans `leitner_service.spec.ts`, et c'est assumé : un test qui
  importerait la constante n'asserterait plus rien.

## Le classement : catégorie → thème

Une carte porte **un thème** (`leitner_theme_id`, nullable = « non classée »), un thème appartient à
**une catégorie**. Pas de classement multiple : la colonne `tags` a été supprimée, son contenu repris
en thèmes sous une catégorie `Import` — une catégorie `Import` vide qui traîne est ce résidu.

- `leitner_themes` : unique sur **(catégorie, nom)** — « Docker » peut vivre sous DevOps *et* Cloud.
- Supprimer une **catégorie** → thèmes en CASCADE, cartes non classées. Supprimer un **thème** →
  cartes non classées (`ON DELETE SET NULL`). **Aucune suppression de carte n'est jamais implicite** ;
  seule la suppression explicite d'une carte détruit des données (et emporte ses révisions).
- `LeitnerCatalogService` renvoie **`null`** quand un nom est déjà pris : le contrôleur en fait une
  erreur de formulaire, il ne lève pas.

## Sauvegarde : l'export JSON

`GET /revision/export` rend un instantané : taxonomie **visible**, cartes **visibles** et
**historique des révisions**. Sans l'historique, une restauration remettrait la série à zéro,
viderait la rétention 30 j — et surtout **réarmerait la règle du « 2ᵉ `hard` d'affilée »**, qui lit
la dernière révision enregistrée.

⚠️ **Le fichier est PERSONNEL depuis la v2 (CC-119), et FILTRÉ depuis la v3 (CC-139)** : il ne rend
plus « toutes les cartes », mais **celles que l'exportateur peut voir** — les siennes, plus tout ce
qui est marqué partagé — avec `box`/`nextReview`/`reviews` qui restent ceux de **celui qui
exporte**. Avant ce filtre, exporter son propre historique embarquait dans le fichier le contenu
privé de tous les autres comptes — la fuite la plus large que CC-139 corrige. Exporter à deux
produit deux fichiers dont le contenu **peut différer** (chacun sa part privée) en plus des
progressions différentes ; importer celui d'un collègue ajoute ses cartes **et s'attribue sa
progression** — ce n'est pas un moyen de « rendre ses cartes ».

```json
{
  "version": 4,
  "exportedAt": "2026-07-13T14:12:03.000Z",
  "categories": [{ "name": "DevOps", "themes": ["Docker", "Kubernetes"] }],
  "cards": [{
    "front": "Rôle du handshake TLS ?", "back": "Négocier clés et algorithmes.",
    "category": "DevOps", "theme": "Docker",
    "box": 3, "nextReview": "2026-07-20",
    "createdAt": "2026-07-01T08:00:00.000Z", "updatedAt": "2026-07-13T09:02:00.000Z",
    "shared": true,
    "reviews": [
      { "grade": "good", "reviewedAt": "2026-07-13T09:02:00.000Z", "kind": "normal",
        "answer": "Négocier les clés de session.", "verdict": "partiel",
        "latencyMs": 4200, "thinkingMs": 8500, "totalMs": 31000,
        "boxBefore": 2, "boxAfter": 3 },
      { "grade": "hard", "reviewedAt": "2026-07-14T09:02:00.000Z", "kind": "normal" }
    ]
  }]
}
```

⚠️ **Une carte maîtrisée porte en plus `box5EnteredAt` et `masteredAt`** (CC-260), aux côtés de
`box`/`nextReview` : ils décrivent la même progression personnelle. Omis quand ils valent `null` —
là, l'absence *est* `null` (« pas en boîte 5 », « pas maîtrisée »), il n'y a rien à trancher.

- **La taxonomie est désignée par son nom, jamais par un id — et le fichier n'en contient aucun.**
  Réinjecter un id casserait les séquences Postgres (`leitner_cards_id_seq` ne suit pas un insert à
  id explicite) : le prochain ajout depuis l'UI planterait sur un doublon de clé primaire.
- Une carte non classée **omet** `category`/`theme` (plutôt que `null`), et une révision omet de même
  ce qui vaut `null` : le fichier se relit à la main. ⚠️ L'omission porte sur `=== null`, **jamais sur
  la vérité** — une réponse vide (`""`) et une frappe immédiate (`0`) sont des valeurs, pas des
  absences. Un filtre falsy les perdrait.
- **Les cinq colonnes de trace sont exportées.** ⚠️ `thinkingMs` n'est pas de l'historique : c'est la
  **référence de fluence**, et la perdre désactive le raffinement des propositions sans le dire.
  `answer` est de loin la plus lourde (2 000 caractères possibles) : **assumé**, le fichier est une
  sauvegarde et non un format d'échange, et il n'y a **pas** de paramètre pour l'alléger.
- `nextReview` est un jour calendaire (`date`) ; `reviewedAt`/`createdAt`/`updatedAt` des horodatages
  ISO (`timestamp`). Ne pas les intervertir.
- `createdAt`/`updatedAt` sont exportés **parce que l'ordre de la file en dépend** : sans eux, toutes
  les cartes restaurées prendraient l'instant de l'import et la carte ratée hier ne repasserait plus
  en fin de file.
- Les **intervalles** ne sont **pas** dans le fichier : c'est la configuration du module, pas du
  contenu. Une base restaurée repart sur les défauts ; les échéances importées sont intactes,
  `next_review` étant stocké et jamais recalculé.

⚠️ **L'export ne peut pas passer par Inertia** : c'est une **réponse HTTP nue** (`application/json` +
`content-disposition: attachment`), et côté Vue un `<a href>` natif — **jamais** `<Link>` ni
`router.get()`, qui attendent une réponse Inertia. Le bug ne se voit qu'au clic dans un vrai
navigateur : au `curl` comme en test fonctionnel, la réponse paraît parfaite.

⚠️ **La leçon de CC-51 vaut pour la prochaine colonne** : l'export était arbitraire tant qu'« aucune
règle ne lit ces colonnes » — puis la fluence a cassé cette phrase, `thinking_ms` **étant** lu par une
règle. Une restauration qui l'aurait laissé derrière ne perdait plus de l'historique mais **remettait
le raffinement à zéro**, silencieusement inerte. « Aucune règle ne la lit » est une propriété du code
**d'aujourd'hui**, pas du format : le jour où une colonne cesse d'être décorative, c'est l'export
qu'il faut rouvrir, et rien ne le signalera.

## L'import : le même format, deux usages

`POST /revision/import` lit exactement ce que l'export écrit. **Seuls `front` et `back` sont
obligatoires** : le reste prend les valeurs d'une carte créée depuis l'UI (boîte 1, due aujourd'hui).
Un fichier de saisie en masse se réduit donc à
`{ "cards": [{ "front": "…", "back": "…", "category": "DevOps", "theme": "Docker" }] }`.

**L'import n'ajoute que ce qui manque. Il n'y a pas de mode « remplacer », et c'est voulu** : aucune
route de ce module ne détruit du contenu en masse. Restaurer, c'est importer dans une base vide.

- **Déduplication sur le couple (recto, thème)** — contre la base *et* contre le fichier, donc
  rejouer deux fois le même fichier n'ajoute rien. Le même recto sous **deux thèmes** reste deux
  cartes. Revers assumé : deux cartes réellement identiques n'en font qu'une après un aller-retour.
- **La taxonomie est fusionnée par nom, jamais dupliquée**, et créée à la volée si une carte la
  mentionne sans que le bloc `categories` l'ait déclarée. `category` et `theme` vont **toujours
  ensemble** : l'un sans l'autre est une erreur, pas une carte non classée.
- Une carte existante n'est **jamais écrasée**. ⚠️ **Elle est ignorée *entièrement*, ses révisions
  comprises** : ses colonnes de trace vides ne sont **jamais rétro-remplies** — la boucle des
  révisions vit après le `continue` de déduplication. Apparier deux révisions demanderait une clé
  qu'on n'a pas (`reviewed_at` n'est pas unique), et un mauvais appariement écrirait des mesures sur
  la mauvaise carte, donc une **référence de fluence fausse**, en silence.
- **`version` inconnue → refus** avec un message : un import « au mieux » sur un format qu'on ne
  comprend pas écrit des données fausses en silence. Un fichier **sans** `version` est un fichier
  écrit à la main, lu comme la version courante.
- ⚠️ **`BACKUP_VERSION` a bumpé trois fois, et aucune n'est décorative.** L'ajout des cinq
  colonnes de trace (CC-51) ne l'avait **pas** bumpée, à raison : l'ajout était strictement additif.
  Elle est passée à `2` en CC-119 (`box`/`nextReview`/`reviews` décrivent la progression d'une
  personne, plus celle du paquet), à `3` en CC-139 (le fichier décrit le **visible**, plus tout
  le contenu — et porte un nouveau champ `shared` par carte), puis à `4` en CC-260 (une révision
  porte `kind`, dont l'**absence** doit se trancher plutôt que se deviner). Même critère les trois
  fois : « le jour où un champ change de sens ou devient obligatoire ».
- ⚠️ **L'import accepte 1, 2, 3 ET 4** (`READABLE_BACKUP_VERSIONS`), et c'est une liste, jamais une
  égalité. Refuser une version antérieure rendrait illisibles d'un coup **toutes** les sauvegardes
  faites avant ce lot — au moment précis où on en aurait le plus besoin. Une v1/v2 se relit sans
  ambiguïté : son contenu était visible de tous au moment de l'export, il **redevient partagé** à
  l'import (`resolveShared`, `services/leitner_backup_service.ts`) — exactement ce que le backfill
  de la migration fait pour la base. Un fichier v3 **écrit à la main** sans `shared` obéit au défaut
  du contenu neuf : privé.
- ⚠️ **`resolveReviewKind` est le pendant exact de `resolveShared`, pour `kind`** : un fichier
  v < 4 ne peut porter que des révisions `normal` — vrai **par construction**, pas par commodité
  (l'entretien n'existait pas). Un fichier v4 écrit à la main sans `kind` obéit au défaut de la
  colonne. ⚠️ **Ne « simplifie » pas en `review.kind ?? 'normal'` au site d'écriture** : c'est la
  version du **fichier** qui tranche, comme pour `shared`.
- ⚠️ **`kind` est toujours écrit à l'export ; `boxBefore`/`boxAfter` passent par `omitNull`.** La
  distinction n'est pas cosmétique : leur `null` **est** ce que l'absence veut dire (« boîte
  inconnue »), alors qu'une absence de `kind` se relirait `'normal'` et changerait le sens de la
  ligne. ⚠️ **En revanche, poser `kind` hors du bloc `omitNull` est DOCUMENTAIRE, pas load-bearing —
  mesuré** : `kind` n'étant jamais `null`, l'y ranger laisse la suite entièrement verte. La garde
  réelle est le `snapshot()` du spec, qui rougit dès que la clé disparaît de l'export.
- ⚠️ **Les cartes (et la taxonomie créée en chemin) appartiennent à l'importateur** (CC-139), jamais
  à qui que ce soit d'autre — même règle que `progression et historique` ci-dessous. `resolveShared`
  décide de `isShared` ; `ensureCategory`/`ensureTheme` ne réutilisent qu'une catégorie/thème
  **visible** de l'importateur, jamais un homonyme privé chez un autre compte.
- ⚠️ **Une carte que l'exportateur n'a jamais notée sort avec `box: 1` et l'échéance du jour** — pas
  d'omission : c'est ce que l'absence de ligne veut dire, et l'import écrit symétriquement une ligne
  **seulement** si le fichier dit autre chose que le défaut. Un fichier de saisie en masse ne
  fabrique donc aucune progression.
- **Tout ou rien** : `db.transaction()` + `{ client: trx }` sur chaque écriture. Sans ça, un fichier
  qui casse à la 300ᵉ carte laisserait 299 cartes derrière lui.
- Le retour d'import passe par un **flash** relu dans `index` et renvoyé en props : Inertia ne partage
  automatiquement que `errorsBag`, et `config/inertia.ts` est hors du module.

⚠️ **`box` est validée entre 1 et 5, et c'est le seul rempart** — la colonne n'a **aucune contrainte
en base**. Une carte importée en boîte 12 puis notée `hard` y resterait : `boxIntervals()[12]` vaut
`undefined`, Luxon fait `plus({ days: undefined })` = +0 jour et rend une date **valide**,
`next_review` = aujourd'hui, indéfiniment. Aucune exception, aucun log.

⚠️ **La trace d'une révision est bornée exactement comme le `POST /review` qui l'écrit**
(`backupReviewTraceFields`) : un fichier n'est pas une source plus fiable qu'une requête. Même
doctrine que `verdict`/`latencyMs` — sauf que **`thinkingMs` alimente une règle**, donc un fichier
écrit à la main peut dégrader ses propres suggestions. Borné, ça reste acceptable : **aucune boîte ne
bouge sur ces champs**. Deux détails qui ne se devinent pas : **`interrupted` n'est pas dans le
fichier** (c'est un drapeau de transport, et une révision déjà en base a **déjà** été filtrée par lui
— ne fusionne pas `backupReviewTraceFields()` avec `fluencyMeasureFields()`), et le plafond des
durées est **`MEASURE_MAX_MS` (1 h), pas `MAX_THINKING_MS` (120 s)** : c'est celui auquel la page
écrête avant d'envoyer, donc celui que la colonne peut légitimement porter.

⚠️ **Élargir `backupValidator` touche aussi l'ingestion**, qui s'en sert pour valider la sortie du
LLM. Sans danger — `parseLlmCards` recopie explicitement les **quatre** seuls champs
`front`/`back`/`category`/`theme` avant de valider, donc un modèle ne peut fabriquer ni révision ni
mesure. **C'est cette recopie qui tient la garantie, pas le validateur** : ne la remplace pas par un
passe-plat.

## L'ingestion d'un cours par un LLM local

> Côté usage — quel modèle charger, comment brancher LM Studio / llama.cpp / vLLM / Ollama, et quoi
> faire quand ça casse : voir **[LLM.md](./LLM.md)**, dans ce dossier.

`/revision/ingest` : on colle un cours (ou on charge un `.txt`/`.md`/`.pdf`), un LLM **local** en
extrait les grands principes et rend des **cartes proposées**. Le modèle propose, l'utilisateur
relit, corrige, valide — et c'est seulement là que les cartes entrent en base. Deux tables :
`leitner_ingestions` (le travail) et `leitner_draft_cards` (les cartes proposées — ni boîte, ni
échéance : ce ne sont pas des cartes).

### La frontière de confiance — le point à ne pas régresser

⚠️ **L'URL que l'ingestion utilise vient de l'environnement, jamais d'un formulaire ni de la base.**
Une URL de serveur **persistée** depuis un formulaire serait une **SSRF** : le serveur émettrait, à
chaque ingestion, des requêtes vers l'hôte du choix de celui qui a écrit dans ce champ. C'est le
raisonnement du module `agents` sur `config.command`, appliqué ici. L'onglet « Configuration » teste
des URL candidates **en mémoire**, sans rien persister, et sous liste blanche — exception bornée, pas
une réouverture.

⚠️ **Le texte du cours est du contenu non fiable** : il peut contenir des instructions adressées au
modèle. Acceptable — le dégât maximal est une carte absurde, arrêtée par la relecture — **à
condition** que rien de ce que sort le modèle ne soit exécuté, interprété comme du SQL, ni utilisé
comme identifiant. D'où : la taxonomie proposée est **du texte, un nom**, jamais un id ; et **la boîte
est imposée à 1**, ce que le modèle dirait d'une boîte, d'une échéance ou d'un id étant **jeté avant
validation** (`parseLlmCards`).

### La voie fichier : un chargeur de texte, pas une soumission

⚠️ **Le champ fichier ne soumet plus rien.** Choisir un fichier appelle
`POST /revision/ingest/extract`, qui rend son **texte** et remplit le `<textarea>` ; c'est ce texte,
**relu et corrigé**, que `POST /revision/ingest` reçoit ensuite. Trois conséquences voulues :

- **`store()` ne lit plus aucun fichier** : il ne reçoit que du texte. `LeitnerPdfService` est le seul
  à toucher un fichier, et il n'écrit rien en base.
- **`.txt`/`.md` passent par le même chemin** : un PDF qui se prévisualise pendant qu'un `.md` part à
  l'aveugle serait une incohérence gratuite.
- La route rend du **JSON nu** : `fetch` + `x-xsrf-token` + `accept: application/json`, et elle
  n'écrit rien.

⚠️ **`source` et `sourceName` sont donc DÉCLARATIFS** : c'est le client qui a fait l'extraction, donc
lui qui annonce l'origine. Le dégât est **cosmétique** et acceptable **à trois conditions, qui sont
le prix de la prévisualisation** : bornés en longueur, **jamais interprétés** (`sourceName` n'est pas
un chemin, `source` est une valeur d'une liste fermée), et seulement stockés puis affichés. Ne bâtis
jamais quoi que ce soit dessus.

### Le PDF : ce qu'il rend, et ce qu'il refuse

`unpdf` (build moderne de pdf.js, sans worker à câbler en Node ESM). **Ne le remplace pas par
`pdf-parse`** : il embarque un pdf.js 1.x sans correctifs.

⚠️ **On parse du binaire hostile dans le processus.** pdf.js a connu une exécution de code arbitraire
par une police piégée (CVE-2024-4367) quand `eval` est autorisé. D'où `isEvalSupported: false`, passé
**explicitement** même si `unpdf` le pose par défaut — une garantie ne se lit pas dans un
`node_modules`.

Six refus, **six messages distincts** — les fondre dans un « fichier invalide » générique rendrait
l'écran inutile :

| refus            | déclencheur                                                                |
| ---------------- | -------------------------------------------------------------------------- |
| `not-a-pdf`      | les octets ne commencent pas par `%PDF-` — **l'extension ne prouve rien**   |
| `encrypted`      | pdf.js lève `PasswordException` (reconnue par son `name`, stable)           |
| `corrupt`        | toute autre exception à l'ouverture                                         |
| `no-text`        | ratio caractères / pages sous `MIN_CHARS_PER_PAGE`                          |
| `too-many-pages` | plus de `MAX_PDF_PAGES`, vérifié **avant** d'extraire                       |
| `too-long`       | plus de `MAX_COURSE_CHARS`, dès l'extraction                                |

- ⚠️ **Le scan se détecte par page, jamais sur un total** : un PDF de 200 pages scannées rend quand
  même quelques centaines de caractères (numéros, filigranes), qu'un seuil global laisserait passer.
  **L'OCR est hors périmètre, définitivement** : un PDF sans couche texte est refusé, jamais deviné.
- ⚠️ **Les deux plafonds ne font pas double emploi** : un PDF de 8 Mo peut porter 600 pages, que
  `MAX_COURSE_CHARS` rejetterait mais **après** une extraction longue. Le plafond de **taille de
  fichier** (15 Mo) doit rester **sous** le `limit: '20mb'` de `config/bodyparser.ts` — au-dessus,
  l'erreur viendrait du parseur au lieu du validateur.
- ⚠️ **Le multi-colonnes ne se résout pas, il se voit** : l'extraction entrelace les colonnes et
  produit du charabia. **Limite connue et acceptée** — c'est le rôle de la prévisualisation.
- `cleanExtractedText` est du code pur : ligatures normalisées par **NFKC** (`ﬁ` → `fi`, sinon deux
  rectos pour un même mot et la dédup tombe), césures recollées, blancs réduits **sans écraser les
  sauts de paragraphe** — `chunkCourse` découpe par titres et lignes vides. Un `.txt`/`.md` n'y passe
  **pas** : ses tirets et ses blancs sont voulus.

### Le contrat avec le LLM : le format d'import, tel quel

La sortie attendue est **exactement** le format d'import JSON du module. Ce n'est pas cosmétique :
elle est validée par **`backupValidator`**, et la promotion passe par `LeitnerCatalogService`, qui
sait déjà créer catégorie et thème à la volée (`ensureTheme`) et déduplique sur (recto, thème).
**L'ingestion branche une nouvelle source sur un pipeline qui existe**, elle n'en écrit pas un second.

**Le découpage** (`chunkCourse`) : par titres Markdown, à défaut par paragraphes, en dernier recours à
la hache — puis les petites sections sont regroupées. Chaque morceau reprend la fin du précédent
(`CHUNK_OVERLAP_CHARS`) pour qu'un principe à cheval reste énonçable. La dédup (`draftKey` : casse,
accents, ponctuation finale ignorés) évite qu'un principe énoncé en introduction et rappelé en
conclusion ne donne deux cartes. ⚠️ Elle se fait **morceau par morceau, contre les brouillons déjà
écrits** (`keepNewDrafts`), conséquence directe de l'écriture au fil de l'eau : il n'y a plus de « fin
de course » où fusionner. `mergeDrafts` **n'existe plus** — ne la cherche pas, et ne rétablis pas une
fusion finale, elle réécrirait des brouillons déjà relus.

**Le JSON qui n'en est pas** (`extractJson`/`parseLlmCards`) : un petit modèle rend volontiers du JSON
entouré de prose ou dans un bloc ` ```json ` — c'est le régime normal, le parsing absorbe les trois
formes. Ce qu'il ne peut pas lire, il le fait **réparer une seule fois** : pas de boucle, un modèle
qui n'a pas compris au deuxième tour ne comprendra pas au dixième. `response_format: json_object` est
demandé quand le serveur le connaît, jamais présumé (un 400 fait réessayer sans lui).

### Le cycle de vie d'un travail — asynchrone, dans le processus

`GET /revision/ingest` est le formulaire (toujours vierge) et l'historique. `POST` crée la ligne en
`pending`, **lance le travail en tâche de fond et redirige aussitôt** vers `GET /revision/ingest/:id`.
⚠️ **La réponse du POST n'attend pas le LLM** : un `await` sur la tâche de fond referait du synchrone
avec des étapes en plus. `pending → running → done | failed`, et rien d'autre ; la progression est
**réelle** (`chunks_done`/`chunk_count`, écrits morceau par morceau).

**Aucune infrastructure de job** dans ce projet. D'où trois règles non négociables :

1. **Un redémarrage laisse des `running` orphelins** que personne ne reprendra : sans balayage, leur
   page tournerait indéfiniment sur une barre qui n'avancera plus. `sweepInterruptedIngestions()` les
   passe `failed` au boot, avec un message. **Un statut qui ment en silence est pire qu'un échec.**
2. **Aucune exception n'est avalée** : plus personne n'attend cette promesse, donc une erreur atterrit
   dans la colonne `error` et bascule le statut. Un `catch {}` ici, c'est une page qui tourne dans le
   vide jusqu'à ce qu'on ferme l'onglet.
3. **Les tests attendent la tâche de fond** (`ingestionJobs()`), sans quoi ils courraient contre elle
   et contre le rollback de leur propre transaction. C'est la seule raison d'être de ce registre : le
   code de production n'attend rien.

`MAX_COURSE_CHARS` ne borne donc plus une **attente** mais un **travail** (100 000 caractères, une
quinzaine d'appels) ; `LLM_TIMEOUT_MS` continue de borner chaque appel.

⚠️ **Les brouillons s'écrivent au fil de l'eau — rupture avec l'import**, qui est en tout-ou-rien. Un
échec au 5ᵉ morceau laisse en base ceux des quatre premiers, et le statut `failed` le dit. C'est ce
qui rend la barre honnête et le compteur vivant, et ça ne contredit pas la règle du module parce que
ce sont des **brouillons** : rien n'entre dans `leitner_cards` sans relecture.

### Le titre, la relecture, l'interrogation périodique

Chaque travail porte un **titre** (120 caractères) : fourni à la saisie, sinon **déduit**
(`deduceTitle`, code pur), et renommable ensuite. L'ordre : premier titre Markdown · première ligne
non vide tronquée sans couper un mot · nom du fichier sans extension · « Cours du 14 juillet ».
⚠️ **Jamais « Texte collé »** — un historique où dix travaux portent ce nom ne désigne rien ;
l'origine s'affiche comme une **pastille** à côté du titre, jamais à sa place.

Trois gestes sur un brouillon, qui ne font pas la même chose : **Enregistrer les modifications**
(le brouillon corrigé remplace la proposition, il **reste un brouillon**) · **Valider** (il devient
une carte, par `LeitnerCatalogService` et lui seul) · **Rejeter** (statut `rejected`, il reste en base
comme trace et ne redevient jamais `pending`).

⚠️ **La requête de validation porte le contenu, jamais de simples ids**, et le contrôleur l'enregistre
(`saveDrafts`) **avant** de promouvoir, dans la même requête. C'est la seule chose qui fasse tenir
« valider = valider ce que j'ai sous les yeux » : un `accept` sur des ids seuls relirait la ligne en
base, donc corriger le verso puis cliquer directement « Valider » créerait la carte avec le **texte du
modèle**, jetterait la correction en silence — et le brouillon serait `accepted`, donc plus rien à
rattraper.

La page de suivi s'actualise par `router.reload({ only: ['ingestion', 'drafts'] })` (~1,5 s) : on
reste dans le fonctionnement natif d'Inertia, **sans route JSON nue**, donc sans CSRF ni
sérialisation à gérer à la main. Deux pièges traités dans `ingest_show.vue` : on **n'interroge que si
le statut est `pending` ou `running`**, et l'intervalle est **nettoyé au démontage** — un
`setInterval` qui survit à une navigation Inertia continue d'émettre des requêtes pour une page qui
n'existe plus.

⚠️ **`LlmClient` est injecté** (conteneur AdonisJS), jamais instancié en dur : c'est ce qui permet à
la suite de tourner contre un faux client, sans réseau. **Aucun test n'appelle un vrai LLM.**

## L'onglet « Configuration » (`/revision/llm`)

Un écran qui rend le branchement évident : détection du serveur, liste des modèles, **vraie
génération de test**, et le bloc à coller dans `.env`. Quatre étapes (serveur → modèle → JSON → bloc),
chacune verte, rouge (avec le message d'erreur **brut**) ou grise ; une étape verte débloque la
suivante.

L'étape 3 porte l'écran : elle envoie **le prompt de l'ingestion** (`courseMessages`) sur un extrait
en dur et repasse par **`parseLlmCards`** — le même parsing. C'est la seule chose qui réponde à « ce
modèle-là est-il utilisable pour fabriquer des cartes ? » : un petit modèle qui rend de la prose se
voit **ici, et nulle part ailleurs**. Un test qui enverrait un autre prompt ne prouverait rien.

**La configuration ne vit pas en base**, mais dans l'environnement et **nulle part ailleurs** : c'est
ce qui préserve la frontière de confiance — la valeur qu'utilise réellement le serveur ne peut être
changée par **aucune requête HTTP**. D'où : **l'assistant ne persiste rien**, il produit le bloc à
copier (`.env` et sa variante `docker-compose`). Pas d'écriture automatique du fichier : AdonisJS lit
l'environnement **au démarrage** (un redémarrage est de toute façon nécessaire), sous Docker le
fichier du conteneur n'est pas la source de vérité, et écrire un fichier depuis une requête web serait
une surface offerte pour un copier-coller économisé.

### La liste blanche — l'exigence n° 1

Ces routes font émettre au serveur des requêtes vers une URL **saisie par l'utilisateur** :
inévitable, puisqu'il faut tester la valeur *avant* de la coller dans `.env`. `isLocalLlmUrl`
s'applique à **toutes** les routes de diagnostic :

- schéma `http`/`https` uniquement ;
- hôte **loopback** (`127.0.0.0/8`, `::1`, `localhost`) ou **plage privée** (`10/8`, `172.16/12`,
  `192.168/16`) ;
- tout le reste refusé — `169.254.169.254` comme **tout nom de domaine**, fût-il résolu vers une IP
  privée : seule une IP littérale (ou `localhost`) passe. La comparaison porte sur l'hôte **normalisé
  par le parseur** (`0x7f000001` et `2130706433` sont `127.0.0.1`).

Un LLM « local » vit par définition dans ces plages : la contrainte ne coûte rien à l'usage.

⚠️ **La liste blanche n'est pas suffisante à elle seule, et la croire suffisante était un vrai défaut**
(CC-37). Elle valide l'URL **saisie**, et rien d'autre : la cible d'un `Location` ne repasse par aucun
validateur. Un hôte loopback ou privé qui répond `302 Location: http://169.254.169.254/…` faisait
sortir la requête du périmètre, et `listModels`/`test` rendaient le contenu au client. Le défaut
d'undici est `redirect: 'follow'`, jusqu'à 20 sauts : ce choix se pose, il ne s'hérite pas. Les deux
`fetch` de `llm_client.ts` passent donc **`redirect: 'manual'`**, et `refuseRedirect()` fait de toute
`3xx` une `LlmUnavailableError`. **La garantie, ce sont les deux ensemble** — n'en présente jamais une
seule comme le rempart.

⚠️ **`refuseRedirect()` est appelé HORS du `try/catch` des deux méthodes** : dedans, il serait avalé
puis ré-écrit en « injoignable ou n'a pas répondu en moins de N s », le contraire de ce qui vient de
se produire. C'est aussi la raison de `'manual'` plutôt que du `redirect: 'error'` qu'on croirait plus
simple : `'error'` fait lever undici *dans* le `try`.

Trois corollaires, aussi importants que la liste :

- **La liste des candidats sondés est en dur** (`LLM_CANDIDATES` : LM Studio `1234`, llama.cpp `8080`,
  Ollama `11434`). Une liste de ports fournie par le client ferait de la « détection » un scanner de
  ports téléguidé.
- **Aucune de ces routes n'écrit quoi que ce soit**, ni en base ni sur le disque.
- **`LLM_API_KEY` ne repart jamais vers le client** : l'écran affiche qu'elle est définie
  (`hasApiKey`), jamais sa valeur.

**Deux détails qui mordent** : `PROBE_TIMEOUT_MS` (2 s) n'est pas `LLM_TIMEOUT_MS` (120 s) — sonder
trois candidats éteints avec le délai de génération figerait « Détecter » pendant six minutes. Et les
trois routes rendent du JSON nu, donc `x-xsrf-token` (sans lui tout POST part en 403) **et**
`accept: application/json`, sans quoi un refus de la liste blanche se change en redirection avec
erreurs flashées au lieu d'un 422.

## Pièges techniques

- **`next_review` est une colonne `date`, `reviewed_at` un `timestamp`** : `today.toSQLDate()` pour
  les cartes dues, `startOfDay.toSQL()` pour les révisions. Les intervertir passe le typecheck et
  casse le filtre en silence. `hasReviewedTodayInScope` est le point où les deux se croisent.
- **Le filtre par catégorie passe par une sous-requête** sur `leitner_themes` (une carte ne connaît
  que son thème). Elle s'écrit **une seule fois**, dans `services/leitner_scope.ts` : le paquet d'une
  session et le filtre du catalogue posent la même question, et `cards()` comme `dueCards()` passent
  par `applyScope`. N'en fais pas une troisième copie.
- Les stats (`reviewedToday`, `streakDays`) et le catalogue chargent les lignes et comptent en JS,
  sans pagination. Volumétrie personnelle : assumé.

## Tests

Le détail par fichier est dans [TESTS.md](./TESTS.md) — à lire avant de **modifier un test**, pas
avant de modifier le module. ⚠️ **Un fichier de test du module absent de cet index fait rougir
`tests/unit/tests_index.spec.ts`** (CC-112), qui le nomme : l'oubli ne passe plus en silence. Le
fichier reste écrit **à la main** — rien ne le génère, et la garde asserte la **mention**, jamais
l'exactitude : une phrase devenue fausse y passe au vert. Ce qui doit rester présent en
permanence :

- **Aucun test n'appelle un vrai LLM** : `tests/fakes/fake_llm_client.ts` couvre aussi le
  **diagnostic** (`ping`, `listModels`), sans quoi les tests de `/revision/llm` iraient sonder de
  vrais ports de la machine. Exception délibérée : `leitner_llm_redirect.spec.ts`, seul test du dépôt
  à faire émettre une requête au vrai client.
- **La configuration LLM du poste n'entre pas dans la suite** (CC-101) : sous `NODE_ENV=test`,
  `llmConfigFrom` ignore l'environnement et `config/llm.ts` retombe sur ses défauts documentés —
  ni la clé, ni le modèle, ni l'hôte du `.env`. Deux machines exécutent donc les mêmes tests.
  - ⚠️ **Ce n'est PAS un `enabled: false`**, contrairement à Immich et YouTube : le LLM n'a pas
    d'interrupteur, il a une URL par défaut. Un test qui oublierait de swapper `LlmClient`
    atteindrait toujours un LM Studio réellement lancé sur `127.0.0.1:1234`. Le rayon est borné —
    `isLocalLlmUrl` n'accepte que le local, rien ne sort de la machine — mais le test serait lent
    ou non déterministe sans que rien ne le dise. **La garde ne dispense pas du `swap`.**
  - ⚠️ **N'ajoute pas un `enabled` à `LlmConfig` « pour aligner sur la veille »** : ce serait
    inventer un réglage de production pour un besoin de test. Écarté explicitement en CC-101.
- ⚠️ **`leitner_backup.spec.ts` tient entièrement dans son `snapshot()`** : une colonne que cette
  fonction ne lit pas peut être perdue par l'export sans qu'un test ne rougisse — c'est ce qui a
  laissé passer CC-51. **Une colonne ajoutée à `leitner_cards` ou `leitner_reviews` s'ajoute à
  `snapshot()` dans le même lot, ou elle n'est pas sauvegardée.**
- ⚠️ **`tests/fixtures/*.pdf` sont des binaires versionnés** : ne les fabrique pas à la volée, et **ne
  les télécharge jamais** — aucun test de ce dépôt ne touche le réseau.
- ⚠️ **`taxonomy_combobox.spec.ts` ne prouve quelque chose que parce qu'il tape d'abord** : `filtering`
  vaut déjà `false` au montage. C'est le piège de tout test de composant — voir le `CLAUDE.md` racine.

## Limites connues — ne les fais pas passer pour couvertes

- **La bande 20–120 s de la fluence** n'est couverte par rien : `visibilitychange` ne se déclenche ni
  au changement d'application, ni quand on se détourne de l'écran. C'est la distraction la plus
  courante, et la seule qui produise un `hard` *plausible*.
- **`pages/index.vue` n'a pas de test de composant**, et c'est de loin la page la plus stateful du
  module : la remise à zéro sur la référence de `dueCards`, le surlignage de la présélection, le
  verrouillage du champ, le badge de repli et le chronométrage se vérifient au navigateur — noter
  « À revoir » sur la **dernière** carte due, et voir l'écran repartir vierge.
- **Le CSS de la modale** ne se prouve qu'à `npm run build` + navigateur (jsdom ne fait aucun layout).
- **La qualité d'une extraction PDF** (deux colonnes, en particulier) et **la qualité des verdicts du
  juge** sur de vraies cartes demandent un vrai passage navigateur avec de vrais fichiers et LM Studio
  allumé. La suite vérifie qu'il y a du texte, pas qu'il veut dire quelque chose.
- **Le piège Inertia de l'export** ne se voit qu'au clic dans un navigateur : au `curl` comme en test
  fonctionnel, la réponse paraît parfaite dans les deux cas.
