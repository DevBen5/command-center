# Module Veille — sources · articles collectés · médias Immich · signets · notes

Routes `/veille` et `/veille/sources` · pages Inertia `modules/veille/index` et
`modules/veille/sources` · tables `veille_items`, `veille_sources`.

```
controllers/veille_controller.ts         index (filtres type/tag/source/readingQueue/unread/search
                                         + pagination) · store · toggleQueue · toggleRead
                                         · destroyMany (suppression, simple ou en lot)
controllers/veille_sources_controller.ts index · store · update (activer/désactiver)
                                         · refresh (UNE source, SYNCHRONE) · refreshAll (async)
controllers/veille_media_controller.ts   le PROXY de vignette Immich — réponse HTTP nue, indexée
                                         par l'id d'item, jamais par l'identifiant Immich
services/feed_fetcher.ts                 le seul point qui parle au réseau POUR LES FLUX : garde
                                         SSRF, timeout, plafond, etag/304, redirections revalidées
services/feed_parser.ts                  rss-parser (RSS 2.0 ET Atom) · HTML → texte · URL
                                         canonique · clé de dédup
services/immich_client.ts                le seul point qui parle à IMMICH : pagination, refus des
                                         3xx, ASSERTION DE CONTENT-TYPE, plafonds
services/immich_asset.ts                 PUR · type · durée (deux formes) · tag réseau · clé de
                                         dédup · isImmichAssetId
services/immich_collector.ts             la passe Immich : ensureSource · insert · reconcile
services/veille_item_writer.ts           l'ÉCRITURE des items collectés — l'unique liste de
                                         colonnes et l'unique ON CONFLICT, partagés
services/veille_deletion_service.ts      la SUPPRESSION : corbeille Immich d'abord, pierre
                                         tombale ensuite · refus si trashDays ≤ 0
services/veille_collector_service.ts     une passe : par source, isolée, AIGUILLÉE PAR `kind`
services/veille_scheduler.ts             la boucle en processus (démarrée par le provider)
services/veille_stats_service.ts         les agrégats SQL de la bande d'indicateurs et des tags
models/veille_source.ts                  le robinet · isDue() · kind rss | immich
models/veille_item.ts                    ce qui en sort · types article · bookmark · note · image
                                         · video · unavailableAt · deletedAt + visible()
validators/veille.ts                     captureValidator · sourceValidator · sourceUpdateValidator
                                         + isPublicFeedUrl / isBlockedAddress (GARDE SSRF)
                                         + intervalWithinBounds / resolveIntervalMinutes
                                         + timeOfDay / scheduleFields
shared/interval.ts                       PUR · toMinutes / fromMinutes / unitBounds
                                         + parseTimeOfDay / normalizeTimeOfDay / formatSchedule
                                         partagé par le serveur ET la page Vue
shared/schedule_draft.ts                 PUR · la logique du brouillon de cadence de sources.vue :
                                         isDraftValid / schedulePayload / isScheduleDirty
                                         / switchUnit / boundsHint
shared/media_item.ts                     PUR · la logique média d'index.vue : isMediaItem /
                                         thumbnailHref / immichHref / durationLabel
shared/item_selection.ts                 PUR · la sélection multiple d'index.vue :
                                         toggleSelected / toggleAll / summarizeSelection
                                         / confirmationMessage
```

Route de suppression : `POST /veille/items/delete` (CC-63) — voir « Supprimer ».

⚠️ Ce module touche **sept** fichiers hors de son dossier : `start/routes.ts`,
`providers/veille_provider.ts` (déclaré dans `adonisrc.ts` sous `environment: ['web']`, comme le
provider Leitner), **`config/veille.ts`** (le fuseau des collectes à heure fixe), depuis CC-55
**`config/immich.ts`**, **`start/env.ts`** et **`.env.example`** (les variables de l'instance
Immich), et depuis CC-71 **`start/capabilities.ts`** — la ligne qui enregistre au registre les
capacités listées dans `capabilities.ts`. ⚠️ L'oublier ne casse rien tout de suite : les
capacités n'entrent pas au registre, l'écran d'administration ne les propose plus, personne ne
peut les accorder — et le module devient inaccessible à tout non-admin.
Voir « Le déclenchement » et « Immich ».

## Où vit la logique d'une page — `shared/`, jamais le `<script setup>`

⚠️ **Une fonction qui *décide* ne reste pas dans un `.vue`.** Japa importe des `.ts` et n'a aucun
compilateur Vue : ce qui vit dans un `<script setup>` est **structurellement** hors de portée de la
suite — pas « mal testé », inatteignable. La règle du module (CC-60) :

| ce que fait la fonction | où elle vit |
| --- | --- |
| un prédicat, une dérivation, la forme d'un payload | `shared/*.ts`, testé dans `tests/unit/` |
| appeler `router.post`, ouvrir une modale, piloter un `ref` | dans le `.vue`, c'est sa place |

La page garde alors une **enveloppe d'une ligne** portant le même nom : c'est ce qui laisse le
template inchangé. `isScheduleDirty(source)` reste la signature vue du template ; elle ne fait que
résoudre le brouillon de la ligne avant d'appeler la version prouvée.

⚠️ **Un fichier de `shared/` n'importe JAMAIS par un alias `#modules/*`.** L'alias mappe vers
`./app/modules/*.js`, des fichiers qui n'existent qu'après un build : Vite ne les résout pas, et la
page casse. Seuls le relatif (`./interval.js`) et les paquets npm purs sont permis. Le garde-fou est
**`npm run build`** — `tsc` ne lit pas les `.vue` et ne peut pas le dire. C'est la raison pour
laquelle le build est un gate à part entière sur tout diff qui touche ces fichiers.

⚠️ **L'extraction crée une couture qui n'existait pas** : l'enveloppe. Un module vert et une
enveloppe fausse donnent une page cassée. D'où la règle — l'enveloppe reste d'**une ligne**, et tout
état passé à un module part en **objet nommé** dès qu'il y a plus d'un champ du même type.

## `type` dit ce que c'est, `kind` dit d'où ça vient

C'est le cœur du schéma, et la confusion qu'il existe pour dissiper. Avant CC-54, `veille_items.type`
valait `rss | bookmark | note` : il mélangeait la **provenance** (`rss`) et la **nature**
(`bookmark`, `note`), et imposait une migration par source nouvelle.

- **`veille_sources.kind`** porte la provenance : `rss` (qui couvre RSS 2.0 **et** Atom — même
  collecteur, même parseur) et `immich` depuis CC-55.
- **`veille_items.type`** vaut `article | bookmark | note | image | video`. `rss` a été renommé
  `article` (migration `…191401`), `bookmark` et `note` n'ont pas bougé : **la capture manuelle
  continue d'exister**, elle n'a pas de source et ne doit jamais régresser. `image` et `video`
  (migration `…191403`) sont les assets Immich — un asset n'est pas « un item Immich », c'est une
  image ou une vidéo qui se trouve venir d'Immich.

⚠️ **`type` n'est pas un enum Postgres natif**, malgré le `table.enum()` de la migration d'origine.
Sans `useNative: true`, knex produit une colonne `text` plus une contrainte `CHECK` nommée
`veille_items_type_check`. Ajouter une valeur (`podcast` à un lot suivant) demande donc un
`DROP CONSTRAINT` / `ADD CONSTRAINT`, **pas** un `ALTER TYPE … ADD VALUE`. C'est ce que fait la
migration `…191403`, et c'est le cas de figure que cette section prévoyait depuis le lot 1.

⚠️ **`kind` n'a aucune contrainte en base** — `string(16)` avec un défaut `'rss'` (migration
`…191400`). Ajouter une provenance ne demande donc **pas** de migration. Ce qui est nécessaire, en
revanche, c'est un **aiguillage dans `VeilleCollectorService`** : sans lui, la source part au
`FeedFetcher`, qui va chercher son `url` comme un flux et échoue à chaque passe avec un message
parlant d'URL publique — un faux problème, et le vrai invisible.

⚠️ La liste des types est écrite à **trois** endroits : `VeilleItemType` (modèle), la contrainte
CHECK (migration), `captureValidator` (VineJS). Les trois bougent ensemble — **à une exception,
délibérée** : `captureValidator` ne porte **ni `image` ni `video`**. Ces deux-là ne sont créables
que par une collecte, le formulaire de capture n'ayant aucun moyen de téléverser un média. Les y
autoriser créerait des items média sans asset derrière, dont la vignette n'existerait pas.

## La déduplication — une contrainte en base, jamais un `if`

C'est ce qui tue un agrégateur, pas la performance : sans dédup, la boîte se remplit de doublons et
devient inutilisable en une semaine.

**`veille_items.dedup_key` est sous index UNIQUE** (`veille_items_dedup_key_unique`). C'est la
**première contrainte d'unicité fonctionnelle du dépôt** : Leitner déduplique par check-then-insert
applicatif (`LeitnerCatalogService.createCardUnlessDuplicate`), non atomique — ne prends pas ce
pattern-là pour modèle ici, il ne tient pas contre deux collectes concurrentes.

### La clé part de l'URL, pas du `guid` — et c'est délibéré

L'ordre est **URL canonique d'abord, `guid` en repli**, l'inverse de ce qu'on lit d'habitude
(le ticket CC-54 disait le contraire ; l'écart est assumé et argumenté ici).

Le `guid` est **propre à chaque flux**. Le prendre en premier ne déduplique donc **jamais entre deux
sources** — or c'est le cas le plus fréquent : le même article arrive par le blog, par un agrégateur
et par Hacker News. L'URL couvre **les deux** situations, y compris la republication à titre corrigé
(le `guid` change parfois, l'URL non).

```
url:https://exemple.dev/article        ← le cas normal
guid:<sourceId>:<guid>                 ← entrée sans lien exploitable
title:<sourceId>:<titre normalisé>     ← ni lien ni guid : dégénéré, mais il FAUT une clé
immich:<uuid>                          ← un asset Immich (CC-55)
```

⚠️ **La clé Immich n'est pas cadrée par sa source**, contrairement au `guid` : l'UUID est unique
dans l'instance. Et elle a un **second rôle** — c'est l'index d'autorisation du proxy de vignette.
`dedup_key` étant déjà sous index UNIQUE, « cet asset fait-il partie de la veille ? » est une
recherche exacte et indexée. Le jour où un second module référencerait des assets Immich, c'est
là qu'il faudrait une colonne dédiée plutôt qu'un second préfixe.

Le préfixe empêche un `guid` qui ressemble à une URL de collisionner avec une vraie URL. Le `guid` et
le titre sont cadrés par leur source : ils ne sont uniques qu'à l'intérieur d'un flux.

Le dernier repli n'est pas cosmétique : **sans clé, l'entrée serait réinsérée à chaque passe** et
remplirait la boîte toute seule.

⚠️ **`dedup_key` est NULL pour les captures manuelles**, et c'est ce qui les protège : Postgres
autorise autant de NULL qu'on veut dans un index unique. Deux signets vers la même URL restent deux
signets — c'est un geste délibéré de l'utilisateur, pas un doublon de collecte.

`canonicalizeUrl` retire ce qui ne désigne pas un autre article : schéma forcé en `https`, `www.`
retiré, casse de l'hôte, slash final, fragment, paramètres de campagne (`utm_*`, `fbclid`, `gclid`…),
et **trie les paramètres restants** (`?a=1&b=2` et `?b=2&a=1` sont la même page).

### Les deux niveaux, et pourquoi les deux

- Un **`Set` en mémoire** élimine les répétitions *à l'intérieur d'une passe* (un flux qui liste deux
  fois la même entrée — le cas est réel avec les paramètres de campagne).
- **`ON CONFLICT (dedup_key) DO NOTHING`** tranche *contre la base*, y compris entre deux collectes
  concurrentes (un rafraîchissement manuel pendant un tick automatique). Un `if` applicatif ne les
  couvrirait pas : les deux lisent avant que l'une n'écrive.

Le compte d'items réellement écrits vient du `RETURNING id` — les doublons ignorés n'y sont pas.

## Le collecteur

### `etag` / `304` — le mode d'échec silencieux n° 1

⚠️ **`etag` et `last_modified` ne sont écrits qu'APRÈS l'insertion réussie des items**, dans la même
écriture que `last_fetched_at`. Les mémoriser dès la réponse HTTP puis échouer (parse, insert, base
coupée) ferait recevoir un `304` à la passe suivante : les entrées seraient sautées
**définitivement**, et le flux ne les republiera pas. L'accusé de réception vient après l'effet,
jamais avant. Le test qui le tient est « un échec APRÈS la réponse HTTP ne mémorise pas l'etag ».

Un échec ne touche donc **pas** `etag` : la passe suivante redemande conditionnellement à partir du
dernier état réellement collecté.

### Un flux cassé ne casse pas la collecte

`collectSource` **ne lève jamais** : elle rend un `CollectOutcome` en échec. `collectAll` /
`collectDue` passent par `Promise.allSettled`, par vagues de 4. Un flux mort, un XML illisible et un
timeout ne retirent rien aux flux sains.

L'erreur part dans `last_error` + `last_error_at`, **affichée telle quelle** sur la source (même
doctrine que `leitner_ingestions.error`). Un flux mort qui échoue en silence est le mode de panne le
plus courant d'un agrégateur : au bout d'un mois, on croit que le sujet est calme.

⚠️ **`last_fetched_at` bouge aussi en cas d'échec.** Sans ça, la source reste éternellement « due »
et on martèle un serveur en panne à chaque tick.

### Le flux qui « marche » et ne rend rien

200 + XML valide + **zéro entrée reconnue** n'est pas une erreur : `last_error` reste nul, et la
source *paraît saine*. C'est le même mode de panne, sous une autre forme. D'où **`last_item_count`**,
et un bandeau explicite sur l'écran des sources quand il vaut `0`.

### Sécurité — les trois points à ne pas régresser

**1. La garde SSRF, miroir inverse de celle du LLM.** `isLocalLlmUrl` (Leitner) n'accepte **que** le
local ; `isPublicFeedUrl` (ici) le **refuse**. Sont rejetés : tout ce qui n'est pas http(s), les
identifiants dans l'URL (`http://flux.exemple.dev@169.254.169.254/`), le loopback, les plages privées
(`10/8`, `172.16/12`, `192.168/16`, `100.64/10`), le lien-local (`169.254/16`, dont
`169.254.169.254`), l'IPv6 équivalent (`::1`, `fc00::/7`, `fe80::/10`, `::ffff:127.0.0.1`), et les
noms qui ne désignent jamais un service public (`localhost`, `*.local`, `*.internal`, **et tout nom
sans point** — un flux public a toujours un domaine).

La comparaison porte sur `url.hostname`, **normalisé par le parseur** : `0x7f000001`, `2130706433` et
`127.1` y arrivent tous en `127.0.0.1`.

⚠️ **Contrairement à Leitner, on ne peut pas refuser les noms de domaine** — un flux RSS *est* un nom
de domaine. `feed_fetcher` résout donc le nom (`dns.lookup`) et refuse dès qu'**une** des adresses
rendues est interdite.

⚠️ **Le DNS rebinding n'est pas couvert, et c'est assumé.** La résolution du `fetch` est une
**seconde** résolution : un DNS hostile peut répondre autrement que lors de notre contrôle. Le
contrer demanderait de figer l'IP via un dispatcher undici sur mesure — disproportionné pour un
tableau de bord mono-utilisateur où celui qui saisit les URL est celui qu'on protège. C'est la limite
réelle du lot ; ne la fais pas passer pour couverte.

**2. Les redirections sont suivies, jamais aveuglément.** `redirect: 'manual'`, **3 sauts maximum, et
chaque `Location` repasse la garde en entier**. C'est le vrai vecteur : l'utilisateur saisit une URL
publique, mais c'est le **serveur distant** qui choisit la redirection.

⚠️ **On ne refuse pas les 3xx en bloc**, contrairement au client LLM — un serveur compatible OpenAI
n'a aucune redirection légitime, un flux RSS en a constamment (http→https, domaine changé,
FeedBurner). Refuser sec casserait des flux honnêtes.

Le test est `tests/unit/veille_feed_redirect.spec.ts` — **le seul du module qui fasse émettre une
vraie requête**, inévitable puisque le faux fetcher ne fait pas de réseau. ⚠️ **La cible rend un flux
VALIDE, et c'est ce qui fait le test** : si `redirect: 'manual'` disparaissait, undici suivrait tout
seul et `fetch()` **réussirait**. L'assertion qui porte le test est donc `hits === 0` sur la cible,
pas l'exception.

⚠️ `assertReachableTarget` est **`protected`, pas `private`** : c'est une couture de test, et elle
est nécessaire — la garde refuse le loopback, donc un serveur jetable sur `127.0.0.1` serait rejeté
avant toute requête et la mécanique des redirections resterait sans preuve. Le test l'assouplit pour
le **premier saut seulement**. Ne l'assouplis jamais dans le code de production.

**3. Le HTML des flux n'est jamais stocké — seulement du texte.** `htmlToText` passe par
`sanitize-html` en `allowedTags: []`. On ne garde aucune balise : il devient **impossible** qu'un
`v-html` posé plus tard rouvre la faille, et `search_vector` indexe du texte au lieu de mots-clés
HTML.

⚠️ **L'invariant est que le texte stocké ne contient jamais `<` ni `>`**, et il est vérifié par un
test. `sanitize-html` décode les entités mais ré-échappe `&` et `<` ; on redécode **en une seule
passe** celles qui ne peuvent pas reformer de balise (`&amp;`, `&quot;`, `&apos;`, `&#39;`,
`&nbsp;`). Une seconde passe ferait de `&amp;lt;` un `<` — c'est exactement le bug que le `replace`
unique évite.

⚠️ **N'utilise pas `contentSnippet` de rss-parser** : son `stripHtml` est une regex qui laisse le
**corps** d'un `<script>` dans le texte. `sanitize-html` le supprime.

**4. Deux plafonds.** Timeout de 10 s par flux (`AbortSignal.timeout`, une seule échéance pour toute
l'opération, redirections comprises) et **5 Mo** de corps. Sans le second, une réponse géante emporte
le processus, et l'agrégateur avec.

⚠️ **`rss-parser` sait télécharger tout seul (`parseURL`) : ne l'utilise JAMAIS.** Sa méthode réseau
contourne toute cette garde et suit les redirections sans rien vérifier. Le parseur ne voit que du
XML déjà rapatrié par `feed_fetcher`. On n'appelle que `parseString`.

## Immich — les vidéos du téléphone (CC-55)

**Relevé contre une instance v2.6.1.** Ce n'est pas une note de version : c'est la seule chose qui
empêche ce connecteur d'être écrit de mémoire. L'API d'Immich a connu des ruptures (`/api/asset` →
`/api/assets` vers la v1.106), et la majeure est passée à **2**. Avant de toucher au client,
relève la version réelle — `GET /api/server/about` — plutôt que de faire confiance à ce fichier.

Les quatre formes réellement observées, et qui ne se devinent pas :

| | ce que rend l'instance |
|---|---|
| liste paginée | `POST /api/search/metadata` `{albumIds, page, size}` → `assets.items` + `assets.nextPage` |
| vignette | `GET /api/assets/:id/thumbnail?size=thumbnail` → `image/webp` (~20 Ko) ; `size=preview` → `image/jpeg` (~290 Ko) |
| album ou asset inconnu | **HTTP 400**, pas 404 (`"Not found or no asset.read access"`) |
| durée | `"00:01:04.362"` sur une vidéo, `"0:00:00.00000"` sur une image — **deux formes** |

⚠️ **`nextPage` est une chaîne (`"2"`), pas un nombre.** Un `typeof === 'number'` arrêterait la
pagination à la première page — en silence, et l'album paraîtrait tronqué : tous les assets des
pages suivantes seraient marqués « plus dans l'album ».

⚠️ **`search/metadata` ne rend pas `exifInfo`** (contrairement à `/albums/:id`). C'est gratuit et
bienvenu : aucune coordonnée GPS, aucune ville ne transite ni ne se stocke. À garder en tête au
lot 3, quand ces items partiront vers un LLM.

### Référencer, ne jamais copier

**Immich possède les octets, Command Center possède le sens.** On stocke l'identifiant de l'asset
et ce que le module produit lui-même : titre, tags, et le résumé au lot suivant. C'est ce qui fait
**disparaître** un problème au lieu de le déplacer — `npm run db:backup` ne dumpe que du SQL, il
n'aurait jamais emporté des dizaines de Go de vidéos. Ne « simplifie » jamais ça en rapatriant les
fichiers.

⚠️ **Le proxy de vignette n'est pas une copie** : les octets traversent le serveur et sont oubliés
— rien sur le disque, rien en base.

### Le mode d'échec n° 1 : un 200 qui ment

⚠️ **Immich sert son interface web en repli sur tout chemin inconnu.** Une route d'API disparue ne
rend pas une 404 : elle rend **200 avec du `text/html`**. Constaté, pas déduit — un slash final de
trop dans `IMMICH_BASE_URL` suffit à le produire (`<base>//api/...`).

Sans contrôle, la chaîne est : statut OK → `assets` vaut `undefined` → album vide → **la
réconciliation marque tout l'album « plus dans l'album »**. Une passe suffit à vider la veille, et
rien à l'écran ne dit que c'est faux. D'où **deux** gardes, et il faut les deux :

1. `config/immich.ts` retire le slash final (`.replace(/\/+$/, '')`), comme `config/llm.ts` ;
2. `ImmichClient` **vérifie le `content-type`** — `application/json` sur l'API, `image/` sur une
   vignette. Le test qui le tient est « un 200 en text/html est une erreur explicite ».

### Le marquage des disparus : tout ou rien, jamais partiel

`reconcile()` calcule une **différence** entre ce que l'album contient et ce que la base porte. La
propriété qui la rend sûre n'est pas dans `reconcile()` mais dans `ImmichClient.albumAssets()` :
**une page en échec fait lever, et aucune liste partielle n'est jamais rendue**. Une page 2 en
timeout, une clé révoquée en cours de pagination, une réponse HTML — dans les trois cas
`reconcile()` n'est simplement pas atteint.

⚠️ **Ne mets jamais un `try/catch` autour de `albumAssets()` dans le collecteur.** C'est
exactement le geste qui rouvre la panne : la passe paraîtrait réussir, et marquerait tout. Le test
qui l'interdit est « une erreur d'API ne marque AUCUN asset disparu » — il rougit dès qu'on avale
l'erreur, c'est vérifié.

La réconciliation va dans les **deux sens** : un asset remis dans l'album redevient normal. Sans
ce retour, une sortie accidentelle serait définitive et il faudrait passer par la base.

⚠️ **« Plus dans l'album » n'est pas « supprimé », et l'écran dit le premier.** La différence ne
distingue pas un asset retiré de l'album d'un asset effacé d'Immich, et **ne le prétend pas** : les
distinguer demanderait un appel par disparu, dont le 400 signifie aussi « pas d'accès ». La vraie
suppression se révèle ailleurs — le proxy rend 404, et l'image casse à l'écran.

⚠️ **Un album réellement vidé marque tout**, et c'est correct. Ce qui empêche que ce soit
silencieux est le compteur du lot 1 : `last_item_count = 0` déclenche le bandeau d'anomalie. Une
*erreur*, elle, n'arrive jamais jusque-là.

### La configuration — `.env`, et une ligne qui n'en est que le reflet

`IMMICH_BASE_URL`, `IMMICH_API_KEY`, `IMMICH_ALBUM_ID`, `IMMICH_TIMEOUT_MS` → `config/immich.ts`,
sur le modèle exact de `config/llm.ts`. **Jamais un formulaire, jamais la base** : une URL de
serveur persistée depuis une requête HTTP est une SSRF permanente, écrite une fois et rejouée à
chaque collecte.

⚠️ **`IMMICH_ALBUM_ID` désigne UN album, jamais la bibliothèque.** Elle contient des photos
personnelles, et au lot 3 elles partiraient vers un LLM. Le filtre est chez l'utilisateur, dans
Immich : il dépose dans l'album ce qui relève de la veille. Aucun réglage à inventer ici.

`ImmichCollector.ensureSource()` (appelé par `providers/veille_provider.ts` au boot) crée la ligne
`veille_sources` correspondante — `kind: 'immich'`, `url: immich:album:<uuid>`. Elle existe pour que
la collecte Immich **hérite de tout ce que le lot 1 a construit** : cadence, `last_fetched_at`,
`last_error`, `last_item_count`, rafraîchissement manuel, affichage sur l'écran des sources. Sans
elle, « une erreur d'API ne passe pas en silence » n'aurait aucun endroit où s'afficher.

⚠️ **Cette ligne n'est créable par aucun formulaire** : `sourceValidator` impose `isPublicFeedUrl`,
qui refuse `immich:album:…` — ce n'est même pas une URL http. Son `url` n'est donc jamais une cible
réseau, et le collecteur ne la lit pas : il lit la configuration.

⚠️ **La réactivation est conditionnée à un marqueur exact** (`DISABLED_BY_CONFIG`). Sans lui, il
faudrait choisir entre deux mauvaises options : réactiver à chaque démarrage — et voir la collecte
repartir toute seule après une désactivation volontaire — ou ne jamais réactiver, et laisser la
source muette après une correction de `.env`, sans dire pourquoi.

⚠️ **Changer `IMMICH_ALBUM_ID` marque tous les items de l'ancien album en une passe.** Défendable
(ils n'en font plus partie), mais surprenant : c'est journalisé, et réversible.

### Le proxy de vignette — la décision de sécurité du lot

`GET /veille/items/:id/thumbnail` — **le paramètre est l'id d'item de notre base, jamais
l'identifiant Immich.** Ce n'est pas un détail d'implémentation :

- une route `/veille/immich/:assetId/thumbnail` serait un **proxy de lecture ouvert sur toute la
  bibliothèque personnelle** — n'importe quel asset, photos de famille comprises, servi par un
  serveur qui porte la clé d'API. Le paramètre *étant* l'identifiant Immich, il n'y aurait rien à
  vérifier contre quoi que ce soit ;
- ici le seul paramètre venu du client est un **entier**. L'UUID est relu dans `dedup_key` — une
  valeur que nous avons écrite — et l'autorisation est un effet de bord de la recherche : ce qui
  n'est pas dans la table n'est pas servi.

⚠️ **`IMMICH_API_KEY` ne repart jamais vers le client**, exactement comme `LLM_API_KEY`. La page
reçoit `{ configured, webBaseUrl }` — `webBaseUrl` **doit** descendre (c'est le navigateur qui
ouvrira le lien), la clé jamais.

⚠️ **Réponse HTTP nue, pas de l'Inertia** (comme l'export JSON de Leitner) : côté page c'est un
`<img src>` natif, jamais `<Link>` ni `router.get()`.

⚠️ **Un échec rend 404 au navigateur mais `logger.warn` côté serveur.** Sans ce log, « Immich
éteint », « clé révoquée » et « asset supprimé » sont indiscernables — et le premier réflexe est
d'accuser le proxy.

### Ce qui n'a PAS été fait, et pourquoi

⚠️ **La garde SSRF de Leitner n'est pas extraite, contrairement à ce que demandait CC-55.** Le
ticket supposait Immich « sur le réseau local » et `isLocalLlmUrl` comme « exactement la bonne
forme ». **C'est faux contre l'instance réelle**, qui répond en `https` sur un nom de domaine
public : `isLocalLlmUrl` n'accepte que `localhost` et les IP littérales privées, et la refuserait.

Et le besoin lui-même n'existe pas. La liste blanche de Leitner protège un écran qui teste des URL
**saisies** ; ici **aucune URL ne vient jamais d'une requête HTTP** — l'hôte est figé par `.env`,
l'album aussi, l'identifiant d'asset est relu de notre base. Il n'y a pas de cible à filtrer, il
n'y a qu'une cible. Ce qui la remplace, et qui est réellement nécessaire :

1. **refus des 3xx** (`redirect: 'manual'`) — comme le client LLM, contrairement au collecteur RSS.
   Une API n'a aucune redirection légitime, et suivre un `Location` ferait sortir de l'hôte
   configuré **avec la clé d'API dans les en-têtes** ;
2. l'assertion de `content-type` ci-dessus ;
3. deux plafonds (16 Mo de JSON, 10 Mo de vignette), un timeout, et un plafond de **pages** — un
   `nextPage` qui n'avancerait pas ferait tourner la collecte indéfiniment.

**Le lecteur vidéo est hors périmètre** : un clic ouvre l'asset dans Immich, qui gère déjà lecteur,
seek et transcodage. Aucun flux vidéo ne traverse Command Center — seulement des vignettes de 20 Ko.

⚠️ **`/photos/<id>` est la seule chose de ce lot qui n'ait pas pu être vérifiée par l'API.** Immich
sert son interface en repli sur *tout* chemin, avec un 200 et un corps identique : aucune requête
ne distingue une route web valide d'une route morte. Ça se vérifie au navigateur, en cliquant une
vignette — et nulle part ailleurs.

## Supprimer — la pierre tombale, et la corbeille d'Immich (CC-63)

Deux gestes derrière un seul bouton : un article n'a que Command Center derrière lui, une image ou
une vidéo a un asset Immich. Le second est celui qui demande du soin.

### `deleted_at`, parce qu'une vraie suppression fait revenir l'item

⚠️ **Supprimer la ligne ne supprimerait rien.** La collecte écrit avec
`ON CONFLICT (dedup_key) DO NOTHING`, et c'est cette clé — elle seule — qui empêche un doublon.
Ligne supprimée = clé libérée = **la passe suivante réinsère l'item**. Un flux publie ses 10 à 50
dernières entrées en permanence : un article supprimé reviendrait dans l'heure, un asset tant qu'il
est dans l'album. Le bouton *paraîtrait* marcher, et l'item réapparaîtrait plus tard sans que rien
ne relie les deux.

La suppression est donc **logique** : la ligne reste, `deleted_at` la masque, le collecteur ne
change pas d'une ligne. L'alternative — une table de pierres tombales et une vraie suppression —
éviterait le filtre partout mais imposerait une anti-jointure à l'insertion, dans le seul endroit
du module où la déduplication est tranchée. **Le filtre est plus sûr que la jointure** : un filtre
oublié se voit à l'écran, une anti-jointure ratée fait revenir les items en silence.

⚠️ **`deleted_at` n'est pas `unavailable_at`, et les deux coexistent.** `unavailable_at` est un
**constat** de la collecte (« plus dans l'album »), réversible tout seul. `deleted_at` est une
**décision de l'utilisateur**, que rien dans la collecte ne défait. Les fusionner ferait qu'un asset
remis dans l'album ressusciterait un item volontairement supprimé.

### Le prix, et il se paie partout à la fois

⚠️ **Toute lecture filtre `deleted_at IS NULL`.** Un seul oubli et les supprimés remontent. Voici la
liste **complète** — tiens-la à jour en même temps que le code :

| endroit | comment |
|---|---|
| `VeilleController.index` (liste, recherche, tags, pagination, filtres) | `VeilleItem.visible()` |
| `VeilleController.toggleQueue` / `toggleRead` | `VeilleItem.visible()` |
| `VeilleMediaController.thumbnail` | `VeilleItem.visible()` |
| `VeilleStatsService.fetchStats` | `WHERE deleted_at IS NULL` en clair |
| `VeilleStatsService.fetchTags` | `WHERE deleted_at IS NULL` en clair |
| `ImmichCollector.reconcile` — marquage **et** rétablissement | `.whereNull('deleted_at')` |

`VeilleItem.visible()` existe pour que « toutes les lectures filtrent-elles ? » ait une réponse
**greppable**. Les lectures en SQL brut ne passent pas par là et portent le filtre en clair.

⚠️ **Chacun de ces endroits a son propre test**, et ils ont été vérifiés mordants un par un : casse
un filtre, un seul test rougit, et c'est le sien. Cinq de ces tests se ressemblent assez pour qu'un
faux-positif y passe inaperçu — ne les allège pas.

### L'ordre des opérations : Immich d'abord, la base ensuite

La fenêtre entre les deux écritures n'est **pas symétrique**, et c'est ce qui fixe l'ordre :

- **Immich puis la base.** Un crash entre les deux laisse un asset à la corbeille et un item encore
  visible : la passe suivante le marque « plus dans l'album », l'utilisateur resupprime. Visible,
  rattrapable.
- **L'inverse** laisserait un item marqué supprimé et un asset toujours dans l'album — pour
  toujours, alors que l'utilisateur croit l'avoir supprimé. Silencieux.

⚠️ **Un échec côté Immich ne marque RIEN en base.** C'est ce qui produit l'invariant du lot :
*une ligne marquée supprimée = un asset réellement à la corbeille*.

⚠️ **Un raccourci a été écarté, ne le réintroduis pas** : sauter l'appel Immich pour un item déjà
`unavailable_at`. Ça adoucirait le rattrapage, mais un asset seulement *sorti de l'album* resterait
dans la bibliothèque pendant que l'utilisateur le croit supprimé — exactement la divergence que
l'ordre existe pour empêcher. Un média passe **toujours** par Immich.

**Le partiel est assumé** : les items sans asset (article, signet, note) partent même quand Immich
échoue. Ils n'ont aucune dépendance externe, rien ne peut diverger, et un tout-ou-rien les punirait
pour une panne qui ne les regarde pas.

### `trashDays` — le seul filet, vérifié à chaque fois

`DELETE /api/assets` en **`force: false`** envoie à la corbeille… *si la corbeille est activée*.
Sur une instance à `trashDays: 0`, le même appel **détruit immédiatement** — et Command Center n'a
aucune copie des octets. `ImmichClient.trashDays()` lit `GET /api/server/config` **avant chaque
suppression**, jamais au démarrage : une valeur mise en cache devient fausse si la corbeille est
désactivée pendant que le serveur tourne, et cette fausseté-là est irréversible.

⚠️ **La règle échoue fermée** : champ absent, renommé, ou rendu en chaîne → `0` → refus. Refuser ne
coûte qu'un message ; laisser passer est définitif.

⚠️ **`force: true` n'existe nulle part** — pas de paramètre, pas de réglage, pas de surcharge. Le
test qui lit le corps réellement émis est ce qui l'interdit ; il rougit dès qu'on ajoute une option
pour « forcer quand c'est vraiment voulu ».

⚠️ **`GET /api/server/config` est une route publique** côté Immich (aucun `@Authenticated`) : elle
marche même avec une clé réduite au strict nécessaire.

⚠️ **La réponse est un 204 sans corps**, d'où un chemin qui ne passe pas par le lecteur JSON. Y
passer ferait échouer l'assertion de `content-type` sur un appel **réussi** : les assets partiraient
à la corbeille, le code lèverait, rien ne serait marqué — la suppression paraîtrait échouer à chaque
clic tout en ayant lieu à chaque fois.

### Les permissions de la clé d'API — relevées, pas devinées

Ce lot fait passer Command Center **en écriture** sur Immich. La clé doit donc être réduite au
strict nécessaire — et la liste exacte se relève, comme les routes de CC-55 :

| appel du module | route | permission |
|---|---|---|
| `serverVersion()` — **avant chaque passe** | `GET /api/server/about` | `server.about` |
| `albumAssets()` | `POST /api/search/metadata` | `asset.read` |
| proxy de vignette | `GET /api/assets/:id/thumbnail` | `asset.view` |
| corbeille | `DELETE /api/assets` | `asset.delete` |
| `trashDays()` | `GET /api/server/config` | **aucune — route publique** |

⚠️ **`album.read` n'est PAS nécessaire** : aucune route `/api/albums` n'est appelée, le filtrage
passe par `albumIds` dans `search/metadata`. Le ticket CC-63 le demandait — c'était faux.

⚠️ **`server.about` est indispensable**, et c'est le piège : `ImmichCollector.collect()` l'appelle
en **première ligne** de chaque passe. Une clé réduite sans lui prend un 401 avant tout, et la
collecte s'éteint entièrement — avec un message qui ressemble à « Immich est éteint ».

⚠️ Relevé contre le dépôt `immich-app/immich` (branche `main`), pas contre la v2.6.1 exactement.
L'UI de l'instance fait foi.

### La suppression en lot, et ce qui la borne

Le besoin est de **vider**, pas d'enlever un item à la fois. Ce module est fait de contenu
**collecté** — reconstructible par une passe — dont le problème est l'accumulation ; c'est ce qui
rend le geste en lot justifié ici. Ce qui le borne :

- **confirmation obligatoire**, et elle annonce **combien d'assets partent à la corbeille d'Immich**,
  pas seulement combien de lignes disparaissent. Le message est construit par
  `confirmationMessage` (`shared/item_selection.ts`), donc testé ;
- **pas de « tout sélectionner » inter-pages** : le rayon d'action reste les 50 items sous les yeux ;
- **plafond de 200 ids** au validateur, qu'un client forgé ne contourne pas ;
- **idempotence** par le filtre `deleted_at IS NULL` : un double-clic ne rappelle pas Immich.

**Le retour à l'écran, trois tons et jamais le silence.** Succès, échec Immich (message **tel
quel** — « instance éteinte », « clé sans `asset.delete` » et « asset inconnu » doivent rester
distinguables), et **`info` quand rien n'a été supprimé**. Ce dernier cas arrive pour de vrai : un
second onglet resté sur une liste périmée, ou un rejeu de requête. Sans message, le bouton paraît
cassé — et le réflexe est de recliquer, ce qui ne changera rien non plus.

⚠️ **Sur un 400 portant plusieurs assets, le message dit quoi faire** : réessayer par plus petits
lots. On ne sait pas si Immich plafonne la taille d'un lot (non vérifiable sans l'instance), et un
400 vaut aussi pour un asset inconnu. Réessayer plus petit tranche entre les deux — un message
qu'on ne peut pas suivre revient à ne rien dire.

### Ce que ce lot ne fait pas

- **Aucune vue « corbeille » côté Command Center**, aucune restauration. La vraie corbeille est
  celle d'Immich pour un média ; un article est reconstructible par nature.
- ⚠️ **Restaurer un asset depuis la corbeille d'Immich ne fait PAS revenir l'item.** La
  réconciliation ignore les supprimés dans les deux sens — sans quoi une mécanique de fond
  déferait une décision de l'utilisateur. Les 30 jours récupèrent les octets, pas la ligne :
  la rétablir demande de passer par la base. C'est la limite réelle du lot, et elle a son test.
- **Aucune suppression de source.** ⚠️ Si elle était ajoutée un jour : la FK est
  `ON DELETE SET NULL`, donc les items perdraient leur source et deviendraient irréconciliables —
  leur clé `immich:` bloquerait toute réinsertion.

## Le déclenchement — une boucle en processus, pas une file

Ce projet n'a **aucune infrastructure de job**, et le lot 1 n'en introduit pas. Comme l'ingestion
Leitner : une tâche de fond dans le processus, démarrée par un provider sous `environment: ['web']`
(ni `node ace`, ni les tests n'ont de collecte à faire tourner).

`veille_scheduler` regarde **toutes les minutes quelles sources sont dues** — il ne collecte pas tout
à chaque tick. La cadence réelle est portée source par source (`fetch_interval_minutes`, ou l'heure
du jour en mode horaire), et une source jamais collectée est due immédiatement
(`VeilleSource.isDue`).

⚠️ **Différence assumée avec Leitner : aucun statut « en cours » n'est persisté**, donc **rien à
balayer au démarrage**. Un redémarrage en pleine passe ne laisse rien de sale : la collecte est
idempotente par construction (contrainte d'unicité), elle est simplement rejouée au tick suivant. Un
`sweepInterrupted` ici serait du code sans objet — ne l'ajoute pas par symétrie.

⚠️ **La garde anti-chevauchement (`running`) vit en mémoire : elle suppose une seule instance.** À
plusieurs, deux processus feraient le travail en double — sans rien corrompre pour autant : c'est la
**contrainte d'unicité en base** qui garantit l'absence de doublon, jamais ce booléen.

⚠️ **`timer.unref()`** — sans lui, le timer suffit à retenir le processus.

### La cadence : stockée en minutes, saisie dans l'unité qu'on veut

⚠️ **`fetch_interval_minutes` est une colonne en minutes, et le reste.** La minute est l'unité
canonique parce que c'est celle que `isDue()` utilise (`plus({ minutes })`). Seules la **saisie** et
l'**affichage** connaissent les heures et les jours — CC-57 n'a demandé aucune migration.

Stocker un couple (valeur, unité) obligerait le planificateur à convertir à chaque tick et ferait
coexister deux représentations de la même durée. Elles divergeraient.

**`shared/interval.ts` est pur, et importé des deux côtés** — le validateur et `pages/sources.vue`.
C'est délibéré : une seconde implémentation côté navigateur serait exactement le moyen de faire
diverger ce qui s'affiche de ce qui est enregistré. La page l'importe en relatif
(`../shared/interval.js`) ; Vite bascule le `.js` sur le `.ts`.

⚠️ **L'unité voyage jusqu'au serveur, la page ne convertit JAMAIS avant d'envoyer.** Le payload est
`{ interval, intervalUnit }`, et c'est `resolveIntervalMinutes` qui fait les minutes. Si la page
convertissait, le serveur ne verrait plus qu'un nombre de minutes sans aucun moyen de re-valider ce
que l'utilisateur voulait dire : toute la garde reposerait sur du JavaScript de page.

Le mode d'échec est **asymétrique**, et c'est ce qui le rend dangereux. Un `12` voulant dire 12
heures et compris comme 12 minutes ne lève rien : 12 passe le plancher de 5, et la source est
interrogée 5 fois par heure au lieu de 2 fois par jour. Personne ne s'en aperçoit. Le sens inverse
est inoffensif (2 minutes tombe sous le plancher et se fait refuser). D'où `requiredIfExists` dans
**les deux sens** : une unité droppée est un refus bruyant, jamais un nombre lu de travers.

⚠️ **`intervalWithinBounds` est la SEULE borne.** Les `.min(5).max(10_080)` ont quitté le schéma —
ils ne savaient pas dans quelle unité le nombre était écrit. La règle **échoue donc fermée** : une
unité illisible reporte une erreur, elle ne sort jamais en silence. Sortir en silence laisserait
passer « 8 jours » (11520 min) sans aucune borne — pire que le bug corrigé. Le test qui poste 8 jours
et attend un refus est **ce qui garde ce garde** : ne le supprime pas.

⚠️ **`update` ne fait pas `source.merge(payload)`.** Le payload porte `interval`/`intervalUnit`, qui
ne sont pas des colonnes : `merge` les poserait en propriétés parasites et la cadence ne changerait
**jamais**, sans erreur. Le merge est explicite, champ par champ.

À la lecture, `fromMinutes` prend la **plus grande unité qui divise exactement** : 90 reste « 90
minutes » et ne devient pas « 1,5 heure ». Pas de décimale — un arrondi silencieux sur une cadence
est exactement ce qu'on évite.

### L'horaire mural : le second mode, et pourquoi ce n'en est pas un troisième réglage

⚠️ **Une source a deux modes d'ordonnancement, discriminés en base par `schedule_mode`** —
`interval` (la cadence historique) et `daily` (« tous les jours à 7h », dans `daily_at`).

Ce n'est **pas** une unité de plus dans le sélecteur de CC-57. Un intervalle **dérive** : chaque
collecte en retard — redémarrage, passe lente, garde `running` qui saute un tick — décale toutes
les suivantes, et le « tous les jours » de 7h passe à 8h30 en une semaine. Un horaire mural se
**réancre** chaque jour au lieu d'accumuler. Aucun réglage de l'intervalle ne produit ça ; il
fallait une seconde branche.

`isDue()` cesse alors de demander « assez de temps écoulé ? » pour demander « suis-je passé après
l'heure du jour, sans avoir déjà collecté dans cette fenêtre ? » :

```
now >= aujourdHui(HH:MM)  ET  lastFetchedAt < aujourdHui(HH:MM)
```

⚠️ **Le second membre est ce qui remplace l'intervalle.** Sans lui, une source serait recollectée
à **chaque tick** une fois l'heure passée — un millier de fois entre 7h et minuit. C'est un test
d'appartenance à une fenêtre, pas un test de durée. C'est aussi lui qui fait qu'un redémarrage à
10h ne rejoue pas la collecte de 7h déjà faite (`startScheduler` lance une passe immédiate).

**La boucle n'a pas changé** : le tick d'une minute avait déjà la granularité nécessaire.

⚠️ **Le fuseau est `config/veille.ts` (`APP_TIMEZONE`, défaut `Europe/Paris`), et surtout PAS
`TZ`.** Les deux répondent à des questions différentes, ne les « harmonise » pas :

- `TZ` (UTC dans ce dépôt) est le fuseau du **process**. `last_fetched_at` est un `timestamp
  without time zone` : il est écrit et relu dedans. Le changer ferait dériver l'interprétation de
  toutes les lignes déjà en base.
- `APP_TIMEZONE` ne situe que la **fenêtre horaire**. Sans lui, « 7h » se déclencherait à 9h à
  Paris l'été et 8h l'hiver — la collecte aurait bien lieu, simplement pas quand l'écran le dit,
  **et rien ne le signalerait**.

⚠️ **Un `APP_TIMEZONE` invalide fait échouer le démarrage, délibérément.** `setZone('Paris')` — un
nom presque juste — rend un DateTime **invalide**, et toute comparaison avec un invalide est
fausse : `isDue()` répondrait `false` à chaque tick, indéfiniment. La source se tairait pour
toujours, sans erreur ni log. Refuser de démarrer est le seul endroit où cet échec a un lecteur ;
dans la boucle de fond, il n'en a aucun. Ne remplace pas ce `throw` par un repli silencieux.

**Trois décisions tranchées, qui ne se devinent pas :**

- **La fenêtre manquée est rattrapée**, pas sautée. Éteint à 7h, rallumé à 9h : on collecte à 9h.
  Pour un agrégateur, sauter revient à perdre une journée de flux. Et le rattrapage ne décale pas
  le lendemain — c'est toute la propriété.
- **Une source neuve collecte tout de suite** (`lastFetchedAt === null`), dans les deux modes.
  Sinon une source ajoutée à 14h reste muette jusqu'au lendemain 7h et on ne sait pas si l'URL
  est bonne.
- **La cadence en minutes survit au passage en horaire.** `fetch_interval_minutes` n'est jamais
  effacé : revenir à l'intervalle retrouve la valeur, au lieu de repartir du défaut.

⚠️ **L'exclusivité est une contrainte en base, `veille_sources_schedule_check`** — pas un `if` :

```sql
(schedule_mode = 'interval' AND daily_at IS NULL)
OR (schedule_mode = 'daily' AND daily_at IS NOT NULL)
```

Une seule contrainte nommée porte **et** l'énumération (toute autre valeur échoue les deux
branches) **et** la cohérence. Conséquence directe côté contrôleur : **repasser en `interval` doit
remettre `daily_at` à `null`**, sinon l'écriture est refusée et la page prend une 500.

⚠️ **`isDue()` ne refuse PAS un mode `daily` sans heure : il retombe sur la branche intervalle.**
La contrainte rend le cas inatteignable, mais un `return false` figerait la source pour toujours,
sans erreur, dans une boucle que personne ne regarde. Une source qui collecte à la mauvaise
cadence se voit ; une source qui ne collecte plus, non. Le repli va vers le comportement visible —
ne l'« assainis » pas en `false`.

⚠️ **Le test est `=== 'daily'`, jamais `=== 'interval'`.** Le défaut `'interval'` est en base, pas
sur le modèle : `VeilleSource.create({...})` sans le champ le laisse `undefined` en mémoire. Tout
ce qui n'est pas explicitement horaire suit donc l'ancienne branche — la non-régression est
structurelle, pas une convention.

⚠️ **Le driver `pg` rend un `time` sous la forme `'07:00:00'`**, là où un `<input type="time">`
veut `'07:00'`. Donné tel quel, le champ resterait **vide** sans un mot. D'où `normalizeTimeOfDay`,
appelé à chaque dérivation du brouillon dans `sources.vue`.

⚠️ **La page poste le mode et *seulement* les champs de ce mode.** Envoyer une heure avec un mode
`interval` enregistrerait un réglage inerte — affiché comme saisi, jamais appliqué. Le validateur
refuse d'ailleurs les deux dépareillages (`requiredIfExists` / `requiredWhen`), même doctrine que
l'unité de CC-57.

⚠️ L'aller-retour n'est **pas** symétrique dans les deux sens, contrairement à ce qu'énonce CC-57.
`toMinutes(fromMinutes(m)) === m` est vrai pour tout `m` ; `fromMinutes(toMinutes(v, u)) === (v, u)`
n'est vrai que pour les couples **canoniques** — `fromMinutes(toMinutes(60, 'minutes'))` rend
`(1, 'hours')`. Les deux propriétés sont testées séparément dans `tests/unit/veille_interval.spec.ts`.

### Le rafraîchissement manuel : deux comportements, et c'est voulu

- **Une source → synchrone.** C'est le seul moyen de vérifier qu'une source qu'on vient d'ajouter
  fonctionne, sans attendre la prochaine passe. Le timeout du fetcher (10 s) borne la requête.
- **Toutes → asynchrone.** Vingt sources à 10 s tiendraient la requête HTTP bien au-delà de ce qu'un
  navigateur accepte. La passe part en tâche de fond ; `last_fetched_at` et `last_error` disent où on
  en est au rechargement.

## Recherche plein texte — colonne générée

`search_vector` est une colonne **`GENERATED ALWAYS AS … STORED`** (tsvector, dictionnaire `french`,
sur `title` + `content`), avec index GIN. Postgres la maintient tout seul : **l'application ne l'écrit
jamais**, et elle n'existe pas sur le modèle Lucid. Ne l'ajoute pas au modèle, ne tente pas de la
remplir dans un seeder.

La recherche passe par `whereRaw("search_vector @@ plainto_tsquery('french', ?)", [search])`. Tout
`whereRaw` **doit rester paramétré** (bindings `?`), jamais concaténé.

⚠️ **Cette colonne dépend de `title`.** Élargir `title` ou `content` demande de la supprimer, de faire
l'`ALTER`, puis de la recréer **avec son index GIN** — c'est ce que fait la migration `…191401`.
Recréer la colonne en oubliant l'index ne casse rien de visible : la recherche continue de répondre,
en `seq scan`. Panne silencieuse.

## Le tri et la pagination

`orderByRaw('coalesce(published_at, created_at) DESC, id DESC')`, index dédié
(`veille_items_published_idx`).

⚠️ **`id` en second critère n'est pas décoratif** : il rend l'ordre **total**. Sans lui, deux items
publiés à la même seconde peuvent s'échanger entre deux requêtes — et la pagination sauterait ou
répéterait une ligne pendant qu'une collecte tourne.

`published_at` (la date annoncée par le flux) prime sur `created_at` : sans elle, un article publié il
y a trois jours mais collecté aujourd'hui remonterait en tête.

Pagination Lucid, 50 par page. Tout changement de filtre repart à la page 1 (rester en page 4 d'un
résultat qui n'en compte plus qu'une afficherait une liste vide sans rien expliquer).

⚠️ **La page demandée est bornée à la dernière page réelle, côté serveur** (CC-63). Le même
problème se pose sans changer de filtre : supprimer les derniers items d'une page laisse une page
qui n'existe plus, et l'écran afficherait « Aucun résultat » — le message qui fait croire que le
filtre est en cause, ou que la suppression a emporté plus que prévu. Le bornage est dans `index`
et **pas dans la page** parce que le retour d'une suppression est un `redirect().back()`, donc vers
l'URL qui porte encore `?page=4` ; il couvre du même coup une collecte qui change le total et une
URL tapée à la main. Le **filtre**, lui, n'est jamais touché : vider « Image » en plusieurs passes
est le geste normal de cet écran.

## Deux bugs corrigés par CC-54, à ne pas réintroduire

**1. Les tags et les compteurs sont calculés en SQL** (`VeilleStatsService`), plus par un
`VeilleItem.all()` qui hydratait toute la table en modèles Lucid pour produire quatre entiers
(CC-22 : tranché, on corrige — c'était assumé à volumétrie de saisie manuelle, ça ne l'est plus dès
que des flux remplissent la table tout seuls).

⚠️ **La page consomme la prop `tags`, elle ne dérive plus la liste des items affichés.** Avant, un
clic sur un tag réduisait `items` à ce tag, donc la barre s'effondrait à ce seul tag : impossible d'en
choisir un second sans repasser par « Tout » — et le compteur global affiché juste à côté disait autre
chose.

⚠️ **Postgres rend `count()` en `bigint`, donc en chaîne** : sans `Number()`, la page afficherait
`"7"` et les additions deviendraient des concaténations.

**2. `readingQueue` se lit en booléen, pas en truthy.** Un paramètre d'URL est **toujours** une
chaîne : `?readingQueue=false` arrive en `"false"`, qui est truthy. Le filtre « file de lecture »
s'activait donc à la première navigation et ne se désactivait plus — alors qu'aucun bouton ne le
pilotait. D'où le helper `asBool`.

## Pièges techniques

- **`tags` est un `text[]` Postgres, pas du JSON.** Colonne `@column()` nue, **sans**
  `prepare: JSON.stringify` — le driver `pg` gère le tableau nativement. Filtrage :
  `whereRaw('? = ANY(tags)', [tag])`. En revanche `metadata` est du `jsonb` et porte bien, lui,
  `prepare: JSON.stringify`.
- `captureValidator` ne couvre **pas** `tags` : ils ne sont pas renseignables depuis le formulaire de
  capture (seulement par seeder ou collecte). Ajouter le champ = étendre le validateur.
- **`title` et `url` sont en `text`, plus en `varchar(255)`.** Beaucoup d'URL de flux dépassent 255
  caractères : c'était un 500 en pleine collecte. Ne les re-borne pas côté base.
- La suppression d'une source est `ON DELETE SET NULL` sur les items : **supprimer une source
  n'efface jamais l'historique déjà lu**. Le lot 1 n'expose d'ailleurs pas la suppression, seulement
  la désactivation (`active`) — et ça n'a pas changé depuis, y compris à CC-63 qui ne supprime que
  des items.
- `metadata` porte `{ sourceTitle, guid }` pour les items collectés — la colonne, restée vide depuis
  la création du module, sert enfin. Les items Immich y portent `{ sourceTitle, durationSeconds }` ;
  **l'identifiant de l'asset n'y est PAS** — il ne vit que dans `dedup_key`, unique et indexé. Le
  recopier en ferait une seconde source de vérité à garder synchronisée pour rien.
- **`veille_items.url` est nul pour un média**, et ce n'est pas un oubli : le lien vers Immich se
  construit à l'affichage depuis `IMMICH_BASE_URL`. Figé en base, il pointerait sur l'ancien domaine
  le jour d'un déménagement d'instance et **tous** les liens casseraient en silence.
- **Le retour arrière de la migration `…191403` DÉTRUIT les items média**, faute de pouvoir les
  représenter sous l'ancienne contrainte. Le dégât est borné par la décision qui porte le lot : une
  collecte les reconstruit tous, seul ce que le module a produit lui-même (lu/non-lu, file de
  lecture, tags) est réellement perdu.

## Avant de rendre la main

`npm test`. Les tests qui portent ce module :

- `tests/unit/veille_feed_url.spec.ts` — **la garde SSRF**, le test qui compte du lot, pendant exact
  de `leitner_llm_url.spec.ts`. Loopback, plages privées, `169.254.169.254`, IP déguisées en décimal
  et hexadécimal, identifiants dans l'URL, protocoles non http(s), noms internes. Plus la frontière
  exacte de `172.16/12` : `172.15` et `172.32` sont **publiques**, les exclure interdirait des flux
  légitimes.
- `tests/unit/veille_feed_redirect.spec.ts` — ce qui la **complète**, et le seul test du module à
  émettre une vraie requête (deux serveurs jetables sur `127.0.0.1:0`, fermés en teardown — sans quoi
  `forceExit: false` fige `npm test`). L'assertion qui porte le test est `hits === 0`, pas
  l'exception. Il couvre aussi le pendant : **une redirection légitime EST suivie**.
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
- `tests/unit/veille_schedule_draft.spec.ts` — **CC-60**, la logique de `pages/sources.vue` sortie du
  `.vue`. Le test qui porte le lot est **l'heure du driver `pg` face à celle du champ** : une source
  à `'07:00:00'` et un brouillon à `'07:00'` sont la **même** cadence, donc rien à enregistrer.
  Retire le `normalizeTimeOfDay` de `isScheduleDirty` et il rougit ; mets-le des deux côtés et c'est
  le test voisin (« une heure réellement changée est bien vue ») qui rougit. Les deux ensemble
  tiennent la fonction. Plus les bornes par unité, le payload qui ne poste que les champs de son
  mode, et la conversion d'unité sans arrondi. ⚠️ Ce qu'il ne voit **pas** : le template, et
  l'enveloppe `isScheduleDirty` de la page — la couture que l'extraction crée.
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
- `tests/functional/modules/veille_items.spec.ts` — **CC-20** : la recherche plein texte (dont
  l'apostrophe, l'injection SQL et les caractères spéciaux — avec une assertion sur le **résultat**,
  pas seulement sur l'absence de crash), le filtre par tag accentué, `store`, `toggleQueue`,
  `toggleRead`, la pagination sans chevauchement, et que **la capture manuelle survit à la
  migration**.

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
  durée qui ne s'affiche pas quand il n'y en a pas. Ce qu'il ne voit **pas** : le template et les
  enveloppes de la page.
- `tests/functional/modules/veille_immich.spec.ts` — la collecte. **« Une erreur d'API ne marque
  AUCUN asset disparu »** est le test qui porte le lot, et il est vérifié mordant : entoure
  `albumAssets()` d'un `try/catch` et lui plus « last_error » rougissent. Plus la deuxième collecte
  qui n'ajoute rien, le même asset deux fois dans une passe, l'asset sorti **puis remis**, l'album
  vidé qui se voit, l'aiguillage par `kind`, l'alignement de la source sur `.env` (dont **la source
  désactivée à la main qui n'est jamais réactivée**), et le proxy — item non-média, item inconnu,
  asset disparu, et la clé d'API absente de la réponse.

- `tests/functional/modules/veille_deletion.spec.ts` — **CC-63**. Le test qui porte le lot est
  **« un article supprimé ne revient pas à la collecte suivante »** : le faux flux republie les
  mêmes entrées, et sans pierre tombale la seconde passe les réinsère. Vérifié mordant — remplace
  le marquage par un vrai `delete()` et il rougit, avec quatre autres. Puis les deux garde-fous
  d'Immich : **un échec ne marque rien**, et **`trashDays: 0` n'émet même pas l'appel** —
  l'assertion qui porte ce dernier est `trashed` vide, pas `deletedAt` nul, parce que « rien en
  base » serait aussi vrai si l'appel partait et échouait. Plus **un test par lecture** (liste ·
  compteurs · tags · recherche · pagination · type/source · proxy de vignette), la réconciliation
  qui ignore les supprimés, l'asset revenu dans l'album qui ne ressuscite rien, la sélection mixte
  dont seuls les articles partent, l'idempotence du double-clic, Immich retiré de la configuration,
  **la page vidée qui recule sans perdre le filtre**, le clic sans effet qui le dit, et le plafond
  de 200 ids qui refuse **le lot entier**.
- `tests/unit/veille_item_selection.spec.ts` — **CC-63**, la logique de sélection sortie
  d'`index.vue`. Le test qui compte est **la confirmation qui annonce le nombre d'assets partant à
  la corbeille** : sans ce nombre, le dialogue laisserait croire qu'on ne touche qu'à Command
  Center. Plus le résumé qui ne compte que les items **affichés** (une sélection survivant à un
  changement de page annoncerait un nombre invérifiable), et le silence sur Immich quand aucun
  média n'est concerné — un avertissement affiché à tort ne se lit plus quand il compte.
  ⚠️ Ce qu'il ne voit **pas** : le template, les cases, et le `confirm()` lui-même.

**Aucun test ne touche le réseau** — `tests/fakes/fake_feed_fetcher.ts` remplace `FeedFetcher` dans le
conteneur (`app.container.swap`), les flux viennent de `tests/fixtures/feeds/*.xml` ;
`tests/fakes/fake_immich_client.ts` fait de même pour `ImmichClient`. Seule exception, délibérée : le
test de redirection ci-dessus.

⚠️ **Pour Immich, c'est en plus une propriété du dispositif, pas une promesse** : `.env.test` **vide
les trois variables** `IMMICH_*`. Sans ça, `.env.test` surchargeant `.env`, les tests hériteraient de
l'instance réelle du poste — clé d'API comprise — et un `swap` oublié suffirait à faire partir de
vraies requêtes vers une vraie bibliothèque de photos pendant `npm test`. Vidées,
`immichConfig.enabled` vaut `false` et le vrai client refuse de partir avant même de construire une
URL. Les tests qui ont besoin d'une configuration en passent une explicitement
(`ensureSource(config)`) — ne rétablis pas une lecture directe de `immichConfig` dans cette méthode.

Ce que la suite ne voit **pas** : la boucle `setInterval` réelle (le provider est en
`environment: ['web']`, donc absent des tests — `collectDue()` est appelée directement), la
résolution DNS réelle (la garde est testée sur des littéraux), et le rendu Vue.

⚠️ **Le dépôt sait écrire des tests de composant depuis CC-33** (Vitest, voir le `CLAUDE.md`
racine) — mais **aucune page de ce module n'en a**, et c'est différent de « le dépôt n'en a
pas », ce que cette section affirmait à tort jusqu'à CC-60. Le lu/non-lu, la pagination à l'écran
et l'affichage de `last_error` se vérifient donc toujours au navigateur ; ce qui a changé, c'est
que les câbler est désormais possible, pas qu'ils le soient.
