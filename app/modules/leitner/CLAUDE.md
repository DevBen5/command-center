# Module Leitner — répétition espacée

Route `/revision` (⚠️ **pas** `/leitner`) · pages Inertia `modules/leitner/{index, settings, stats,
ingest, ingest_show, llm}` · tables `leitner_cards`, `leitner_card_progress`, `leitner_reviews`,
`leitner_categories`, `leitner_themes`, `leitner_settings`, `leitner_ingestions`,
`leitner_draft_cards`, `leitner_courses`, `leitner_course_sections`, `leitner_card_sections`.

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
services/leitner_maintenance.ts             l'ÉCHELLE D'ENTRETIEN (CC-261) : à quel rythme revient
                                            une carte acquise — CODE PUR, le réglage en paramètre
services/leitner_grade_outcomes.ts          CE QUE CHAQUE NOTE FERA (CC-262) : boîte, acquis,
                                            jours — CODE PUR, et l'UNIQUE copie de `nextBox`
services/leitner_mastery_service.ts         sa partie base : inventaire, compteurs, rangs
                                            d'entretien en UNE requête, cartes perdues
services/leitner_stats_service.ts           les stats d'HABITUDE, d'EFFORT et les POINTS FAIBLES —
                                            globales, jamais par paquet
services/leitner_catalog_service.ts         seul point d'écriture d'une carte, porte la dédup
services/leitner_backup_service.ts          export/import JSON — le filet de sécurité du module
services/leitner_ingestion_service.ts       découpage, appels LLM, TÂCHE DE FOND, brouillons au fil
                                            de l'eau + `sweepInterruptedIngestions`
services/leitner_pdf_service.ts             fichier → texte : octets magiques, unpdf, nettoyage, et
                                            les six refus
services/leitner_card_sections_service.ts   la PROVENANCE (CC-253) : `linkIngestionSections`
                                            (promotion), `setManualSection` (sélecteur), et
                                            `provenanceSectionsFor` — filtrée sur la visibilité
                                            du COURS du lien, jamais de la carte
services/leitner_glossary_service.ts        l'INDEX de glossaire (CC-254) : `glossaryIndex` —
                                            filtré par visibilité, sections tombées exclues
services/leitner_front_html.ts              le recto rendu ET souligné (CC-276) : reparcourt le
                                            HTML assaini de `renderMarkdown(front)`, tokenise ses
                                            nœuds de texte — PUR, jamais un second rendu Markdown
services/llm_client.ts                      /v1/chat/completions + sonde /v1/models — INJECTÉ
models/leitner_card_progress.ts             (personne, carte) → boîte + échéance. ABSENCE =
                                            boîte 1, due aujourd'hui — jamais un trou
models/leitner_settings.ts                  UNE seule ligne (id = 1) — réglage d'INSTALLATION
models/leitner_draft_card.ts                une carte PROPOSÉE, rattachée à son ingestion —
                                            porte `sectionSlugs` (CC-253), calculés par
                                            `chunkCourse`, jamais retrouvés après coup
models/leitner_card_section.ts              le lien carte ↔ section (CC-253) — ni owner_id ni
                                            is_shared, se dérive des deux tables qu'il relie
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
components/MasteredInventory.vue            l'INVENTAIRE D'ACQUIS (CC-262) — il ne décide que du
                                            repli ; le regroupement vit dans `shared/`
shared/card_preview.ts                      PUR · PREVIEW_MAX_CHARS (UNIQUE déclaration, lue aussi
                                            par le validateur) + previewTooLong
shared/review_page.ts                       PUR · MEASURE_MAX_MS (UNIQUE déclaration) + duration
                                            / fluencyMeasure + boxIntervalLabel / dueInLabel
                                            + gradeHint (la CLÉ d'un bouton, jamais son texte)
shared/mastery_inventory.ts                 PUR · le regroupement par mois, « ce mois-ci », la
                                            part du catalogue, l'entretien dû (CC-262)
shared/draft_review.ts                      PUR · la relecture des brouillons d'ingest_show.vue
shared/settings_page.ts                     PUR · scrollTopKeepingAnchor — le recalage du
                                            défilement après un import (CC-67)
shared/glossary_highlight.ts                PUR · `tokenizeFront` (CC-254) — plus long d'abord,
                                            jamais à l'intérieur d'un mot, AUCUN `v-html` ; porte
                                            aussi le type `FrontNode` (CC-276), le seul appelant
                                            de `tokenizeFront` est désormais le SERVEUR
migrations/                                 cards PUIS reviews PUIS categories/themes PUIS settings
                                            PUIS ingestions PUIS draft_cards PUIS card_progress
                                            PUIS owner_id/is_shared (CC-139, categories → themes →
                                            cards → ingestions ; PAS draft_cards)
                                            PUIS les marques de maîtrise (CC-260, UNE migration
                                            pour les 5 colonnes des DEUX tables)
                                            PUIS courses/course_sections (CC-251) PUIS
                                            section_slugs sur draft_cards PUIS card_sections
                                            (CC-253, après course_sections ET cards)
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
= la **session**. Une seule page Inertia, un prop `view` qui tranche. ⚠️ **Depuis CC-262 un
cinquième paramètre ouvre aussi une session : `?queue=maintenance`** — la file d'entretien. Il est
**orthogonal** au paquet (les deux se composent) et compte dans « un paquet a-t-il été demandé ? » ;
l'oublier là rendrait l'écran de choix sans lever la moindre erreur. Voir la section CC-262.

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
et les marques, et **ne changeait aucun comportement visible** : `mastered_at` se remplissait et
personne ne le lisait. ⚠️ **Ce n'est plus vrai depuis CC-261** (section précédente), qui en est le
premier consommateur : `mastered_at` gouverne désormais la sortie de file et le rythme d'entretien.
CC-262 (l'inventaire visible) reste à venir. Ce qui suit décrit **comment les marques se posent** —
la mécanique qui les lit est au-dessus.

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
  zéro ligne). ⚠️ **L'empreinte CC-119 n'est PAS l'outil ici** — elle demande « le contenu réel
  a-t-il survécu ? », alors que la question est « l'arithmétique est-elle juste ? ». La seconde se
  prouve sur des lignes **fabriquées** avec des `updated_at` distincts, et elle a été prouvée ainsi
  le 2026-08-13, mutation comprise — procédure rejouable dans `TESTS.md`.

⚠️ **`rawQuery`, jamais `.update({ col: db.raw('autre_col') })` dans un backfill.** Le `RawBuilder`
de Lucid n'est pas une expression pour knex : il part en **binding**, sérialisé en
`{"sql":"updated_at"}`, et Postgres refuse. Mesuré sur ce lot. Une colonne référencée est du SQL,
pas une valeur.

## La sortie de file et le régime d'entretien (CC-261)

Deuxième des trois lots de l'inventaire d'acquis, et **le premier consommateur de `mastered_at`**.
Il ne touchait aucun écran : à la fin de ce lot la mécanique était juste et **invisible**.
⚠️ **Ce n'est plus vrai depuis CC-262** (section suivante), qui la montre et lui donne enfin un
chemin — la phrase « une carte maîtrisée n'est atteignable par aucun écran », qui était le
corollaire assumé de ce lot, est **périmée** : l'entretien a désormais sa file
(`/revision?queue=maintenance`), la grille a sa 6ᵉ case, et l'inventaire est listé. Ce qui suit
décrit la **mécanique** ; ce qui l'affiche est plus bas.

**Le défaut réel** : une carte qu'on connaît revenait **indéfiniment tous les `box5Days`** (30 j
par défaut), mélangée aux cartes qu'on est en train d'apprendre. Rien ne distinguait les deux, donc
on ne « rangeait » jamais rien et la file ne rétrécissait jamais.

**1. La carte maîtrisée quitte la file normale**, et l'exclusion vit dans **`whereDue` lui-même**
(`services/leitner_progress.ts`). ⚠️ **C'est la seule forme qui tienne, et ce n'est pas une
commodité.** Quatre lectures posent la question « qu'est-ce qui est dû ? », dont **deux hors du
module** — la file, la pastille de la barre latérale, la carte d'accueil, les comptes de l'écran de
choix — et toutes appellent exactement la même paire `joinProgress` + `whereDue`. Un seul point de
modification, les quatre suivent **par construction** : aucun appelant ne peut oublier parce
qu'aucun n'a le choix. Une carte qui disparaîtrait d'un compteur sans disparaître d'un autre ne
lève **aucune erreur** — et la réponse à ce risque n'est pas « penser à mettre à jour les quatre ».
C'est aussi ce qui protège le compteur qu'on ajoutera dans six mois. `whereMaintenanceDue` est son
pendant ; les deux files sont **disjointes** par construction (`mastered_at is null` contre `is not
null`), donc rien à synchroniser entre elles.

**2. L'échelle d'entretien, croissante et plafonnée** — `services/leitner_maintenance.ts`, **pur**
comme `leitner_mastery.ts` :

```
palier(n) = max(box5Days, [90, 180, 365][min(n, 2)])   jours
n = paliers déjà consommés depuis mastered_at
```

- ⚠️ **Le `max(box5Days, …)` n'est pas cosmétique** : à `box5Days = 365` (borne haute autorisée),
  un palier fixe à 90 ferait revenir une carte **maîtrisée** quatre fois plus souvent qu'une carte
  en cours. Absurde, et invisible tant que personne ne pousse le réglage. Un `box5Days × 12` a été
  écarté pour la raison symétrique : au même réglage, il donne **douze ans**.
- **Plafonnée à 365**, donc au moins une vérification par an : c'est ce qui empêche « maîtrisée »
  de devenir une affirmation que plus rien ne contrôle. Le dernier palier se **répète**.
- ⚠️ **Le rang ne demande AUCUNE colonne** : c'est un `count(*)` sur `leitner_reviews`, une requête
  au moment de noter, sur une seule carte. Le résultat part dans `next_review` comme avant — **la
  forme de la file ne change pas**.

⚠️ **L'échéance suit la file où la carte VA, jamais celle d'où elle vient — c'est le pendant
inverse de `kind`, et la seule subtilité du lot.** La note qui **acquiert** la maîtrise porte
`kind: 'normal'` (elle venait bien de la file normale) et repart pourtant au **premier palier**,
90 j. Gater sur `kind` lui donnerait l'intervalle de la boîte 5 : la carte serait « maîtrisée » et
reviendrait une dernière fois au rythme d'avant, dans une file que rien n'affiche encore — la
moitié du lot perdue sur le premier cycle, sans rien de rouge. Arbitrage du propriétaire.

⚠️ **Le rang se compte AVANT l'insertion de la note courante** — même endroit et même raison que
`lastGrade` et `usableThinkingMs` : posé après, il se compterait lui-même et toute l'échelle
glisserait d'un cran.

⚠️ **Et il se compte en `>=`, pas en `>` comme on l'écrirait spontanément.** La note d'acquisition
doit occuper le palier 0 : c'est elle qui a programmé les 90 premiers jours. Or `mastered_at` et
son `reviewed_at` sont **deux appels distincts** à `DateTime.now()` dans `review()` — le second est
postérieur de quelques microsecondes, et un `>` la compterait bel et bien… *tant que cet écart
existe*. Unifier les deux `now()` est un nettoyage parfaitement plausible, et il ferait basculer
toute l'échelle d'un cran (90 j servi deux fois) **sans qu'un seul test ne bouge**. Le `>=` rend le
résultat identique dans les deux mondes. La borne sur `mastered_at`, elle, est ce qui fait repartir
au premier palier une carte **ré-acquise** après un oubli : `mastered_at` est réécrit à chaque
acquisition, donc les entretiens du cycle précédent tombent hors de la fenêtre.

**3. La dé-maîtrise — et ce n'est PAS une rétrogradation.** Un `again` sur une révision d'entretien
**efface `mastered_at`** et remet la carte dans la file normale ; **la boîte reste à 5**.
⚠️ **La règle « `again` ne rétrograde JAMAIS » est intacte** — elle porte sur `box`, et `box` ne
bouge pas. Ce lot ne rouvre donc pas une décision explicite du module en douce ; il ajoute un
drapeau dont la sémantique est précisément d'être vérifiable, sans quoi « maîtrisée » serait un
cul-de-sac que plus rien ne contrôle. ⚠️ **Le croisement avec la règle du 2ᵉ `hard` d'affilée**
(seul chemin de rétrogradation du module) est le seul endroit où les deux mécaniques se touchent :
il efface `mastered_at` **aussi**, sinon une carte en **boîte 1** resterait « maîtrisée » — exclue
de la file normale par `whereDue` et présente dans l'entretien, donc perdue des deux côtés.

**Les autres compteurs — décidés, à ne pas re-débattre :**

| compteur | décision | pourquoi |
| --- | --- | --- |
| `boxCounts` | **les maîtrisées sortent de la boîte 5** | sinon la tuile compte des cartes qu'aucun clic n'atteint. ⚠️ **Seul compteur du module qui ne passe pas par `whereDue`** (il compte ce qui est dans chaque boîte, dû ou non), donc le seul à porter son exclusion propre — `whereNotMastered`, qui garde la condition dans `leitner_progress.ts` plutôt qu'une seconde formulation chez l'appelant |
| `totalCards` | **inchangé** | inventaire de **catalogue** (visibilité, pas `user_id`), déjà volontairement non personnel — le toucher casserait un invariant existant |
| **Le catalogue** (`/revision/settings`, filtre « boîte 5 ») | **inchangé — DÉCIDÉ, pas oublié** | ⚠️ **Il en découle que les deux écrans ne disent pas la même chose, et c'est voulu** : la tuile de `/revision` annonce 0 pendant que `?box=5` liste la carte. Le catalogue est un inventaire de **contenu** — la carte *est* factuellement en boîte 5 —, même raison que `totalCards` juste au-dessus ; et c'est l'écran qui sert à **corriger** une carte, donc l'y faire disparaître serait la rendre inatteignable. Ne « réconcilie » pas les deux côtés sans rouvrir cet arbitrage |
| Rétention, `mostAgainCards`, `stuckCards` | **inchangés** | ils lisent `leitner_reviews` ; les entretiens y entrent et **comptent comme des réussites**, assumé |
| **Pastille latérale** | **file normale seulement** | un entretien dû une fois par an ne doit pas produire la même pression qu'une carte due aujourd'hui. ⚠️ **Ce que ça coûte** : l'entretien pouvait être ignoré indéfiniment — c'est la dette que CC-262 a payée en rendant sa section **visible** sur `/revision`, et c'est pour ça que cet écran est le **seul** qui la signale |

⚠️ **Aucune migration dans ce lot** : les cinq colonnes de CC-260 suffisent, et aucune ligne
existante ne portait `mastered_at`. ⚠️ **Si un jour on veut rendre le choix de la pastille réglable
par compte, ce sera un autre ticket** : `leitner_settings` est un réglage d'**installation** (une
ligne, `check(id = 1)`), il n'existe **aucun** mécanisme de préférence par compte dans le module.
N'en improvise pas un.

## L'inventaire d'acquis, enfin visible (CC-262)

Troisième et dernier lot de la série, et celui qui répond à l'objectif produit : le module ne
montrait que **ce qu'il reste à faire**. Après CC-260 et CC-261 la donnée existait, la mécanique
était juste — et rien ne l'affichait. Ce lot **n'ajoute aucune règle** : ni migration, ni critère,
ni échelle, ni exclusion de file. Il ajoute des lectures et des écrans.

**1. La file d'entretien a un chemin : `/revision?queue=maintenance`.** Aucune route neuve, aucune
capacité neuve — même contrôleur, même `leitner.view`/`leitner.review`.

- ⚠️ **`queue` n'est PAS une quatrième valeur de `scope`, et il ne faut pas l'y fondre.** Un paquet
  dit *quelles cartes* (toutes, une catégorie, un thème), la file dit *lesquelles sont dues* ; les
  deux se composent (`?queue=maintenance&theme=3` = l'entretien d'un thème). Rangé dans `scope`, il
  aurait hérité du refus « catégorie ET thème » et serait devenu exclusif de tout paquet. Il n'y a
  **pas** de valeur `normal` à écrire : l'absence est le défaut, et une seconde façon d'écrire le
  défaut finirait dans les signets.
- ⚠️ **Il compte dans `asked`, et l'oublier ne lève RIEN** : `/revision?queue=maintenance` rendrait
  l'écran de **choix** — pas d'erreur, pas de log, juste un bouton d'entretien qui « ne fait rien ».
  Mode d'échec silencieux n° 1 du lot, mutation vérifiée : la spec fonctionnelle rougit.
- ⚠️ **Le `withQs()` de `review()` porte la file comme il porte le paquet** (piège n° 1 du module).
  Sans lui, une session d'entretien retomberait sur la file normale **dès la première note**, en
  affichant des cartes parfaitement plausibles.
- Une file d'entretien vide dit « rien à vérifier », **jamais** « bravo, terminé » : on n'y a pas
  mal choisi son paquet, on n'a simplement rien à faire.

**2. Les boutons de note annoncent ce que la note fera VRAIMENT** — `services/leitner_grade_outcomes.ts`,
**pur**. ⚠️ **C'est un cinquième livrable, assumé, et il corrige un mensonge introduit par CC-261 :**
l'écran calculait ses libellés lui-même (`Math.min(5, box + 2)` et l'intervalle de la boîte atteinte,
recopiés dans le `<script setup>`), donc une carte que la note allait **acquérir** annonçait
« boîte 5 · dans 30 j » alors qu'elle repart pour 90. Aucun test ne pouvait le voir — jsdom ne lit
pas les libellés, et le chiffre restait plausible.

- ⚠️ **`nextBox` a été DÉPLACÉE** depuis `LeitnerService` (à l'identique, elle y était déjà pure et
  privée) : ce n'est pas une troisième copie du plafond, c'est la suppression de la deuxième. La
  règle qui décide et l'affichage qui l'annonce lisent la même fonction.
- ⚠️ **Le fichier n'ajoute AUCUNE décision** : il applique `nextBox`, `nextMasteryState` et
  `maintenanceIntervalDays` dans le **même ordre** que `review()`. Pour changer un comportement,
  c'est là-bas, jamais ici.
- ⚠️ **Le rang d'entretien annoncé et celui qui s'écrira doivent être le MÊME nombre** —
  `LeitnerMasteryService.maintenanceRanks` (lecture, toute la file en une requête) est le pendant de
  `LeitnerService.maintenanceRank` (écriture, une carte) : même borne `reviewed_at >= mastered_at`,
  même `>=`. Une divergence donnerait un écran qui promet 90 jours pendant que la base en programme
  180, et rien ne le signalerait avant l'échéance suivante, des mois plus tard. La spec fonctionnelle
  compare les deux — c'est le seul endroit où ils se croisent.
- ⚠️ **`dueLabel(intervalles, boîte)` a été RETIRÉE**, remplacée par `dueInLabel(jours)` : depuis
  l'échelle d'entretien, une échéance ne se déduit **plus** d'une boîte. Une fonction qui prend une
  boîte ne *peut pas* dire « dans 180 j, toujours boîte 5 ».
- Le choix de la **phrase** vit dans `shared/review_page.ts` (`gradeHint`), pur : il rend une **clé
  i18n**, jamais un texte. Deux phrases neuves seulement — « maîtrisée · entretien … » et « sort des
  acquis … » —, le reste est mot pour mot ce qui s'affichait avant.

⚠️ **La phrase « quatre boutons » de cette section n'est plus vraie en entretien depuis CC-265** —
voir la section suivante. Elle reste exacte pour la file normale, qui est le seul monde où quatre
notes produisent quatre effets.

### En entretien, deux réponses — pas quatre (CC-265)

Trouvé au **passage navigateur de CC-262**, et mesurable dans le code : sur une carte acquise (donc
en boîte 5), `hard`, `good` et `easy` rendaient un `GradeOutcome` **identique**. Deux raisons se
combinent, et aucune n'est un bug — le plafond de boîte écrase la différence
(`min(5, 5+1) = min(5, 5+2) = 5`) et l'échéance ne vient plus de la boîte mais de
`maintenanceIntervalDays(rang, box5Days)`, qui **ne lit pas la note**. L'écran proposait trois choix
pour un seul effet.

⚠️ **`hard` ne partait pas par symétrie, il partait parce qu'il MENTAIT.** `nextBox` rend
`lastGrade === 'hard' ? 1 : box` : un « Difficile » **qui suit un « Difficile »** renvoie en boîte 1
et fait donc **perdre l'acquis**. Le bouton était inoffensif *sauf* dans ce cas — un effet qui
dépend d'un état que l'écran ne montre pas, sur une file dont les visites sont espacées de 90 à
365 jours. Un bouton pareil est pire qu'un bouton redondant. **C'est le motif du lot**, pas la
redondance.

L'entretien est une **vérification**, pas un apprentissage : il n'y a aucune boîte à gagner, donc
rien que la granularité en quatre puisse exprimer. Deux réponses — « Je l'ai perdu » (`again`) et
« Je le sais encore » (`good`).

- ⚠️ **La liste vit dans `gradeOutcomes` (`MAINTENANCE_GRADES`), jamais dans un filtrage côté
  page.** Deux boutons veulent **deux sorties calculées par la règle** ; écrémer les quatre dans le
  `<script setup>` rejouerait exactement la copie que CC-262 a supprimée, un cran plus loin.
- ⚠️ **La file se DÉDUIT de `mastery.masteredAt`, aucun paramètre `queue` n'a été ajouté.** Les deux
  files sont disjointes par construction (`mastered_at is null` contre `is not null`, CC-261) :
  « la carte est acquise » **est** « on est en entretien ». Un second témoin de la même chose peut
  contredire le premier — l'écran proposerait deux réponses sur une carte que la règle traite comme
  quatre, sans que rien ne le signale.
- ⚠️ **`good`, et non `easy` — décision du propriétaire (2026-08-16).** Les deux rendent la même
  sortie ici ; ce qui tranche est `leitner_reviews.grade`. `good` est ce qu'un clic « Correct »
  enregistrait déjà en entretien, quand `easy` affirmerait « rappel immédiat » là où le bouton ne
  dit que « je le sais ». Rien ne distingue les deux en aval (rétention, points faibles, critère de
  maîtrise) : le gain serait nul et la sur-affirmation réelle.
- ⚠️ **Conséquence ACTÉE : l'entretien n'écrit plus jamais `hard`, donc il n'ARME plus la règle du
  2ᵉ `hard` d'affilée** pour la révision suivante de la carte. Il ne pouvait déjà que l'armer — une
  carte acquise l'a forcément été par un `good` ou un `easy` (`isMasteringGrade`). Son signal
  d'échec est `again`, qui sort la carte des acquis et la renvoie dans la file normale, où les
  quatre notes **et** la règle sont intactes.
- ⚠️ **La RÈGLE n'a pas bougé, et `POST /revision/:id/review` accepte toujours les quatre notes.**
  Ce lot ferme un piège d'**écran** ; masquer un bouton n'est pas un droit, l'exception reste
  atteignable au `curl` — par un geste délibéré, ce qui n'est pas le mal décrit. Retirer `hard` du
  validateur serait un changement de comportement que l'écran ne peut plus produire. **Ne
  « termine » pas le lot en le faisant.**
- ⚠️ **Le mode d'échec silencieux du lot n'était pas dans le ticket : le bouton fantôme du juge.**
  Le juge propose `hard` sur un verdict `partiel` (`leitner_judge_service.ts`) et la fluence propose
  `hard` sur une réponse lente (`leitner_fluency.ts`) — deux notes sans bouton en entretien. Le
  `suggestedGrade ?? 'easy'` de la page surlignait alors **du vide**, sans erreur ni log. La
  résolution vit dans `shared/review_page.ts` (`highlightedGrade`, pur) : la suggestion si elle est
  offerte, sinon la note **la plus généreuse** qui l'est. En file normale, comportement strictement
  inchangé — la suggestion est toujours présente et le repli reste `easy`.
- ⚠️ **Le LIBELLÉ se décide sur `mastered` AVANT la note** (`gradeLabelKey`, même fichier) : celui
  d'`outcome` est celui d'après, et un `again` d'entretien le rend `false` — lu là, « Je l'ai
  perdu » se rebaptiserait « À revoir » exactement sur la carte où la distinction compte. Ces clés
  sont **calculées**, donc invisibles de `keys.spec.ts` : c'est le test « toutes les clés rendues
  existent dans fr.json » (`tests/unit/leitner_mastery_inventory.spec.ts`) qui les tient, et il faut
  l'**étendre** plutôt qu'écrire une seconde garde.
- ⚠️ **Limite notée, pas gardée** : une carte acquise **hors boîte 5** — atteignable seulement par
  un fichier d'import écrit à la main — verrait « Je le sais encore » au-dessus du hint « sort des
  acquis ». Le hint reste vrai ; seul le libellé est optimiste, et l'état est inatteignable par
  l'UI.

**3. L'inventaire lui-même, sur l'écran de CHOIX seulement** (`components/MasteredInventory.vue`).
Replié par défaut, groupé par mois d'acquisition, **sans pagination** (volumétrie personnelle, comme
le catalogue et la heatmap). ⚠️ **Il n'est pas servi pendant une session** : `/revision` ne fait que
réviser, et une liste de cartes connues à côté de la carte en cours serait du bruit sur le seul
écran qui demande de la concentration.

- **Ce qui rend l'inventaire *valorisant* tient en deux chiffres, et le second est le plus
  important** : « dont N ce mois-ci » (sinon c'est un compteur, pas un inventaire) et « N cartes
  perdues cette année », **sans lequel le premier serait auto-congratulant**. Les pertes viennent de
  l'historique (`kind`, CC-260), pas de l'état courant : une carte perdue puis ré-acquise reste une
  carte perdue cette année.
- ⚠️ **« Perdue » compte des CARTES, pas des accidents** (`count(distinct …)`), et couvre les **deux**
  chemins de perte : l'`again` d'entretien *et* le 2ᵉ `hard` d'affilée, qui se reconnaît à
  `box_after < box_before`.
- ⚠️ **« Ce mois-ci » est le mois CIVIL, pas trente jours glissants.** Un compteur glissant
  reculerait tout seul demain matin, sans qu'aucune carte n'ait bougé. Un inventaire ne recule pas.
- ⚠️ **Le panneau d'entretien reste affiché à ZÉRO**, avec la prochaine échéance : disparaître
  ferait croire que le mécanisme n'existe pas — exactement le reproche que CC-261 se faisait.
- ⚠️ **Tous les compteurs de l'écran de choix se DÉRIVENT de la même liste**, jamais d'une seconde
  requête : « dont N ce mois-ci », « N à vérifier », « la prochaine le … ». Deux lectures finiraient
  par diverger, et l'écran annoncerait « 3 à vérifier » avant d'en présenter 2.

**4. La grille des boîtes gagne sa 6ᵉ case**, « Maîtrisées ». Les acquis ont quitté la boîte 5 des
compteurs au lot précédent (`whereNotMastered`) : sans cette case, une carte maîtrisée disparaissait
de l'écran sans la moindre explication — la grille annonçait simplement un nombre plus petit. Les
deux compteurs sont **disjoints par construction**, aucune carte ne peut être comptée deux fois. La
case **suit le paquet**, comme les cinq autres.

**5. Le catalogue en deux sections** (`/revision/settings`), et **6. la tuile d'acquis** de
`/revision/stats` — l'acquis y est une **mesure** (total, ce mois-ci, perdues, part du catalogue),
jamais une liste : la liste vit sur `/revision`, l'écran où elle sert à choisir.

- ⚠️ **Le catalogue MARQUE, il ne filtre pas.** Un seul tableau, deux `<tbody>` — la sélection
  multiple, la barre d'actions groupées et les cinq colonnes sont communes. Le filtre `?box=5`
  continue de lister la carte acquise pendant que la tuile de `/revision` annonce 0 : les deux
  écrans ne répondent pas à la même question, et c'est l'arbitrage du tableau des compteurs de
  CC-261. **Ne « réconcilie » pas les deux côtés** — l'y faire disparaître rendrait inéditable, sur
  le seul écran qui sert à corriger, précisément ce qu'on connaît le mieux.
- ⚠️ **La maîtrise est un DRAPEAU à côté de la boîte, pas une 6ᵉ boîte** : la carte *est* en boîte 5,
  et `again` efface le drapeau sans toucher la boîte. Le module a cinq boîtes, et ça n'a pas changé.
- ⚠️ **`LeitnerMasteryService` ne construit AUCUN arbre de taxonomie** : le chemin d'une carte se lit
  sur son thème préchargé, sur des cartes déjà filtrées par `applyVisibility`. C'est délibéré — et
  depuis CC-263, `leitner_stats_service.ts` (`weaknessByTheme`) suit la même règle sur son propre
  arbre de catégories : c'était le seul oubli du module, corrigé, pas un patron à recopier ici.

⚠️ **Ce qui reste vrai après ce lot, et qu'aucun test ne prouve** : `pages/index.vue` n'a toujours
pas de test de composant (limite connue, plus bas), donc la session d'entretien elle-même se vérifie
au navigateur. Et l'apparence — la 6ᵉ case, les mois, les couleurs — n'est prouvable par rien
d'autre qu'un œil.

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
- ⚠️ **Sauf si la carte ressort MAÎTRISÉE** (CC-261) : l'échéance vient alors de l'échelle
  d'entretien, pas de l'intervalle de la boîte — voir la section dédiée plus haut. Ça inclut la note
  qui *acquiert* la maîtrise, qui repart donc à 90 j et non à 30.
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

⚠️ **Ce tableau décrit la RÈGLE, et elle vaut pour les quatre notes quelle que soit la file** —
`review()` n'a pas bougé depuis CC-265. Ce qui a changé est ce que l'**écran propose** : deux
réponses seulement en entretien, parce que trois des quatre y produisaient un effet identique (voir
la section CC-265). Ne lis pas ce tableau comme la liste des boutons.

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

### Le modèle écrit du Markdown dans les cartes (CC-259)

`SYSTEM_PROMPT` demande désormais du Markdown **dans les valeurs `front`/`back`**, borné : gras et
listes partout, un bloc de code seulement si le cours en contenait un — sans quoi un modèle enrobe
même une carte de deux phrases sous des titres. ⚠️ **La consigne de format de l'enveloppe JSON
n'a pas bougé** (« sans prose, sans bloc de code », lignes 410 et 634) : elle porte sur le transport,
la nouvelle consigne porte sur le contenu des champs — les deux coexistent sans se contredire, et
c'est **mesuré**, pas supposé : `extractJson` tente trois candidats (nu, bloc, scanner d'accolades
`firstJsonValue`), et une carte dont le `back` porte lui-même un bloc de code parse correctement même
enveloppée dans ```` ```json ```` — voir `tests/unit/leitner_ingestion_service.spec.ts`, le cas du
bloc imbriqué.

⚠️ **Ne retire jamais `firstJsonValue` de la cascade** en le croyant redondant avec la regex de bloc.
C'est justement ce cas — un bloc de code imbriqué dans une enveloppe extérieure — qui le rend
nécessaire : la regex, non gourmande, s'arrête au premier ``` ```` fermant qu'elle rencontre, celui du
bloc **intérieur**, et rend un fragment tronqué que `JSON.parse` refuse. Le scanner d'accolades est
seul à ignorer ce qui est à l'intérieur d'une chaîne JSON. Un test dédié, minimal, isole ce mécanisme
et mute (retrait de la ligne qui pousse `firstJsonValue` dans les candidats) pour le prouver.

⚠️ **Conséquence mesurée sur le court-circuit du juge** (voir plus haut, « la réponse écrite ») :
`normalizeForSearch` ne touche ni `**`, ni les clôtures de bloc de code — un verso passé en
`**gras**` ne correspond donc plus à la même réponse tapée sans balisage, et part au juge là où il y
avait un court-circuit. Mesuré par un test dédié (`leitner_judge_service.spec.ts`) : le nombre d'appels
LLM passe de 0 à 1 sur un cas identique, hors Markdown. Aucune conséquence de justesse, une latence
en plus — la doctrine du module (« court-circuit = optimisation, pas une règle ») tient.

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

## Le corpus de cours (CC-251)

Cinq écrans devient **six** : `/revision/cours` (liste + ajout) et `/revision/cours/:id`
(consultation, remplacement, suppression). Deux tables neuves, `leitner_courses` (le markdown
source, `owner_id`/`is_shared` comme les autres tables de **contenu**) et
`leitner_course_sections` (le découpage, **sans** `owner_id`/`is_shared` — sa visibilité se
dérive par jointure sur son cours parent, même doctrine que `leitner_draft_cards`).

⚠️ **Aucun fichier `.md` n'est jamais téléversé au serveur.** `FileReader` côté client lit le
fichier en texte ; le formulaire poste toujours `markdown` en JSON, exactement comme un collage.
`source: 'paste' | 'file' | 'ingest'` reste **déclaratif**, même doctrine que `source`/`sourceName`
de l'ingestion : c'est le client qui annonce l'origine, le dégât est cosmétique.

⚠️ **Toute route qui porte du markdown en corps de requête rend du JSON nu, jamais une
redirection Inertia classique** (`POST /cours`, `POST /cours/conflict`, `PUT /cours/:id`).
Raison : le store de session est `cookie` (CC-78), et un échec de validation flasherait le
markdown entier dedans à la racine du bagage — la faille que CC-179 a fermée sur le coffre,
rejouée ici sur un contenu potentiellement long. `destroy`/`purge`, qui ne portent aucun texte,
restent en redirection classique.

### Deux découpages, jamais unifiés

`splitCourseIntoSections` (pur, `services/leitner_course_sections.ts`) n'a **rien à voir** avec
`chunkCourse` de l'ingestion, et il ne faut pas les fusionner : `chunkCourse` chevauche
délibérément (`CHUNK_OVERLAP_CHARS`) pour qu'un principe à cheval sur deux morceaux reste
énonçable par le LLM ; `splitCourseIntoSections` ne chevauche **jamais** — une section appartient
à exactement une partie du texte, c'est ce qui rend le remplacement et les pierres tombales
possibles. Chaque titre accumule un `headingPath` (le chemin depuis la racine), et le slug se
dérive de ce chemin (`introduction/tls` par exemple), désambiguïsé par un suffixe numérique en
cas d'homonymie.

Une ligne `> notion: X, Y` n'importe où dans le corps d'une section déclare ses alias de
glossaire (`aliases`) — texte libre, jamais interprété.

### La déduplication : deux détections distinctes, pas une

- **Même empreinte** (`hashCourseMarkdown`, SHA-256 du markdown normalisé CRLF→LF) → rattachement
  **silencieux** au cours existant, aucun dialogue.
- **Même titre, empreinte différente** → conflit à 3 issues (`CourseConflictDialog.vue`) :
  **remplacer** le contenu (déclenche le remplacement tombale, voir plus bas), **créer un second
  cours** (suffixe `" (2)"`, `" (3)"`… automatique), **annuler** (rien n'est écrit).
- Les deux détections sont **scopées par propriétaire** (`unique(owner_id, content_hash)` et
  `unique(owner_id, title)`) : deux comptes peuvent chacun avoir un cours au même titre ou au
  même contenu sans se marcher dessus — même doctrine que `unique(owner_id, name)` sur les
  catégories (CC-139).
- **Depuis l'ingestion, aucun dialogue** : la case « conserver ce cours » (`saveCourse`) est un
  flux asynchrone fire-and-forget — un conflit de titre se résout par suffixe automatique, jamais
  par une boîte de dialogue qui bloquerait un travail de fond.

### Le remplacement pose des pierres tombales, jamais une suppression

`replaceMarkdown` (dans `db.transaction()`) recharge le markdown, le redécoupe, puis pour chaque
section du nouveau découpage : une section dont le slug existe déjà est **mise à jour sur la même
ligne** (et ressuscitée si elle portait une tombe, `obsolete_at = null`) ; une section neuve est
créée. Toute section **existante et vivante** dont le slug est absent du nouveau découpage reçoit
`obsolete_at = now()` — **jamais supprimée**. La purge (`purgeTombstones`) est un geste manuel
distinct qui supprime les lignes tombées, jamais implicite dans le remplacement.

⚠️ **La suppression d'un cours entier, elle, est une cascade réelle** sur ses sections — pas de
pierre tombale. Aucune carte ne référence encore une section (ticket suivant) : rien à préserver
côté section quand le cours disparaît en bloc.

### Export v5 : les sections partent telles quelles, jamais re-dérivées

`BACKUP_VERSION` passe à **5**, `READABLE_BACKUP_VERSIONS` reste une **liste** (`[1,2,3,4,5]`),
jamais une égalité — un fichier v1 à v4 sans clé `courses` importe toujours 0 cours. L'export
sérialise chaque cours **et ses sections en base**, tombes comprises : jamais re-découpées depuis
le markdown à l'export ni à l'import, sinon une restauration perdrait l'historique des slugs
disparus (le point de tout ce mécanisme).

⚠️ **Colonnes `jsonb` chez Lucid : `@column()` nue ne suffit pas.** `headingPath` et `aliases`
portent `prepare: (v) => JSON.stringify(v)` (avec gestion explicite du `null` pour `aliases`,
nullable). Sans lui, le driver `pg` sérialise un tableau JS en littéral de tableau **Postgres**
(`{"TLS"}`), pas en JSON, et l'insertion échoue (`22P02 invalid input syntax for type json`).
Déjà documenté dans le `CLAUDE.md` du module `agents` (« ne pas confondre avec les `text[]` de
veille/leitner, qui n'en veulent pas ») — piège classique pour la prochaine colonne `jsonb` du
dépôt, ici comme ailleurs.

### Capacités et navigation

`leitner.courses.view` / `leitner.courses.write` (`capabilities.ts`) — **aucune ligne
supplémentaire dans `start/capabilities.ts`**, qui importe tout le tableau `LEITNER_CAPABILITIES`
d'un coup ; seule la déclaration locale suffit. Sixième onglet de `LeitnerTabs.vue`, entre
Ingestion et Configuration.

⚠️ **`leitner_course_sections` n'entre PAS dans `ownedSharedContentTable`** (le garde de
suppression de compte) : seul `leitner_courses` y figure, même raison que `leitner_draft_cards`
en est absent — sa visibilité se dérive de son parent, elle ne porte aucune propriété propre à
vérifier.

## La provenance d'ingestion : une carte connaît sa section (CC-253)

Une carte générée à l'ingestion **sait** de quel morceau du cours elle vient — l'indice de la
boucle d'ingestion, jusqu'ici jeté. `leitner_card_sections` (carte ↔ section, `origin: 'ingestion'
| 'manuel'`) le conserve, et le panneau de révision l'affiche **avant** les résultats de recherche
plein texte de CC-252 — un lien connu avec certitude, distingué d'une simple ressemblance.

⚠️ **Ne porte PAS `owner_id`/`is_shared`, comme `leitner_draft_cards` et
`leitner_course_sections`.** Ce n'est pas du contenu à soi : un lien entre deux contenus qui
portent déjà chacun leur propriétaire (la carte, le cours de la section). Sa visibilité se
**dérive des deux**, jamais dupliquée — voir `services/leitner_card_sections_service.ts`.

⚠️ **`chunk_index` seul ne suffit pas — c'est le piège que ce lot devait fermer.** `chunkCourse`
regroupe les petites sections (un morceau peut en couvrir six) et découpe les grosses
(`splitOversized`, une section peut s'étaler sur plusieurs morceaux) ; chaque morceau commence en
plus par la fin du précédent (`overlapOf`, 400 caractères) — du texte d'une AUTRE section en tête.
`chunkCourse` rend donc `{ texte, slugsDeSections }[]` plutôt que `string[]` : les slugs sont
calculés **à la construction du morceau**, jamais retrouvés après coup.

- ⚠️ **Les slugs sont calculés sur EXACTEMENT le même texte que celui qui construit les sections
  réellement persistées d'un cours** — `chunkCourse` appelle `splitCourseIntoSections` (le même
  découpeur que `LeitnerCourseService`) sur son propre texte normalisé, jamais un texte recalculé
  autrement. C'est ce qui garantit qu'un slug désigne toujours une ligne réelle de
  `leitner_course_sections`, jamais une supposition. Les deux découpeurs (`splitBySections` de
  l'ingestion, `splitCourseIntoSections` du corpus) partagent la même granularité de blocs — un
  par titre, plus un préambule commun — sur un texte identique : ils s'alignent donc terme à
  terme, appariés par INDEX. Un heading pathologique (`# ` sans titre après l'espace, que
  `splitCourseIntoSections` ignore et que `splitBySections` traite comme une coupure quand même)
  désaligne les deux listes ; l'appariement dégrade alors silencieusement vers `slugsDeSections:
  []` pour les pièces concernées, plutôt que de planter ou de deviner.
- ⚠️ **Le recouvrement en tête n'apporte JAMAIS le slug du morceau précédent — le test qui
  compte.** Le préfixe recopié (`overlapOf`) est connu à la construction : `currentSlugs` repart à
  vide à chaque nouveau morceau, seule une pièce NEUVE (jamais l'overlap) l'alimente. Un principe
  énoncé en fin de section A et repris en tête du morceau qui commence la section B ne fait donc
  jamais croire que ce morceau vient aussi de A.
- **L'imprécision résiduelle se corrige d'elle-même**, et c'est voulu, pas approximatif : un
  morceau ne regroupe des sections que parce qu'elles sont petites (donc le rattachement reste
  fin), et une section découpée garde le même slug sur chacun de ses morceaux (le rattachement
  reste exact, juste réparti).

`leitner_draft_cards.section_slugs` (jsonb, nullable) porte ce calcul par brouillon — toujours un
tableau côté application dès l'ingestion, même vide (aucune section rattachée) ou même quand
l'ingestion n'a conservé aucun cours (`leitner_ingestions.leitner_course_id` nul) : c'est
`linkIngestionSections`, à la **promotion**, qui décide s'il y a quelque chose à lier, jamais le
calcul lui-même.

### Les liens se posent à deux moments, jamais un troisième

1. **La promotion** (`LeitnerIngestionService.accept`) — `linkIngestionSections(cardId, courseId,
   slugs)` cherche les sections du cours par `(course_id, slug)`, **tombes comprises** (une
   section obsolète reste une cible valide), et pose un lien `origin: 'ingestion'` par slug
   trouvé. ⚠️ **Que la carte soit neuve ou un doublon retrouvé au catalogue** — la promotion EST
   le point de validation humaine du module, indépendamment du fait que `createCardUnlessDuplicate`
   ait ou non créé une ligne.
2. **Le sélecteur manuel** de `/revision/settings` (`setManualSection`) — un `<select>` de plus
   dans la modale de carte, un cours à la fois via `<optgroup>` (patron du sélecteur de thème).
   Au plus **un** lien `origin: 'manuel'` par carte : `setManualSection` supprime l'ancien avant
   d'en poser un nouveau, et ne touche **jamais** aux liens `ingestion` de la même carte — deux
   origines, deux gestes distincts, jamais mélangés. `courseSectionId: null` efface sans reposer.
   Lier une section d'un cours resté invisible de l'appelant est refusé **en silence** (la carte
   se crée/s'édite quand même, seul le lien est absent) — même doctrine que `ensureTheme` sur la
   taxonomie : on ne rattache jamais à ce qu'on ne peut pas soi-même parcourir.

⚠️ **On ne demande RIEN au modèle.** Un champ « section » dans sa réponse serait un quatrième
champ hallucinable — `parseLlmCards` recopie explicitement les quatre seuls champs
`front`/`back`/`category`/`theme` avant validation, et **c'est cette recopie qui tient la
garantie, pas le validateur**. La provenance d'ingestion est arithmétique, calculée par nous.

### Les liens `ingestion` se montrent et se suppriment aussi (CC-272)

Jusque-là, un lien `ingestion` n'était visible et modifiable que dans le panneau de révision, en
lecture seule — CC-253 l'excluait explicitement du sélecteur manuel. `/revision/settings` les
montre désormais dans une **zone distincte** de la modale d'édition (jamais fondue avec le slot
`manuel`, même doctrine que les deux gestes du point 2 ci-dessus), avec un bouton de suppression
par lien : `DELETE /revision/cards/:id/sections/:sectionId`, sous `leitner.cards.write`, qui
n'agit que sur `origin = 'ingestion'` (`removeIngestionSection`, filtre en SQL — jamais une
convention côté appelant). « Modifier » un lien `ingestion` n'a pas de geste dédié : on le
supprime, puis on re-cible via le sélecteur manuel si besoin — un second `<select>` par ligne
`ingestion` serait redondant avec le premier.

⚠️ **Ce geste rend atteignable un doublon que CC-253 n'avait pas anticipé.**
`leitner_card_sections` ne porte qu'une contrainte `unique(leitner_card_id,
leitner_course_section_id)` — **sans** `origin` dans la clé (voir la migration). Cibler à la main,
via le sélecteur manuel, une section qui porte déjà un lien `ingestion` de la même carte violait
donc cette contrainte : un `INSERT` non catché, 500 brut. `setManualSection` résout désormais ce
cas en **convertissant le lien existant en place** (`origin = 'manuel'`) plutôt qu'en dupliquant —
un lien re-ciblé à la main n'est plus de la provenance d'ingestion, et son statut le dit plutôt que
de mentir. Symétriquement, `removeIngestionSection` ne touche jamais un lien `manuel`.

⚠️ **L'export/import n'a pas bougé, et c'est prouvé, pas supposé** — `sections: {courseTitle,
slug, origin}[]` reste inchangé : un lien converti exporte son `origin` courant (`manuel`), un
lien supprimé n'est simplement plus dans la liste. `tests/functional/modules/leitner_card_sections.spec.ts`
couvre les deux par un aller-retour réel plutôt que par une affirmation.

### Le panneau de révision : le lien explicite, puis la recherche

`LeitnerController#index` peuple `provenance` sur chaque carte due via `provenanceSectionsFor` —
**avant** le panneau « Approfondir » de CC-252 dans `pages/index.vue`, les deux visuellement
distincts (en-têtes séparés, jamais une liste commune). Une section devenue obsolète depuis reste
affichée, badge « Obsolète » à l'appui (`leitner.coursShow.obsolete`, clé déjà existante) : le
panneau le dit, il ne perd rien en silence — même doctrine que les pierres tombales de CC-251.

⚠️ **Périmé depuis CC-274 (2026-08-20) : « rendue en HTML » ne tient plus.** Ce paragraphe décrivait
le corps de section rendu **inline** (`renderMarkdown`, même patron que `frontHtml`/`backHtml`).
Depuis CC-274, ni `provenance` ni la réponse de `courseSearch` ne portent plus `bodyHtml` — les deux
panneaux sont des LISTES compactes, et le contenu ne se charge qu'au clic, dans une modale. Voir la
section « Provenance et Approfondir deviennent des modales (CC-274) » plus bas pour le mécanisme
actuel.

⚠️ **Gate SERVEUR, pas seulement client — sur `LeitnerController#index` ET
`LeitnerSettingsController#index`.** `provenance` porte le corps d'une section du corpus, exactement
ce que `GET /:id/course-search` protège par `leitner.courses.view` ; la peupler sans vérifier la
capacité enverrait ce contenu dans les props Inertia à quiconque a seulement `leitner.view`, que le
panneau soit affiché ou masqué côté client. Les deux contrôleurs appellent
`capabilityService.allows(auth.user!, 'leitner.courses.view')` avant de construire quoi que ce
soit — masquer un `<select>` ou un panneau n'est jamais la garde, ici comme partout ailleurs.

⚠️ **Filtré par la visibilité du COURS du lien, pas de la carte** — `provenanceSectionsFor` et
l'export appellent tous deux `isVisible(courseSection.course, userId, isAdmin)`. Une carte peut
être visible (promue par un admin sur l'ingestion privée d'un autre compte) tout en pointant vers
un cours resté privé à ce compte : sans ce filtre, le panneau ou l'export d'un admin révélerait le
contenu d'un cours qu'il ne peut voir par aucune autre voie. Cas limite inatteignable par l'UI
actuelle (aucun geste ne crée cette situation aujourd'hui), mais possible en base — donc vérifié
quand même dans `tests/functional/modules/leitner_card_sections.spec.ts`.

### Export/import : additif, aucun bump

Chaque carte exportée gagne `sections: { courseTitle, slug, origin }[]` — désignée par **nom**,
jamais un id, même doctrine que la taxonomie (les séquences Postgres ne suivent pas un insert à id
explicite). **Toujours un tableau, jamais omis même vide** — patron `reviews`, pas celui de
`box5EnteredAt`/`masteredAt` (`omitNull`) : il n'y a ici aucune ambiguïté entre « vide » et
« inconnu » à trancher.

⚠️ **Strictement additif → PAS de bump de `BACKUP_VERSION`.** Précédent explicite : les cinq
colonnes de trace d'une révision (CC-51) n'avaient pas bumpé non plus, à raison — un fichier
antérieur reste intégralement lisible, seul un checkout d'avant ce lot perdrait le champ en
silence. Le critère reste « le jour où un champ change de sens ou devient obligatoire ».

⚠️ **L'import résout la provenance en TROISIÈME passe**, après que cartes ET cours ont tous deux
été créés dans la même transaction — les sections d'un fichier arrivent après les cartes qui les
référencent. Résolution par `(titre du cours, owner_id = importateur)` puis `slug`, jamais par un
id repris du fichier. Seules les cartes **réellement créées dans cet import** y entrent (jamais une
carte ignorée par déduplication) — même doctrine que ses révisions : « une carte ignorée n'est
jamais retouchée ». Un cours ou un slug introuvable (fichier partiel, cours non inclus dans cet
export) est ignoré en silence : le lien perdu est déjà l'imprécision que le ticket accepte, pas une
erreur nouvelle. `leitner_backup.spec.ts` capture ce champ dans son `snapshot()` — sans lui, une
colonne que cette fonction ne lit pas serait perdue par l'export sans qu'aucun test ne rougisse,
exactement ce qui a laissé passer CC-51.

## Le lien vers la section du cours (CC-273)

Provenance (CC-253) et Approfondir (CC-252) affichaient le corps de section **en HTML inline
seulement**, sans jamais pointer vers `/revision/cours/:id`. Ce lot ajoute un lien « Voir dans le
cours » — l'aperçu inline **reste**, le lien s'ajoute, il ne le remplace pas.

⚠️ **Ancre par `id`, jamais par `slug`.** Le slug est un chemin de titres (`string(300)`, accents et
espaces compris) qui **change** si l'auteur renomme un titre : un lien resterait syntaxiquement
valide mais pointerait sur une ancre disparue. L'`id` est stable et déjà porté par les deux charges
utiles (`provenanceSectionsFor`, `searchCourseSections`) — `shared/course_section_link.ts`
(`courseSectionHref`, `sectionAnchorId`) est l'unique endroit qui construit `href="/revision/cours/
<courseId>#section-<id>"`, consommé par `CourseSectionView.vue` — **le seul point de rendu des deux
panneaux** (CC-253 § « un contenu, deux châssis »), donc le lien s'applique aux deux d'un geste.

⚠️ **Le hash natif du navigateur NE DÉFILE PAS sur cette application, et c'est la même famille que
CC-67.** Le conteneur défilant est le panneau `overflow-y-auto` d'`AppLayout`, jamais `window` : le
mécanisme du navigateur qui saute à `#ancre` agit sur le **document**, il ne fait donc rien de
visible ici. `cours_show.vue` lit `window.location.hash` lui-même au montage et appelle
`scrollIntoView` à la main, après un `nextTick()` — sans lui, on mesurerait un DOM que Vue n'a pas
encore écrit.

⚠️ **`LeitnerCourseController.show` ne filtre pas `obsoleteAt`** : une section tombée reste
consultable (badge « Obsolète »), donc un lien de provenance vers une section devenue obsolète
atterrit toujours sur une ancre qui existe. Seule une section **purgée** (ligne supprimée) laisse
une ancre absente — le lien reste valide, il ouvre le bon cours, seul le défilement échoue en
silence (page ouverte en haut). Cas résiduel accepté, hors périmètre du ticket.

⚠️ **Ce qu'aucun test ne peut prouver : le défilement lui-même.** jsdom ne fait aucun layout,
`scrollIntoView` y est un stub. Seuls sont testés : le pur (`leitner_course_section_link.spec.ts`),
le rendu du lien par `CourseSectionView` (`course_section_view.spec.ts`, l'`href` construit), et le
`courseId` dans les deux payloads (`leitner_card_sections.spec.ts`, `leitner_course_search.spec.ts`,
mutation vérifiée). L'arrivée sur la bonne section, dans un vrai navigateur, reste un passage
navigateur du propriétaire.

## Les mots-clés du recto (CC-254), et son rendu Markdown restauré (CC-276)

Un terme que le corpus définit (`> notion: TLS, Transport Layer Security` sous un titre, CC-251)
devient cliquable dans le recto d'une carte : le clic ouvre sa section dans une modale. **Aucun
balisage dans la carte** — le glossaire se reconnaît tout seul contre le texte déjà écrit, ce qui
fait souligner les cartes **déjà existantes** sans en rouvrir une seule.

⚠️ **Périmé depuis CC-276 : le paragraphe qui suivait ici disait que le recto perdait son rendu
Markdown.** C'était le prix que CC-254 payait pour souligner sans `v-html` : `frontHtml` restait
calculé mais n'était plus consommé par ce bloc, et un `**gras**` s'affichait littéralement. CC-276
paie ce prix autrement — voir plus bas — et le recto a retrouvé son gras, ses listes et ses blocs
de code **sans** réintroduire de `v-html`. Voir le `CLAUDE.md` racine, section « Le seul `v-html`
du dépôt », pour le compte à jour (toujours cinq, le recto en reste exclu).

### CC-276 : tokeniser les nœuds de texte du HTML déjà assaini, pas le texte source

Le déplacement tient en une phrase : la tokenisation contre le glossaire s'est déplacée du
**client** (sur `front`, la source Markdown) vers le **serveur** (sur le HTML déjà assaini par
`renderMarkdown(front)` — la même brique que le verso, inchangée). `frontHtml` est reparcouru
NŒUD DE TEXTE PAR NŒUD DE TEXTE — jamais le balisage, jamais un attribut — et chaque nœud de texte
tokenisé par `tokenizeFront` (inchangée elle aussi). La page reçoit une PROP DÉJÀ CALCULÉE
(`frontNodes`, un arbre) et la rejoue en éléments Vue réels via `h()` (`renderFrontNode`/
`renderFrontNodes` dans `pages/index.vue`) — **jamais en `v-html`, jamais une chaîne HTML
reconstruite côté page**. Un `tag` de cet arbre vient toujours de la liste blanche de
`markdown_renderer.ts` (jamais du texte d'une carte) : c'est elle, inchangée, qui reste l'unique
frontière de sécurité — le reparcours ne fait que la re-sérialiser en arbre plutôt qu'en chaîne.

⚠️ **`htmlparser2` est déclaré en dépendance DIRECTE (`package.json`) depuis ce lot, et c'est un
choix délibéré, pas un oubli de nettoyage.** Il était déjà présent sur le disque — dépendance
propre de `sanitize-html` (`node_modules/sanitize-html/package.json`), zéro octet neuf téléchargé
— mais y importer directement sans le déclarer aurait été un import « fantôme » : rien ne garantit
qu'il reste résolu au même endroit d'une réinstallation à l'autre tant qu'il n'est pas dans NOTRE
arbre de dépendances déclaré. Le déclarer coûte une ligne de `package.json`, zéro paquet de plus.

- **`services/leitner_front_html.ts`** (`tokenizeFrontHtml(html, glossary) → FrontNode[]`) — la
  fonction PURE qui fait ce reparcours. Elle ne sait rien du Markdown (l'appelant lui passe du
  HTML déjà rendu) : `LeitnerController#index` calcule `renderMarkdown(card.front)` **une seule
  fois**, l'utilise pour `frontHtml` (inchangé, toujours envoyé, toujours consommé ailleurs —
  `llm.vue`, les aperçus de saisie) **et** pour `tokenizeFrontHtml`, jamais un second
  `renderMarkdown`.
- **`FrontNode`/`FrontElementNode`/`FrontTextNode`** vivent dans `shared/glossary_highlight.ts`,
  aux côtés de `FrontToken` — un nœud `element` porte `tag`+`attrs`+`children` (le balisage
  intact), un nœud `text` porte les jetons (comme avant CC-276). Ce fichier reste PUR ; ces types
  n'y ajoutent aucune logique. `pages/index.vue` les importe en RELATIF (comme avant), mais
  n'importe plus `tokenizeFront` lui-même — la fonction n'est plus appelée QUE côté serveur.
- ⚠️ **Un terme ne s'annonce jamais dans un `<code>`/`<pre>`** : le reparcours passe un glossaire
  vide aux nœuds de texte sous ces tags. On n'annote pas du code.
- ⚠️ **La limite du terme à cheval sur deux nœuds de texte N'A PAS CHANGÉ, et ne pouvait pas
  changer** — c'est la MÊME limite que CC-254 acceptait déjà sur le texte source, juste déplacée
  sur le HTML : `**TLS** négocie` avec un terme composé « TLS négocie » ne se souligne toujours
  pas, « TLS » vivant dans un `<strong>` séparé du reste. Reconstruire le texte complet pour la
  rattraper romprait l'alignement avec le balisage réel — exactement ce que ce lot évite.

### Le tokeniseur — `shared/glossary_highlight.ts`, PUR, inchangé

`tokenizeFront(front, glossary) → { texte, sectionId | null }[]`. Trois règles, aucune
négociable :

- **`normalizeForSearch` est l'unique copie** (`components/leitner_scope_search.ts`), importée en
  **relatif** — jamais l'alias `#modules/*`, qui casserait Vite si ce fichier redevenait un jour
  importé par une page (même piège documenté sur `shared/review_page.ts`).
- **Plus long d'abord.** Deux termes qui se chevauchent (`Transport Layer` / `Layer Security` sur
  « Transport Layer Security ») : le plus long trouvé à une position consomme sa portée, l'autre
  n'est jamais retenté dessus. Comportement déterministe, testé, pas laissé au hasard.
- **Jamais à l'intérieur d'un mot** — « TLSv1.3 » ne souligne jamais « TLS ». La frontière se
  vérifie sur le caractère juste avant/après le candidat (`\p{L}\p{N}` Unicode), pas sur l'ASCII
  seul, sinon « sécurité » ne matcherait jamais lui-même après normalisation.

⚠️ **Aucun `v-html` dans le rendu, toujours.** `renderFrontNode`/`renderFrontNodes` (`pages/
index.vue`) rejouent l'arbre en `h(tag, attrs, children)` pour un nœud `element`, en interpolation
Vue échappée (ou un `<button>` pour un jeton reconnu) pour un nœud `text` — construire une chaîne
HTML à partir du texte d'une carte serait la seule injection réelle de ce lot, exactement comme en
CC-254. Prouvé par mutation, aux DEUX bouts : côté serveur, un recto hostile ne produit jamais
d'élément `script` (`tests/unit/leitner_front_html.spec.ts`) ; côté page, si le rendu se remettait
à concaténer les jetons en `v-html`, `pages/__tests__/index.spec.ts` rougirait (vérifié à la main).

### L'index et la route — filtrés par visibilité, comme tout le reste du corpus

`services/leitner_glossary_service.ts` (`glossaryIndex`) — même patron que
`searchCourseSections` (CC-252) : jointure `leitner_courses`, `applyVisibility`, **sections
tombées exclues** (`whereNull('obsolete_at')`) — la révision teste le vocabulaire du cours ACTUEL,
pas ce que l'auteur a retiré. Servi par `LeitnerController#index` dans la branche `session`
seulement, gardé par `canViewCourses` (déjà calculé pour la provenance) : `[]` sans
`leitner.courses.view`.

`GET /cours/sections/:id` (`LeitnerCourseController#sectionContent`) rend le contenu d'UNE
section — GET, pas de jeton CSRF, visibilité vérifiée sur le cours parent
(`assertVisibleOrAdmin`). ⚠️ **Masquer n'est pas fermer, les deux, comme partout ailleurs** :
l'index vide empêche tout soulignement **et** la route refuse indépendamment, testé séparément.

⚠️ **Ne filtre PAS `obsoleteAt`**, même doctrine que `LeitnerCourseController#show` : un terme du
glossaire ne pointe jamais vers une tombe au moment du rendu (l'index l'exclut), mais un cours
peut être remplacé entre le chargement de la page et le clic — la section tombée reste
consultable plutôt que de lever une erreur sur ce résidu.

### La modale et le chrono fantôme

`CourseSectionView` (CC-253) est réutilisé tel quel — « un contenu, deux châssis » — dans
`inertia/components/AppModal.vue` (CC-207/209), jamais une modale écrite à la main. Une prop
optionnelle `titleId?: string` a été ajoutée pour poser `aria-labelledby` sur le titre réel de la
section — absente ailleurs, elle ne change rien aux deux autres consommateurs.

⚠️ **Ouvrir une définition avant la première frappe appelle `markInterrupted()`, et c'est TOUT ce
qu'il y a à écrire.** Sa garde (`firstInputAt === null`) porte déjà exactement la sémantique
demandée — marque l'interruption si rien n'est encore tapé, ne fait rien sinon. Aucune condition
à dupliquer dans `openGlossaryTerm()`. Sans ce geste, lire une définition 40 s puis répondre
écrirait une mesure de « rappel » qui n'en est pas une, et `thinking_ms` alimente la médiane de
référence de la carte et de sa boîte (voir « Le timer fantôme » plus haut).

⚠️ **Les quatre refs de la modale entrent dans le `watch` sur la référence de `dueCards`**, même
raison que le reste de l'état de cet écran : sur une file d'une seule carte, `again` renvoie la
même carte, même id — sans ce reset une modale resterait ouverte sur la section de la tentative
précédente.

⚠️ **Renommées `sectionModalOpen/Section/Loading/Error` depuis CC-274 (2026-08-20)** — ce
paragraphe les nommait `glossaryModalOpen/Section/Loading/Error`, avant que la même modale serve
aussi la provenance et « Approfondir ». Voir la section suivante.

## Provenance et Approfondir deviennent des modales (CC-274)

Les deux panneaux qui affichaient le corps entier d'une section **en ligne** dans l'écran de
révision — la provenance (CC-253) et « Approfondir » (CC-252) — deviennent des **listes
compactes** : une ligne par section, portant son chemin de titres. Le clic ouvre la section dans
la modale déjà posée par CC-254 pour le glossaire — **une seule instance**, réutilisée par les
trois déclencheurs (`openSectionModal(sectionId)`, refs `sectionModal{Open,Section,Loading,Error}`)
— jamais trois modales distinctes. `openGlossaryTerm()` reste le seul appelant de
`markInterrupted()` avant de déléguer à `openSectionModal()`.

⚠️ **Provenance et Approfondir n'appellent PAS `markInterrupted()`, et c'est délibéré — pas un
oubli.** Le geste que CC-254 protège (lire une définition puis répondre, ce qui gonflerait
`thinking_ms` d'un temps de lecture sans rapport avec le rappel) suppose d'ouvrir la modale
**avant** `reveal()`, donc avant que le champ de réponse soit désactivé. Provenance et Approfondir
sont gardés par `v-if="revealed && ..."` : `revealed` passe `true` en tout premier dans `reveal()`,
avant le moindre `await`, et **désactive immédiatement** le champ (`:disabled="revealed"`). Au
moment où ces deux panneaux existent, `firstInputAt` est donc déjà scellé — posé (on a tapé avant
de dévoiler) ou définitivement `null` (on ne pourra plus jamais taper pour cette présentation, donc
`thinkingMs` restera `null` par construction, voir `fluencyMeasure`). Le chemin que ce lot protège
ailleurs ne peut structurellement pas se produire ici.

**Provenance : en-tête unique, ou titre par ligne — jamais les deux.** `soleCourseTitle`
(`shared/review_page.ts`, pur) rend le titre de cours si toutes les sections de provenance en
partagent un seul, sinon `null`. Un en-tête (« Vient de : X ») s'affiche dans le premier cas ; dans
le second (rare — un lien manuel et un lien d'ingestion pointant vers deux cours différents), le
titre est répété sur chaque ligne, comme Approfondir (qui cherche dans **tout** le corpus et
affiche donc systématiquement le titre par ligne, sans en-tête possible).

⚠️ **Le panneau vide reste invisible, sans message — ce n'est pas un choix de ce lot, c'est
l'état déjà en place.** `v-if="... currentCard.provenance.length > 0"` cachait déjà tout le bloc
avant CC-274 ; aucun texte « aucune provenance connue » n'a jamais existé. Approfondir garde son
message « Rien trouvé… » existant (`coursePanel.empty`), qui répond à un geste explicite de
recherche — cas différent, pas retouché.

`provenance` (`LeitnerController#index`) et la réponse de `courseSearch` ne portent plus `bodyHtml`
— le contenu se charge au clic via `GET /revision/cours/sections/:id` (posée par CC-254). Aucun
bump de format n'est en jeu : ces deux payloads ne sont pas l'export JSON.

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
- **`pages/index.vue` a un test de composant depuis CC-252 (2026-08-18), mais étroit** :
  `pages/__tests__/index.spec.ts` ne prouve que ce que ce lot a ajouté — « Je ne sais pas »
  qui surligne sans poster, le panneau « Approfondir », et la remise à zéro sur la
  RÉFÉRENCE de `dueCards` à même id. Le verrouillage du champ, le badge de repli et le
  chronométrage restent hors de portée d'un test de composant et se vérifient toujours au
  navigateur — noter « À revoir » sur la **dernière** carte due, et voir l'écran repartir
  vierge.
- **Le CSS de la modale** ne se prouve qu'à `npm run build` + navigateur (jsdom ne fait aucun layout).
- **La qualité d'une extraction PDF** (deux colonnes, en particulier) et **la qualité des verdicts du
  juge** sur de vraies cartes demandent un vrai passage navigateur avec de vrais fichiers et LM Studio
  allumé. La suite vérifie qu'il y a du texte, pas qu'il veut dire quelque chose.
- **Le piège Inertia de l'export** ne se voit qu'au clic dans un navigateur : au `curl` comme en test
  fonctionnel, la réponse paraît parfaite dans les deux cas.
- **Le défilement vers l'ancre de section (CC-273)** — `scrollIntoView` manuel dans `cours_show.vue`
  — n'est prouvable par aucun runner : jsdom ne fait aucun layout et n'exécute pas réellement
  `scrollIntoView`. Seuls le pur (l'`href` construit) et la présence de `courseId` dans les payloads
  sont testés ; l'arrivée sur la bonne section reste un passage navigateur.
