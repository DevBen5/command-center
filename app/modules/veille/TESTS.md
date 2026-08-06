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
  - Depuis **CC-105**, le filtre par source dans ses **trois** états : ses items, « Sans source »
    qui ne rend que les détachés, **et** une valeur inexploitable qui rend la liste complète
    plutôt que rien. Plus « Sans source » **à travers la pagination** — 60 détachés, donc le cas
    où une sentinelle mal transportée d'une page à l'autre se voit.
  - Depuis **CC-104**, « chaque item annonce sa provenance » : les **trois** cas dans la MÊME
    liste, ce qui attrape une dérivation qui rendrait le même verdict pour tout le monde. Et « le
    `kind` de chaque source descend jusqu'à la page », qui tient le seul porteur de la couleur des
    pastilles — une sélection de colonnes ajoutée pour alléger la charge utile les ferait toutes
    tomber sur le repli neutre, ce qui ressemble à une décision de style.
  - Depuis **CC-21**, la capture qui **pose** enfin des tags, le tag mal formé **refusé et pas
    corrigé en silence**, et la capture sans tags qui reste valide. ⚠️ Le test du refus porte
    `.accept('json')` **et** `.redirects(0)` (lignes 518-522) : sans le premier un refus redirige
    et devient indiscernable d'un succès, sans le second supertest suit le 302 et le test rougit
    en **403** — rouge pour la mauvaise raison.
  - Depuis **CC-111**, ce que la charge utile **ne** porte **pas** : `dedupKey` n'y est plus, et
    `immichAssetId` et `provenance` y sont toujours. ⚠️ Les deux moitiés dans le même test, sur le
    même chargement — l'absence seule serait verte sur un `serialize()` cassé de bout en bout.
    Vérifié mordant : retire `serializeAs: null` du modèle et il rougit.
- `tests/unit/veille_item_provenance.spec.ts` — **CC-104**, la dérivation pure. Les deux cas
  orphelins **ne diffèrent que par `text`**, d'où l'assertion sur les deux champs : n'asserter que
  `labelKey` laisserait passer un repli qui perdrait le titre mémorisé. Plus le `kind` qui suit la
  **source** et non le type de l'item, l'identifiant de source introuvable qui retombe sur
  l'orphelin **plutôt que sur le vide**, et une liste de sources vide qui ne fait pas mentir la
  pastille — le cas exact d'un contrôleur qui appellerait la fonction sans lui passer les sources.
  Un second groupe couvre le titre mémorisé lu dans `metadata`, du `jsonb` dont le contenu dépend
  de la version qui a écrit la ligne. ⚠️ Ce qu'il ne voit **pas** : la pastille — ni sa couleur, ni
  sa position, ni le fait qu'elle soit affichée.

## Les filtres

- `tests/unit/veille_source_filter.spec.ts` — **CC-105**, les trois états du filtre par source.
  **LE test du ticket est `'0'`** : `Number('0') || null` valait `null`, donc l'identifiant `0`
  subissait le même silence que la sentinelle — filtre annulé, liste inchangée, rien de levé. Plus
  la sentinelle qui **s'écrit et ne s'approche pas** (`'none '` n'est pas `'none'` : ni
  `startsWith`, ni `trim`), et une valeur inexploitable qui ne filtre rien sans casser.
- `tests/unit/veille_active_filters.spec.ts` — **CC-65**, le rappel des filtres posés.
  ⚠️ **C'est la seule partie testable du lot** : le langage visuel unifié, l'état actif et la
  bordure transparente ne se vérifient qu'au navigateur. Le test qui compte est **le champ
  absent** — `request.input()` rend `undefined`, que `JSON.stringify` supprime de la prop : tout
  test `!== null` côté page y répondait vrai, et une pastille s'affichait pour un filtre que
  personne n'avait posé. Des `null` explicites ne peuvent pas attraper ce cas. Plus l'ordre fixe
  des chips (dérivé de l'ordre d'insertion, donc il régresserait en silence), la source
  introuvable qui affiche son identifiant **plutôt que rien**, les bascules qui se retirent par
  `false` et non `null`, et « tout effacer » qui fusionne les patchs de ce qui est **posé**.
- `tests/unit/veille_filter_selection.spec.ts` — **CC-108**, `isFilterEmpty` et `filterPayload`.
  ⚠️ **`isFilterEmpty` est ce qui remplace le plafond de 200 identifiants de CC-63** : chaque champ
  est testé **isolément**, un test qui n'aurait vérifié que « tout vide » laisserait passer un
  champ oublié dans la garde. Plus la chaîne vide qui ne filtre rien donc n'autorise rien, et la
  charge utile **tout en chaînes** — une seule forme pour deux transports, la query string du
  décompte et le POST Inertia de la suppression.

## Les tags (CC-21)

- `tests/unit/veille_tags.spec.ts` — la forme d'un tag, écrite une fois. ⚠️ **Le mode d'échec gardé
  est muet** : un tag est un libellé affiché **et** un paramètre d'URL, donc `IA` et `ia` feraient
  deux entrées dans la barre et deux filtres qui ne se rejoignent jamais. Le test qui porte le lot
  est **« le validateur ne repasse pas derrière la normalisation »** — `isValidTag` est un point
  fixe de `normalizeTag`, pas une seconde regex : écrites séparément, les deux divergeaient sur
  `'IA'`, que le validateur acceptait alors que la normalisation le refait en `'ia'`. Plus les
  accents **autorisés** (l'absence d'accent en base est un artefact de `networkTagFor`, pas une
  règle), l'espace interne qui devient un tiret sans en empiler, la déduplication (`text[]` n'a
  aucune contrainte), l'**ordre de saisie conservé** — trier réordonnerait les pastilles sous le
  curseur — et le plafond tenu des deux côtés.

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

  ⚠️ **Depuis CC-180, ce fichier instancie la sous-classe de veille, mais une partie de ce qu'il
  prouve — l'assertion de `content-type`, le refus des 3xx, `thumbnail()` — vit dans
  `#core/shared/services/immich_client`, hérité sans surcharge.** C'est donc aussi la couverture
  que le coffre réutilise sans la redupliquer (`app/modules/coffre/TESTS.md`,
  `coffre_media.spec.ts`) : ce fichier reste la seule preuve du transport, pour les deux modules.
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

## Agir sur ce que le filtre désigne (CC-108)

- `tests/functional/modules/veille_filtered_deletion.spec.ts` — le test qui porte le lot est
  **« le filtre envoyé désigne exactement le même ensemble que la liste »**, et l'assertion va dans
  les **deux sens** : ce qui devait partir est parti, ce qui ne devait pas est resté. Un test qui
  n'aurait vérifié qu'un sens serait vert sur une suppression trop large. Plus **le filtre qui
  traverse la pagination** (le geste dépasse les 50 items affichés, c'est tout l'objet du lot),
  **le filtre vide refusé sur les deux routes** — sans lui le bouton devient « vider la veille » —,
  le décompte qui annonce le total **et** les assets Immich concernés, l'idempotence d'un second
  passage, et les deux routes sous la capacité d'écriture **le décompte compris** : masquer un
  bouton n'est pas un droit.
  - Un second groupe couvre **le découpage en lots**. ⚠️ **Aucun test n'insère 200 items** : une
    sous-classe locale (`SmallBatchDeletion`, `batchSize = 2`) abaisse la taille de lot par la
    couture `protected` — sans elle, ni l'enchaînement ni le `break` au premier échec ne seraient
    exercés par quoi que ce soit. Le test qui compte est
    **« un lot en échec arrête tout, et rien n'est marqué »** — rappeler une instance éteinte pour
    chaque lot restant n'a aucune chance d'aboutir, et les non-tentés comptent dans `failed`.

## Les actions groupées (CC-109)

- `tests/unit/veille_bulk_actions.spec.ts` — la liste **fermée** des quatre actions et leur retour.
  ⚠️ **Deux tons, jamais trois** : la suppression en a un troisième parce qu'elle écrit dans
  Immich, celles-ci ne sortent pas de Command Center. Le cas qui compte est **`info` à zéro ligne
  touchée** — il arrive pour de vrai (marquer lu une page déjà lue) et sans lui le geste paraît
  cassé, donc on reclique. Plus un message par action dans les **deux** tons (un libellé partagé du
  genre « fait » ne dirait pas ce qui a été fait), le compte des lignes **réellement** modifiées, et
  son pluriel.
- `tests/functional/modules/veille_bulk_actions.spec.ts` — les quatre `UPDATE`. Le test qui porte le
  lot est **« poser deux fois le même tag ne le double pas »** : `array_append` ne déduplique pas et
  `text[]` n'a aucune contrainte, donc sans la garde `NOT (? = ANY(tags))` la ligne porte `{ia,ia}`
  — deux pastilles identiques et un **double comptage dans la barre de tags**, qui agrège par
  `unnest`. Plus **« marquer lu ne réécrit pas une date de lecture existante »** (`read_at` est un
  timestamp, pas un booléen : la réécriture est invisible à l'écran), le refus d'une action de tag
  **sans tag** (`array_append(tags, NULL)` ferait une pastille vide que le filtre ne retrouve
  jamais), le tag mal formé refusé ici aussi, le geste sans effet qui le dit, et la route sous la
  capacité d'écriture.
  - ⚠️ **« Aucune action ne touche un item supprimé » part, pour chaque action, de l'état que CETTE
    action changerait.** Une première version utilisait un fixture unique (tagué, lu, en file) :
    `queue.add` y était inerte — la garde `reading_queue = false` l'excluait de toute façon — et
    retirer `deleted_at IS NULL` **ne faisait pas rougir le test**. Vérifié en cassant la requête.
  - ⚠️ **Une seconde route a existé, sur le filtre, et est partie avec son interface** : son
    validateur et ses deux tests avec elle. Un chemin d'écriture qu'aucun écran n'atteint est du
    code que personne ne relit.

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
  - ⚠️ **Depuis CC-104, la pastille de provenance ouvre la ligne et ne porte AUCUN séparateur** —
    l'assertion par segments en tient compte, et ses fixtures portent donc une `provenance`. Elle
    est dérivée au serveur, donc **toujours présente** : la page ne la calcule pas et ne peut pas
    s'en passer.
