# Veille — ce que couvre la suite

Sorti de `CLAUDE.md` pour ne pas être chargé à chaque fois qu'on touche au module. À lire **avant
de modifier un test**, pas avant de modifier le module. Les règles qui, elles, doivent rester
présentes en permanence sont dans `CLAUDE.md`, section « Tests ».

## Le collecteur RSS

- `tests/unit/veille_feed_url.spec.ts` — **la garde SSRF**, le test qui compte du lot, pendant exact
  de `leitner_llm_url.spec.ts`. Loopback, plages privées, `169.254.169.254`, IP déguisées en décimal
  et hexadécimal, identifiants dans l'URL, protocoles non http(s), noms internes. Plus la frontière
  exacte de `172.16/12` : `172.15` et `172.32` sont **publiques**, les exclure interdirait des flux
  légitimes.
- `tests/unit/veille_feed_redirect.spec.ts` — ce qui la **complète**, et le seul test du module à
  émettre une vraie requête (deux serveurs jetables sur `127.0.0.1:0`, fermés en teardown — sans quoi
  `forceExit: false` fige `npm test`). L'assertion qui porte le test est `hits === 0`, pas
  l'exception : la cible rend un flux **valide**, donc un test qui n'asserterait que « ça lève »
  passerait à tort. Il couvre aussi le pendant : **une redirection légitime EST suivie**.
- `tests/unit/veille_feed_parser.spec.ts` — Atom ≡ RSS 2.0 champ par champ, l'**invariant sans `<` ni
  `>`**, le décodage d'entités en une passe (`&amp;lt;` reste `&lt;`), la canonicalisation d'URL, et
  la clé de dédup — dont **la même clé pour le même article vu par deux flux différents**, la
  propriété que le lot achète.
- `tests/functional/modules/veille_sources.spec.ts` — la collecte : **le même item deux fois n'en
  fait qu'un** (contre la base *et* dans une même passe), **un flux en erreur n'empêche pas les
  autres**, le flux à zéro entrée signalé, le 304 qui n'écrase pas le compteur, et surtout
  **l'etag non mémorisé quand l'insert a échoué**. Côté CC-59 : la création en mode horaire, les
  cinq dépareillages mode/heure refusés, la bascule aller-retour qui ne perd ni la cadence ni
  l'heure, et **la contrainte en base vérifiée pour elle-même** — un cas par test, une écriture
  refusée avortant la transaction du test.

## La cadence et l'horaire

- `tests/unit/veille_interval.spec.ts` — **CC-57** : les deux propriétés d'aller-retour (l'universelle
  et celle qui ne vaut que pour les couples canoniques), la table de lecture (30 · 60 · 90 · 1440 ·
  2880 · 10080), les bornes par unité, et le wording affiché — qui régresse en silence. Plus, pour
  **CC-59**, la lecture d'une heure du jour : la forme `'07:00:00'` du driver `pg`, le `null`
  rendu au lieu d'une exception, et « tous les jours à 7h00 » à côté de « tous les 2 jours ».
- `tests/unit/veille_schedule.spec.ts` — **CC-59**, et c'est le test qui porte le lot. Il rejoue la
  boucle du planificateur minute par minute et vérifie **la liste exacte des collectes** : une par
  jour, à l'heure dite. Dedans, deux choses qui ne se voient nulle part ailleurs :
  **la dérive**, montrée côte à côte — avec une heure de retard par collecte, l'horaire tient 7h
  pendant sept jours quand l'intervalle glisse jusqu'à 14h ; et **le fuseau**, où `06:30` UTC
  (= 7h30 à Paris) doit rendre la source due. Ce second test est celui qui tombe si le `setZone`
  disparaît — sans lui, la régression serait parfaitement silencieuse. Plus les changements
  d'heure (mars et octobre, dont une heure qui n'existe pas ce jour-là), le rattrapage d'une
  fenêtre manquée, la source neuve, et le repli d'un mode `daily` sans heure.
  - Depuis **CC-102**, un groupe « une source jamais relue depuis la base ». ⚠️ **Il n'utilise pas
    `makeSource()`, et c'est tout l'intérêt** : le helper pose `lastFetchedAt = null`, donc s'en
    servir testerait l'état inerte au lieu du défaut. Le champ reste **jamais assigné**, l'état
    exact d'un objet rendu par `create()`.
  - **Vérifié mordant**, et la mutation est instructive : l'ancien code restauré, les trois tests
    rougissent de **deux façons différentes** — `TypeError: Cannot read properties of undefined` en
    mode intervalle, et `expected false to be true` en mode horaire. Le second est la moitié
    silencieuse du défaut ; sans un test par branche, elle serait restée.
  - Le troisième test est le seul du fichier à toucher la base, et il prouve **la prémisse** :
    `create()` laisse bien `undefined`, pas `null`. Les deux autres reproduisent un état ; celui-là
    constate qu'il est réel. Si `create()` se mettait à hydrater la colonne, il le dirait.
- `tests/unit/veille_schedule_draft.spec.ts` — **CC-60**, la logique de `pages/sources.vue` sortie du
  `.vue`. Le test qui porte le lot est **l'heure du driver `pg` face à celle du champ** : une source
  à `'07:00:00'` et un brouillon à `'07:00'` sont la **même** cadence, donc rien à enregistrer.
  Retire le `normalizeTimeOfDay` de `isScheduleDirty` et il rougit ; mets-le des deux côtés et c'est
  le test voisin (« une heure réellement changée est bien vue ») qui rougit. Les deux ensemble
  tiennent la fonction. Plus les bornes par unité, le payload qui ne poste que les champs de son
  mode, et la conversion d'unité sans arrondi. ⚠️ Ce qu'il ne voit **pas** : le template, et
  l'enveloppe `isScheduleDirty` de la page — la couture que l'extraction crée.

## La liste et la recherche

- `tests/functional/modules/veille_items.spec.ts` — **CC-20** : la recherche plein texte (dont
  l'apostrophe, l'injection SQL et les caractères spéciaux — avec une assertion sur le **résultat**,
  pas seulement sur l'absence de crash), le filtre par tag accentué, `store`, `toggleQueue`,
  `toggleRead`, la pagination sans chevauchement, et que **la capture manuelle survit à la
  migration**.

## Immich

- `tests/unit/veille_immich_asset.spec.ts` — **CC-55**, la lecture d'un asset : du code pur, donc le
  test qui compte du lot. Les **deux** formes de durée (une regex trop stricte ferait disparaître la
  durée sans erreur), le tag réseau **par jeton entier** (`retikTokage.mp4` ne donne rien — c'est
  aussi pourquoi `x` n'est pas dans la liste), l'aller-retour de la clé de dédup, et surtout ce qui
  **ne rend rien** : `AUDIO`/`OTHER`, un identifiant qui n'est pas un UUID, `immich:../../secret`.
- `tests/unit/veille_immich_client.spec.ts` — ce que le client fait **réellement** d'une réponse
  (`fetch` remplacé, aucun réseau). Le test qui porte le lot est **« un 200 en text/html est une
  erreur explicite, pas un album vide »** : vérifié mordant — désactive l'assertion de
  `content-type` et il rougit seul. Plus la pagination qui suit un `nextPage` **en chaîne**, le refus
  des 3xx, la clé en en-tête et jamais dans l'URL, `albumIds` toujours présent (sans lui, toute la
  bibliothèque personnelle entrerait dans la veille), et les messages distincts 401 / 400. Depuis
  **CC-63** : **`force: false` lu dans le corps réellement émis** — le seul endroit du dépôt où
  cette valeur se prouve —, le 204 sans corps traité comme un succès, `trashDays` où tout ce qui
  n'est pas un nombre vaut `0`, et le refus qui nomme `asset.delete` plutôt que de parler d'une
  instance injoignable.
- `tests/unit/veille_media_item.spec.ts` — **CC-55**, la logique média sortie de `index.vue` : le
  lien construit à l'affichage (jamais stocké), la vignette pointée sur **notre** proxy, et une
  durée qui ne s'affiche pas quand il n'y en a pas. Depuis **CC-88** : le **repli de lien** dans les
  deux sens — une vidéo YouTube s'ouvre sur son `url`, un asset Immich garde le sien. L'ordre ne
  s'inverse pas, et c'est ce que la seconde assertion tient. Depuis **CC-103** : `channelLabel`,
  dont le point est qu'elle rend **`null` et jamais `''`** — la page suspend le séparateur au même
  `v-if` que le nom. Ce qu'il ne voit **pas** : le template et les enveloppes de la page.
- `tests/functional/modules/veille_immich.spec.ts` — la collecte. **« Une erreur d'API ne marque
  AUCUN asset disparu »** est le test qui porte le lot, et il est vérifié mordant : entoure
  `albumAssets()` d'un `try/catch` et lui plus « last_error » rougissent. Plus la deuxième collecte
  qui n'ajoute rien, le même asset deux fois dans une passe, l'asset sorti **puis remis**, l'album
  vidé qui se voit, l'aiguillage par `kind`, l'alignement de la source sur `.env` (dont **la source
  désactivée à la main qui n'est jamais réactivée**), et le proxy — item non-média, item inconnu,
  asset disparu, et la clé d'API absente de la réponse.

## La suppression (CC-63)

- `tests/functional/modules/veille_deletion.spec.ts` — le test qui porte le lot est **« un article
  supprimé ne revient pas à la collecte suivante »** : le faux flux republie les mêmes entrées, et
  sans pierre tombale la seconde passe les réinsère. Vérifié mordant — remplace le marquage par un
  vrai `delete()` et il rougit, avec quatre autres. Puis les deux garde-fous d'Immich : **un échec
  ne marque rien**, et **`trashDays: 0` n'émet même pas l'appel** — l'assertion qui porte ce dernier
  est `trashed` vide, pas `deletedAt` nul, parce que « rien en base » serait aussi vrai si l'appel
  partait et échouait. Plus **un test par lecture** (liste · compteurs · tags · recherche ·
  pagination · type/source · proxy de vignette), la réconciliation qui ignore les supprimés, l'asset
  revenu dans l'album qui ne ressuscite rien, la sélection mixte dont seuls les articles partent,
  l'idempotence du double-clic, Immich retiré de la configuration, **la page vidée qui recule sans
  perdre le filtre**, le clic sans effet qui le dit, et le plafond de 200 ids qui refuse **le lot
  entier**.
- `tests/unit/veille_item_selection.spec.ts` — la logique de sélection sortie d'`index.vue`. Le test
  qui compte est **la confirmation qui annonce le nombre d'assets partant à la corbeille** : sans ce
  nombre, le dialogue laisserait croire qu'on ne touche qu'à Command Center. Plus le résumé qui ne
  compte que les items **affichés** (une sélection survivant à un changement de page annoncerait un
  nombre invérifiable), et le silence sur Immich quand aucun média n'est concerné — un avertissement
  affiché à tort ne se lit plus quand il compte. ⚠️ Ce qu'il ne voit **pas** : le template, les
  cases, et le `confirm()` lui-même.

## YouTube (CC-84)

- `tests/unit/veille_youtube_config.spec.ts` — **CC-85**, la bascule d'`enabled`. Le cas qui compte
  n'est pas l'absence mais la **chaîne vide** : une ligne `YOUTUBE_API_KEY=` laissée dans `.env`
  n'est pas « absente », et sans le test `!== ''` la source serait provisionnée puis échouerait à
  chaque passe — sans erreur ni ligne à lire, une source qui ne collecte pas n'en produisant
  aucune. Un test fige aussi la décision inverse : une URL collée à la place de l'identifiant n'est
  **pas** rattrapée, et son commentaire dit qu'une chute signifie que la magie a été *ajoutée*.
- `tests/unit/veille_youtube_asset.spec.ts` — **CC-86**, le parsing : du code pur, donc le test qui
  compte du lot. Les deux dates qu'on ne doit pas confondre (`snippet.publishedAt` = ajout à la
  playlist, `contentDetails.videoPublishedAt` = la vidéo), la chaîne de la **vidéo** et non celle du
  propriétaire de la playlist, les vidéos supprimées ou privées **sautées**, la durée ISO 8601 y
  compris au-delà de la journée (`P1DT2H`) et `null` sur le `P0D` d'un direct, le repli de
  miniature, et l'aller-retour de la clé de dédup — dont ce qui **ne rend rien** :
  `immich:<uuid>`, `youtube:pas-un-identifiant`, `../../etc/pw`.
- `tests/unit/veille_youtube_client.spec.ts` — ce que le client fait réellement d'une réponse
  (`fetch` remplacé, aucun réseau). **Le test qui porte le lot : « aucun message d'erreur ne porte
  la clé, sur aucun chemin d'échec »** — huit chemins, parce que l'API Data v3 met sa clé dans
  l'**URL** et que `ImmichClient` compose ses erreurs avec le chemin appelé ; recopier ce patron
  ferait atterrir la clé dans `last_error`, écrite en base et affichée à l'écran. **Vérifié
  mordant** : remets l'URL dans le message de redirection et il rougit en nommant le chemin. Le
  test **symétrique** est là aussi — la clé *doit* partir vers Google, sinon « on retire la clé de
  l'URL » passerait sans rien casser de visible. Plus la pagination, le refus d'un `nextPageToken`
  qui se répète, et **l'appariement des durées par `id`** : le lot du test retire l'élément **du
  milieu**, donc un appariement par position donne à `B` la durée de `C` et l'assertion tombe.
  Depuis **CC-88** : l'URL de vignette **dérivée** (`i.ytimg.com/vi/<id>/mqdefault.jpg` et rien
  d'autre), l'absence de clé vers le CDN, la vignette qui marche encore config vidée, et un
  identifiant malformé qui ne déclenche **aucune requête** — l'assertion porte sur la liste
  d'appels, pas sur le fait que ça lève.
- `tests/unit/veille_source_display.spec.ts` — **CC-89**, le libellé d'une source
  auto-provisionnée, et surtout son **repli** : une provenance sans clé montre son `url` brute
  plutôt que de disparaître. Un troisième test croise les clés rendues avec `i18n/fr.json`.
- `tests/functional/modules/veille_youtube.spec.ts` — la collecte. **« Aiguille sur le collecteur
  YouTube, jamais sur le fetcher de flux »** est le test qui porte le lot, et il asserte que le
  faux fetcher n'a reçu **aucun** appel : « la collecte a réussi » ne prouverait rien. **Vérifié
  mordant** : route `'youtube'` vers `collectFeed` et sept tests rougissent, celui-là en tête. Plus
  l'erreur d'API qui **ne marque rien**, la deuxième collecte qui n'ajoute rien, la vidéo retirée
  **puis remise**, la playlist vidée qui se voit (`last_item_count = 0`), la source désactivée à la
  main **jamais réactivée**, et `published_at` figé sur la date d'ajout. Depuis **CC-88** : le proxy
  dans les **deux sens** — un item YouTube atteint le client YouTube, un item Immich ne l'atteint
  pas — et la clé absente de la réponse.

## L'isolation des clients externes (CC-101)

- `tests/unit/env_isolation.spec.ts` — **transverse** : il couvre Immich, YouTube *et* le LLM de
  Leitner, parce que le défaut était dans le mécanisme d'environnement, pas dans un module.
  - ⚠️ **Il fournit lui-même une configuration complète, il ne lit pas le `.env` de la machine.**
    C'est ce qui le rend mordant partout : une spec qui se contenterait d'assertir
    `immichConfig.enabled === false` serait verte sur un poste au `.env` vide **même sans garde** —
    elle prouverait l'absence de configuration, pas l'isolation.
  - ⚠️ **Il appelle les `*ConfigFrom` des `config/*.ts`**, jamais une recomposition locale de
    `externalServicesIsolated` et `normalize*`. Recomposer prouverait l'expression de la spec :
    retirer la garde d'un `config/*.ts` la laisserait verte.
  - ⚠️ **Le contre-test compte autant que le test.** « Hors test, le même environnement configure
    bien les trois clients » attrape une garde qui désactiverait *toujours* — laquelle passerait
    l'assertion principale sans broncher et casserait la collecte en production en silence.
  - **Vérifié mordant, quatre fois** : garde retirée d'`immichConfigFrom`, de `youtubeConfigFrom`,
    de `llmConfigFrom`, puis rendue inconditionnelle — la spec rougit à chaque fois, en nommant le
    client concerné.
  - Le quatrième test (les singletons sont inertes) est le **seul dont la morsure dépend de la
    machine** : il vérifie le câblage `env.get('NODE_ENV')` → `*ConfigFrom`, pas la garde.

## Les pages (test de composant)

- `app/modules/veille/pages/__tests__/index.spec.ts` — **CC-92**, le seul test de composant du
  module. Il prouve la pluralisation i18n de la barre de sélection (« 1 sélectionné » / « 2
  sélectionnés », idem pour les médias) sur le **geste réel** : `selected` démarre vide, la barre
  est absente, donc le test coche des items avant d'assertir — monter puis lire ne prouverait rien.
  Une forme de pluriel fausse rendrait « 1 sélectionnés » et le fait rougir ; son instance i18n
  embarque le namespace `veille`, sans quoi `t()` rendrait la clé brute. ⚠️ Ce qu'il ne voit
  **pas** : le rendu visuel (jsdom ne fait aucun layout), et les autres libellés — vérifiés au
  navigateur.
  - Depuis **CC-103**, le **nom de chaîne et son séparateur**. `channelLabel` est prouvée à part,
    mais elle ne dit rien du template : c'est le `<template v-if>` qui décide que le `·` disparaît
    avec le nom, et **ce test est le seul endroit où ça se prouve**.
  - ⚠️ **L'assertion découpe la ligne sur ses séparateurs et compare la liste des segments**, plutôt
    que de chercher le nom : chercher « Alex so yes » passerait aussi bien avec une puce en trop.
    **Vérifié mordant** — le séparateur sorti du `v-if`, deux tests rendent `['Vidéo', '']`.
  - ⚠️ **La date est retirée des segments, volontairement** : elle est formatée dans le fuseau de la
    machine, donc `2026-01-01T00:00:00Z` se lit « 01 janv. » ici et « 31 déc. » à l'ouest de
    Greenwich. L'asserter rendrait le test dépendant du poste, pour une valeur que ce lot ne touche
    pas.
