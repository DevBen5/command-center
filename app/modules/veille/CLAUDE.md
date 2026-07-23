# Module Veille — sources · articles collectés · médias Immich · signets · notes

Routes `/veille` · `/veille/sources` · `POST /veille/items/delete` · pages Inertia
`modules/veille/index` et `modules/veille/sources` · tables `veille_items`, `veille_sources`.

```
controllers/veille_controller.ts         index (filtres + pagination) · store · toggleQueue
                                         · toggleRead · destroyMany
controllers/veille_sources_controller.ts refresh (UNE, SYNCHRONE) · refreshAll (async)
controllers/veille_media_controller.ts   le PROXY de vignette — HTTP nu, indexé par l'id d'ITEM
services/feed_fetcher.ts                 seul point réseau des FLUX : SSRF, timeout, plafond,
                                         etag/304, redirections revalidées
services/feed_parser.ts                  rss-parser (RSS 2.0 ET Atom) · HTML → texte · clé de dédup
services/immich_client.ts                seul point qui parle à IMMICH : pagination, refus des 3xx,
                                         assertion de content-type, plafonds
services/immich_asset.ts                 PUR · type · durée · tag réseau · clé de dédup
services/immich_collector.ts             ensureSource · insert · reconcile
services/veille_item_writer.ts           l'unique liste de colonnes et l'unique ON CONFLICT
services/veille_deletion_service.ts      Immich d'abord, pierre tombale ensuite
services/veille_collector_service.ts     une passe, par source, isolée, AIGUILLÉE PAR `kind`
services/veille_scheduler.ts             la boucle en processus (démarrée par le provider)
services/veille_stats_service.ts         les agrégats SQL des indicateurs et des tags
models/veille_source.ts                  isDue() · kind rss | immich
models/veille_item.ts                    article · bookmark · note · image · video
                                         · unavailableAt · deletedAt + visible()
validators/veille.ts                     isPublicFeedUrl (GARDE SSRF) · resolveIntervalMinutes
shared/interval.ts                       PUR, serveur ET page · minutes ⇄ unité · heure du jour
shared/schedule_draft.ts                 PUR · le brouillon de cadence de sources.vue
shared/media_item.ts                     PUR · la logique média d'index.vue
shared/item_selection.ts                 PUR · la sélection multiple d'index.vue
```

⚠️ **Huit fichiers hors du module** : `start/routes.ts`, `providers/veille_provider.ts` (déclaré
dans `adonisrc.ts`, `environment: ['web']`), `config/veille.ts` (fuseau des collectes horaires),
`config/immich.ts` · `start/env.ts` · `.env.example`, `start/capabilities.ts`, et
`start/navigation.ts` (la ligne qui enregistre `destinations.ts`). Oublier l'avant-dernier ne casse
rien tout de suite : les capacités n'entrent pas au registre, plus personne ne peut les accorder, et
le module devient inaccessible à tout non-admin. Oublier le dernier retire `/veille` de la barre
latérale et fait atterrir sur « aucun accès » un compte qui n'aurait de droits que sur ce module —
`navigation_registry.spec.ts` l'attrape.

## Où vit la logique d'une page — `shared/`, jamais le `<script setup>`

⚠️ Japa n'a aucun compilateur Vue : ce qui vit dans un `<script setup>` est **structurellement** hors
de portée de la suite. Règle (CC-60) : prédicat, dérivation, forme d'un payload → `shared/*.ts` ;
`router.post`, modale, `ref` → dans le `.vue`.

- La page garde une **enveloppe d'une ligne** du même nom, ce qui laisse le template inchangé. Cette
  enveloppe est une couture nouvelle — module vert + enveloppe fausse = page cassée. D'où : une
  ligne, et tout état passé part en **objet nommé** dès qu'il y a deux champs du même type.
- ⚠️ **Un fichier de `shared/` n'importe JAMAIS par un alias `#modules/*`** : l'alias mappe vers
  `./app/modules/*.js`, qui n'existe qu'après un build — Vite ne le résout pas, la page casse.
  Relatif ou npm pur uniquement. Le garde-fou est **`npm run build`**, `tsc` ne lisant pas les
  `.vue` : le build est un gate sur ces fichiers.

## `type` dit ce que c'est, `kind` dit d'où ça vient

- **`veille_sources.kind`** = provenance : `rss` (RSS 2.0 **et** Atom, même parseur) et `immich`.
- **`veille_items.type`** = nature : `article | bookmark | note | image | video`. Avant CC-54 les
  deux étaient mélangés dans `type`, ce qui imposait une migration par source nouvelle. **La capture
  manuelle (`bookmark`, `note`) ne doit jamais régresser** : elle n'a pas de source.

⚠️ **`type` n'est pas un enum natif** malgré `table.enum()` : sans `useNative: true`, knex produit un
`text` + une contrainte `CHECK`. Ajouter une valeur = `DROP`/`ADD CONSTRAINT`, jamais `ALTER TYPE`.

⚠️ **`kind` n'a aucune contrainte en base** : ajouter une provenance ne demande pas de migration,
mais demande un **aiguillage dans `VeilleCollectorService`**. Sans lui la source part au
`FeedFetcher`, qui va chercher son `url` comme un flux et échoue à chaque passe en parlant d'URL
publique : un faux problème, et le vrai invisible.

⚠️ La liste des types vit à **trois** endroits (`VeilleItemType`, contrainte CHECK,
`captureValidator`), qui bougent ensemble **sauf une exception délibérée** : `captureValidator` ne
porte ni `image` ni `video`. Le formulaire ne peut pas téléverser un média ; les y autoriser créerait
des items média sans asset, dont la vignette n'existerait pas.

## La déduplication — une contrainte en base, jamais un `if`

Sans dédup, la boîte est inutilisable en une semaine. **`veille_items.dedup_key` est sous index
UNIQUE.** ⚠️ Leitner déduplique par check-then-insert applicatif, non atomique : ne prends pas ce
pattern-là pour modèle ici, il ne tient pas contre deux collectes concurrentes.

```
url:https://exemple.dev/article        ← le cas normal
guid:<sourceId>:<guid>                 ← entrée sans lien exploitable
title:<sourceId>:<titre normalisé>     ← ni lien ni guid : dégénéré, mais il FAUT une clé
immich:<uuid>                          ← un asset Immich
```

- **L'URL d'abord, le `guid` en repli** — l'inverse de l'usage courant et de ce que demandait CC-54.
  Le `guid` est propre à chaque flux : il ne dédupliquerait **jamais entre deux sources**, or c'est
  le cas fréquent (le même article par le blog, un agrégateur et HN).
- Le préfixe empêche un `guid` qui ressemble à une URL de collisionner avec une vraie URL. `guid` et
  `title` sont cadrés par leur source ; **la clé Immich ne l'est pas** (l'UUID est unique dans
  l'instance) et elle a un **second rôle** : index d'autorisation du proxy de vignette. Un second
  module référençant des assets Immich demanderait une colonne dédiée, pas un second préfixe.
- Le dernier repli n'est pas cosmétique : **sans clé, l'entrée serait réinsérée à chaque passe**.
- ⚠️ **`dedup_key` est NULL pour les captures manuelles**, et c'est ce qui les protège (Postgres
  autorise autant de NULL qu'on veut sous index unique). Deux signets vers la même URL restent deux
  signets.
- `canonicalizeUrl` : `https` forcé, `www.` retiré, casse de l'hôte, slash final, fragment,
  `utm_*`/`fbclid`/`gclid`, et **tri des paramètres restants**.

**Deux niveaux, et il faut les deux** : un `Set` en mémoire pour les répétitions *dans* une passe,
`ON CONFLICT (dedup_key) DO NOTHING` contre la base — y compris entre deux collectes concurrentes,
qu'un `if` applicatif ne couvrirait pas (les deux lisent avant que l'une n'écrive). Le compte écrit
vient du `RETURNING id`.

## Le collecteur

⚠️ **`etag`/`last_modified` ne sont écrits qu'APRÈS l'insertion réussie** — mode d'échec silencieux
n° 1. Les mémoriser dès la réponse HTTP puis échouer ferait recevoir un `304` à la passe suivante :
entrées sautées **définitivement**, le flux ne les republiera pas.

**Un flux cassé ne casse pas la collecte** : `collectSource` ne lève jamais, `collectAll`/`collectDue`
passent par `Promise.allSettled`, par vagues de 4. L'erreur part dans `last_error` + `last_error_at`,
**affichée telle quelle** — un flux mort qui échoue en silence est le mode de panne le plus courant
d'un agrégateur : au bout d'un mois on croit que le sujet est calme.

- ⚠️ **`last_fetched_at` bouge aussi en cas d'échec**, sinon la source reste éternellement due et on
  martèle un serveur en panne à chaque tick.
- ⚠️ **200 + XML valide + zéro entrée n'est pas une erreur** : `last_error` reste nul, la source
  *paraît saine*. D'où **`last_item_count`** et un bandeau explicite quand il vaut `0`.

### Sécurité — quatre points à ne pas régresser

**1. Garde SSRF, miroir inverse de celle du LLM.** `isLocalLlmUrl` (Leitner) n'accepte **que** le
local ; `isPublicFeedUrl` le **refuse**. Rejetés : non-http(s), identifiants dans l'URL
(`http://flux.exemple.dev@169.254.169.254/`), loopback, `10/8` · `172.16/12` · `192.168/16` ·
`100.64/10` · `169.254/16`, l'IPv6 équivalent (`::1`, `fc00::/7`, `fe80::/10`, `::ffff:127.0.0.1`),
et les noms qui ne désignent jamais un service public (`localhost`, `*.local`, `*.internal`, **et
tout nom sans point**). La comparaison porte sur `url.hostname`, **normalisé par le parseur** :
`0x7f000001`, `2130706433` et `127.1` y arrivent tous en `127.0.0.1`.

⚠️ **Contrairement à Leitner, on ne peut pas refuser les noms de domaine** — un flux RSS *est* un nom
de domaine. `feed_fetcher` résout donc le nom (`dns.lookup`) et refuse dès qu'**une** des adresses
rendues est interdite.

**2. Redirections suivies, jamais aveuglément** : `redirect: 'manual'`, **3 sauts max, chaque
`Location` repasse la garde en entier**. C'est le vrai vecteur — l'utilisateur saisit une URL
publique, c'est le **serveur distant** qui choisit la redirection. ⚠️ **On ne refuse pas les 3xx en
bloc**, contrairement au client LLM : un flux RSS en a constamment (http→https, FeedBurner), refuser
sec casserait des flux honnêtes.

⚠️ `assertReachableTarget` est **`protected`, pas `private`** — couture de test nécessaire (la garde
refuse le loopback, donc un serveur jetable serait rejeté avant toute requête). Assouplie pour le
**premier saut seulement**, et jamais en production.

**3. Le HTML des flux n'est jamais stocké, seulement du texte** : `sanitize-html` en
`allowedTags: []`. Un `v-html` posé plus tard ne peut plus rouvrir la faille, et `search_vector`
indexe du texte au lieu de mots-clés HTML. ⚠️ **L'invariant est que le texte stocké ne contient
jamais `<` ni `>`.** On redécode **en une seule passe** les entités qui ne peuvent pas reformer de
balise (`&amp;`, `&quot;`, `&apos;`, `&#39;`, `&nbsp;`) — une seconde passe ferait de `&amp;lt;` un
`<`. ⚠️ **N'utilise pas `contentSnippet` de rss-parser** : son `stripHtml` laisse le **corps** d'un
`<script>` dans le texte.

**4. Deux plafonds** : 10 s (`AbortSignal.timeout`, une échéance pour toute l'opération, redirections
comprises) et **5 Mo** de corps — sans le second, une réponse géante emporte le processus.
⚠️ **`rss-parser` sait télécharger tout seul (`parseURL`) : ne l'utilise JAMAIS**, sa méthode réseau
contourne toute cette garde. On n'appelle que `parseString`.

## Immich — les vidéos du téléphone (CC-55)

**Relevé contre une instance v2.6.1.** L'API a connu des ruptures (`/api/asset` → `/api/assets` vers
la v1.106) et la majeure est passée à 2 : relève la version réelle (`GET /api/server/about`) avant
de toucher au client, plutôt que de faire confiance à ce fichier.

| | ce que rend l'instance |
|---|---|
| liste paginée | `POST /api/search/metadata` `{albumIds, page, size}` → `assets.items` + `assets.nextPage` |
| vignette | `GET /api/assets/:id/thumbnail?size=thumbnail` → `image/webp` (~20 Ko) ; `size=preview` → `image/jpeg` (~290 Ko) |
| album ou asset inconnu | **HTTP 400**, pas 404 (`"Not found or no asset.read access"`) |
| durée | `"00:01:04.362"` sur une vidéo, `"0:00:00.00000"` sur une image — **deux formes** |

- ⚠️ **`nextPage` est une chaîne (`"2"`)** : un `typeof === 'number'` arrêterait la pagination à la
  première page, et tous les assets suivants seraient marqués « plus dans l'album ».
- ⚠️ **`search/metadata` ne rend pas `exifInfo`** : aucune coordonnée GPS ne transite ni ne se
  stocke. À garder en tête au lot 3, quand ces items partiront vers un LLM.

**Référencer, ne jamais copier.** Immich possède les octets, Command Center possède le sens :
`npm run db:backup` ne dumpe que du SQL, il n'aurait jamais emporté des dizaines de Go de vidéos. Le
proxy n'est pas une copie — les octets traversent le serveur et sont oubliés.

### Le mode d'échec n° 1 : un 200 qui ment

⚠️ **Immich sert son interface web en repli sur tout chemin inconnu** : une route d'API disparue rend
**200 en `text/html`**, pas 404 — un slash final de trop dans `IMMICH_BASE_URL` suffit à le produire.
Sans contrôle : statut OK → `assets` vaut `undefined` → album vide → **la réconciliation marque tout
l'album « plus dans l'album »**. Une passe suffit à vider la veille, et rien à l'écran ne le dit.
D'où deux gardes, et il faut les deux : `config/immich.ts` retire le slash final, et `ImmichClient`
**vérifie le `content-type`** (`application/json` sur l'API, `image/` sur une vignette).

### Le marquage des disparus : tout ou rien, jamais partiel

La propriété qui rend `reconcile()` sûr n'est pas dedans mais dans `ImmichClient.albumAssets()` :
**une page en échec fait lever, aucune liste partielle n'est jamais rendue**. Page 2 en timeout, clé
révoquée en cours de pagination, réponse HTML — `reconcile()` n'est pas atteint.

- ⚠️ **Ne mets jamais un `try/catch` autour de `albumAssets()` dans le collecteur** : la passe
  paraîtrait réussir, et marquerait tout.
- La réconciliation va dans les **deux sens** : sans le retour, une sortie accidentelle d'album
  serait définitive.
- ⚠️ **« Plus dans l'album » n'est pas « supprimé », et l'écran dit le premier.** Les distinguer
  demanderait un appel par disparu, dont le 400 signifie aussi « pas d'accès ». La vraie suppression
  se révèle par le proxy en 404, image cassée à l'écran.
- ⚠️ **Un album réellement vidé marque tout**, et c'est correct — le `last_item_count = 0` empêche
  que ce soit silencieux. Une *erreur*, elle, n'arrive jamais jusque-là.

### La configuration — `.env`, et une ligne qui n'en est que le reflet

`IMMICH_BASE_URL`, `IMMICH_API_KEY`, `IMMICH_ALBUM_ID`, `IMMICH_TIMEOUT_MS` → `config/immich.ts`,
sur le modèle de `config/llm.ts`. **Jamais un formulaire, jamais la base** : une URL de serveur
persistée depuis une requête HTTP est une SSRF permanente, écrite une fois et rejouée à chaque passe.

⚠️ **`IMMICH_ALBUM_ID` désigne UN album, jamais la bibliothèque** — elle contient des photos
personnelles qui partiraient vers un LLM au lot 3. Le filtre est chez l'utilisateur, dans Immich.

`ImmichCollector.ensureSource()` (provider, au boot) crée la ligne `veille_sources` correspondante
pour que la collecte Immich **hérite du lot 1** : cadence, `last_error`, `last_item_count`,
rafraîchissement manuel, affichage. Sans elle, « une erreur d'API ne passe pas en silence » n'aurait
aucun endroit où s'afficher.

- ⚠️ **Cette ligne n'est créable par aucun formulaire** (`sourceValidator` impose `isPublicFeedUrl`,
  qui refuse `immich:album:…`). Son `url` n'est jamais une cible réseau : le collecteur lit la
  configuration.
- ⚠️ **La réactivation est conditionnée à un marqueur exact** (`DISABLED_BY_CONFIG`). Sans lui : soit
  la collecte repart seule après une désactivation volontaire, soit la source reste muette après une
  correction de `.env`, sans dire pourquoi.
- ⚠️ **Changer `IMMICH_ALBUM_ID` marque tous les items de l'ancien album en une passe.** Défendable,
  surprenant : journalisé, et réversible.

### Le proxy de vignette — la décision de sécurité du lot

`GET /veille/items/:id/thumbnail` — **le paramètre est l'id d'item de notre base, jamais
l'identifiant Immich.** Une route `/veille/immich/:assetId/thumbnail` serait un **proxy de lecture
ouvert sur toute la bibliothèque personnelle**, servi par un serveur qui porte la clé d'API : le
paramètre *étant* l'identifiant Immich, il n'y aurait rien à vérifier contre quoi que ce soit. Ici le
seul paramètre client est un entier, l'UUID est relu dans `dedup_key` — une valeur que nous avons
écrite — et l'autorisation est un effet de bord de la recherche.

- ⚠️ **`IMMICH_API_KEY` ne repart jamais vers le client**, comme `LLM_API_KEY`. La page reçoit
  `{ configured, webBaseUrl }` : `webBaseUrl` **doit** descendre (le navigateur ouvre le lien), la
  clé jamais.
- ⚠️ **Réponse HTTP nue, pas de l'Inertia** (comme l'export JSON de Leitner) : `<img src>` natif.
- ⚠️ **Un échec rend 404 au navigateur mais `logger.warn` côté serveur.** Sans ce log, « Immich
  éteint », « clé révoquée » et « asset supprimé » sont indiscernables, et le réflexe est d'accuser
  le proxy.

### Pourquoi la garde SSRF de Leitner n'est pas réutilisée

CC-55 demandait d'extraire `isLocalLlmUrl` en supposant Immich « sur le réseau local ». **C'est faux
contre l'instance réelle**, qui répond en `https` sur un domaine public. Et le besoin n'existe pas :
**aucune URL ne vient jamais d'une requête HTTP** — hôte et album figés par `.env`, identifiant
d'asset relu de notre base. Il n'y a pas de cible à filtrer, il n'y a qu'une cible. Ce qui la
remplace :

1. **refus des 3xx** (`redirect: 'manual'`) — comme le client LLM, contrairement au collecteur RSS :
   une API n'a aucune redirection légitime, et suivre un `Location` sortirait de l'hôte configuré
   **avec la clé d'API dans les en-têtes** ;
2. l'assertion de `content-type` ci-dessus ;
3. plafonds de 16 Mo (JSON) et 10 Mo (vignette), un timeout, et un plafond de **pages** — un
   `nextPage` qui n'avancerait pas ferait tourner la collecte indéfiniment.

## Supprimer — la pierre tombale, et la corbeille d'Immich (CC-63)

⚠️ **Supprimer la ligne ne supprimerait rien** : la clé libérée, `ON CONFLICT DO NOTHING` laisse la
passe suivante réinsérer. Un flux republie ses 10 à 50 dernières entrées en permanence — l'article
reviendrait dans l'heure, sans que rien ne relie les deux. La suppression est donc **logique** : la
ligne reste, `deleted_at` la masque, le collecteur ne change pas d'une ligne. L'alternative (table de
pierres tombales + vraie suppression) imposerait une anti-jointure à l'insertion, dans le seul
endroit où la dédup est tranchée : **un filtre oublié se voit à l'écran, une anti-jointure ratée
fait revenir les items en silence.**

⚠️ **`deleted_at` n'est pas `unavailable_at`, et les deux coexistent** : le second est un **constat**
de la collecte, réversible tout seul ; le premier une **décision de l'utilisateur**, que rien dans la
collecte ne défait. Les fusionner ferait ressusciter un item volontairement supprimé dès que l'asset
revient dans l'album.

⚠️ **Toute lecture filtre `deleted_at IS NULL`** — un seul oubli et les supprimés remontent. Liste
complète, à tenir à jour avec le code :

| endroit | comment |
|---|---|
| `VeilleController.index` (liste, recherche, tags, pagination, filtres) | `VeilleItem.visible()` |
| `VeilleController.toggleQueue` / `toggleRead` | `VeilleItem.visible()` |
| `VeilleMediaController.thumbnail` | `VeilleItem.visible()` |
| `VeilleStatsService.fetchStats` | `WHERE deleted_at IS NULL` en clair |
| `VeilleStatsService.fetchTags` | `WHERE deleted_at IS NULL` en clair |
| `ImmichCollector.reconcile` — marquage **et** rétablissement | `.whereNull('deleted_at')` |

`VeilleItem.visible()` existe pour que « toutes les lectures filtrent-elles ? » ait une réponse
**greppable** ; les lectures en SQL brut portent le filtre en clair.

### L'ordre : Immich d'abord, la base ensuite

La fenêtre entre les deux écritures n'est **pas symétrique**. Immich puis la base : un crash entre
les deux laisse un asset à la corbeille et un item encore visible — la passe suivante le marque,
l'utilisateur resupprime. L'inverse laisserait un item marqué supprimé et un asset toujours dans
l'album, **pour toujours**, alors que l'utilisateur le croit supprimé.

- ⚠️ **Un échec côté Immich ne marque RIEN en base.** Invariant du lot : *une ligne marquée supprimée
  = un asset réellement à la corbeille*.
- ⚠️ **Un raccourci a été écarté** : sauter l'appel Immich pour un item déjà `unavailable_at`. Un
  asset seulement *sorti de l'album* resterait dans la bibliothèque. Un média passe **toujours** par
  Immich.
- **Le partiel est assumé** : les items sans asset partent même quand Immich échoue — rien ne peut
  diverger, et un tout-ou-rien les punirait pour une panne qui ne les regarde pas.

### `trashDays` — le seul filet, vérifié à chaque fois

`DELETE /api/assets` en **`force: false`** envoie à la corbeille… *si la corbeille est activée*. Sur
une instance à `trashDays: 0` le même appel **détruit immédiatement**, et nous n'avons aucune copie
des octets. `trashDays()` lit `GET /api/server/config` **avant chaque suppression**, jamais au
démarrage : une valeur en cache devient fausse si la corbeille est désactivée pendant que le serveur
tourne, et cette fausseté-là est irréversible.

- ⚠️ **La règle échoue fermée** : champ absent, renommé ou rendu en chaîne → `0` → refus.
- ⚠️ **`force: true` n'existe nulle part** — pas de paramètre, pas de réglage, pas de surcharge.
- ⚠️ **`GET /api/server/config` est une route publique** côté Immich : elle marche avec une clé
  réduite au strict nécessaire.
- ⚠️ **La réponse est un 204 sans corps**, d'où un chemin qui ne passe pas par le lecteur JSON. Y
  passer ferait échouer l'assertion de `content-type` sur un appel **réussi** : les assets
  partiraient à la corbeille, rien ne serait marqué, et la suppression paraîtrait échouer à chaque
  clic tout en ayant lieu à chaque fois.

### Les permissions de la clé d'API — relevées, pas devinées

| appel du module | route | permission |
|---|---|---|
| `serverVersion()` — **avant chaque passe** | `GET /api/server/about` | `server.about` |
| `albumAssets()` | `POST /api/search/metadata` | `asset.read` |
| proxy de vignette | `GET /api/assets/:id/thumbnail` | `asset.view` |
| corbeille | `DELETE /api/assets` | `asset.delete` |
| `trashDays()` | `GET /api/server/config` | **aucune — route publique** |

- ⚠️ **`album.read` n'est PAS nécessaire** : aucune route `/api/albums` n'est appelée, le filtrage
  passe par `albumIds`. CC-63 le demandait — c'était faux.
- ⚠️ **`server.about` est indispensable** et c'est le piège : appelé en **première ligne** de chaque
  passe, une clé réduite sans lui prend un 401 avant tout et la collecte s'éteint entièrement, avec
  un message qui ressemble à « Immich est éteint ».
- ⚠️ Relevé contre `immich-app/immich` (branche `main`), pas contre la v2.6.1 exactement. L'UI de
  l'instance fait foi.

### La suppression en lot, et ce qui la borne

Le besoin est de **vider** : le contenu est collecté, donc reconstructible, et le problème est
l'accumulation. Les bornes :

- **confirmation obligatoire**, annonçant **combien d'assets partent à la corbeille d'Immich**, pas
  seulement combien de lignes disparaissent (`confirmationMessage`, donc testé) ;
- **pas de « tout sélectionner » inter-pages** : le rayon d'action reste les 50 items sous les yeux ;
- **plafond de 200 ids** au validateur, qu'un client forgé ne contourne pas ;
- **idempotence** par le filtre `deleted_at IS NULL` : un double-clic ne rappelle pas Immich.

**Trois tons au retour, jamais le silence** : succès, échec Immich (message **tel quel** — « instance
éteinte », « clé sans `asset.delete` » et « asset inconnu » doivent rester distinguables), et
**`info` quand rien n'a été supprimé** — cas réel (second onglet sur une liste périmée), sans lequel
le bouton paraît cassé et le réflexe est de recliquer. ⚠️ Sur un 400 portant plusieurs assets, le
message dit **quoi faire** (réessayer par plus petits lots) : on ne sait pas si Immich plafonne la
taille d'un lot, et un 400 vaut aussi pour un asset inconnu.

## Le déclenchement — une boucle en processus, pas une file

Aucune infrastructure de job. Comme l'ingestion Leitner : tâche de fond dans le processus, démarrée
par un provider sous `environment: ['web']`. `veille_scheduler` regarde **toutes les minutes quelles
sources sont dues** ; une source jamais collectée est due immédiatement.

- ⚠️ **Différence assumée avec Leitner : aucun statut « en cours » persisté**, donc rien à balayer au
  démarrage — la collecte est idempotente par construction et simplement rejouée au tick suivant. Un
  `sweepInterrupted` ici serait du code sans objet : ne l'ajoute pas par symétrie.
- ⚠️ **La garde anti-chevauchement (`running`) vit en mémoire : elle suppose une seule instance.** À
  plusieurs, deux processus travailleraient en double sans rien corrompre — c'est la contrainte
  d'unicité en base qui garantit l'absence de doublon, jamais ce booléen.
- ⚠️ **`timer.unref()`** — sans lui, le timer retient le processus.

### La cadence : stockée en minutes, saisie dans l'unité qu'on veut

⚠️ **`fetch_interval_minutes` est en minutes et le reste** — c'est l'unité de `isDue()`. Seuls la
saisie et l'affichage connaissent heures et jours (CC-57 n'a demandé aucune migration) : stocker un
couple (valeur, unité) ferait coexister deux représentations de la même durée, qui divergeraient.
**`shared/interval.ts` est pur et importé des deux côtés** — une seconde implémentation côté
navigateur ferait diverger ce qui s'affiche de ce qui est enregistré.

⚠️ **L'unité voyage jusqu'au serveur, la page ne convertit JAMAIS avant d'envoyer.** Le payload est
`{ interval, intervalUnit }` ; si la page convertissait, le serveur ne verrait qu'un nombre de
minutes sans moyen de re-valider ce que l'utilisateur voulait dire. Le mode d'échec est
**asymétrique** : un `12` voulant dire 12 heures et compris comme 12 minutes ne lève rien (12 passe
le plancher de 5, la source est interrogée 5 fois par heure au lieu de 2 fois par jour, personne ne
s'en aperçoit) ; le sens inverse est inoffensif. D'où `requiredIfExists` dans **les deux sens**.

- ⚠️ **`intervalWithinBounds` est la SEULE borne** : les `.min(5).max(10_080)` ont quitté le schéma,
  ils ne savaient pas dans quelle unité le nombre était écrit. La règle **échoue fermée** — sortir en
  silence laisserait passer « 8 jours » (11520 min) sans aucune borne, pire que le bug corrigé.
- ⚠️ **`update` ne fait pas `source.merge(payload)`** : `interval`/`intervalUnit` ne sont pas des
  colonnes, `merge` les poserait en propriétés parasites et la cadence ne changerait **jamais**, sans
  erreur. Merge explicite, champ par champ.
- `fromMinutes` prend la **plus grande unité qui divise exactement** : 90 reste « 90 minutes », pas
  « 1,5 heure » — un arrondi silencieux sur une cadence est ce qu'on évite.
- ⚠️ L'aller-retour n'est **pas** symétrique dans les deux sens, contrairement à CC-57 :
  `toMinutes(fromMinutes(m)) === m` vaut pour tout `m`, mais `fromMinutes(toMinutes(v, u))` ne rend
  le couple d'origine que s'il est **canonique** (`(60, 'minutes')` → `(1, 'hours')`).

### L'horaire mural : le second mode, et pourquoi ce n'en est pas un troisième réglage

⚠️ **Deux modes discriminés par `schedule_mode`** — `interval`, et `daily` (heure dans `daily_at`).
Ce n'est **pas** une unité de plus dans le sélecteur de CC-57 : un intervalle **dérive** — chaque
collecte en retard (redémarrage, passe lente, tick sauté) décale les suivantes, et « tous les jours
à 7h » passe à 8h30 en une semaine. Un horaire mural se **réancre** chaque jour.

```
now >= aujourdHui(HH:MM)  ET  lastFetchedAt < aujourdHui(HH:MM)
```

⚠️ **Le second membre remplace l'intervalle** : sans lui, la source serait recollectée à **chaque
tick** une fois l'heure passée. C'est un test d'appartenance à une fenêtre, pas de durée — c'est lui
aussi qui fait qu'un redémarrage à 10h ne rejoue pas la collecte de 7h. La boucle n'a pas changé : le
tick d'une minute avait déjà la granularité nécessaire.

⚠️ **Le fuseau est `config/veille.ts` (`APP_TIMEZONE`), et surtout PAS `TZ`** — ne les
« harmonise » pas. `TZ` (UTC ici) est le fuseau du **process**, et `last_fetched_at` est un
`timestamp without time zone` écrit et relu dedans : le changer ferait dériver toutes les lignes
déjà en base. `APP_TIMEZONE` ne situe que la **fenêtre horaire** — sans lui, « 7h » se déclencherait
à 9h à Paris l'été : la collecte aurait lieu, simplement pas quand l'écran le dit, **et rien ne le
signalerait**.

⚠️ **Un `APP_TIMEZONE` invalide fait échouer le démarrage, délibérément.** `setZone('Paris')` rend un
DateTime invalide, et toute comparaison avec un invalide est fausse : `isDue()` répondrait `false` à
chaque tick, indéfiniment, sans erreur ni log. Refuser de démarrer est le seul endroit où cet échec
a un lecteur — ne remplace pas ce `throw` par un repli silencieux.

**Trois décisions qui ne se devinent pas :**

- **La fenêtre manquée est rattrapée**, pas sautée (éteint à 7h, rallumé à 9h → on collecte à 9h) :
  sauter perdrait une journée de flux. Et le rattrapage ne décale pas le lendemain.
- **Une source neuve collecte tout de suite**, dans les deux modes — sinon une source ajoutée à 14h
  reste muette jusqu'au lendemain 7h et on ne sait pas si l'URL est bonne.
- **La cadence en minutes survit au passage en horaire** : revenir à l'intervalle retrouve la valeur.

⚠️ **L'exclusivité est une contrainte en base, `veille_sources_schedule_check`** — pas un `if` :

```sql
(schedule_mode = 'interval' AND daily_at IS NULL)
OR (schedule_mode = 'daily' AND daily_at IS NOT NULL)
```

Une seule contrainte nommée porte **et** l'énumération **et** la cohérence. Conséquence côté
contrôleur : **repasser en `interval` doit remettre `daily_at` à `null`**, sinon 500.

- ⚠️ **`isDue()` ne refuse PAS un mode `daily` sans heure : il retombe sur la branche intervalle.** La
  contrainte rend le cas inatteignable, mais un `return false` figerait la source pour toujours dans
  une boucle que personne ne regarde. Une source qui collecte à la mauvaise cadence se voit ; une
  source qui ne collecte plus, non.
- ⚠️ **Le test est `=== 'daily'`, jamais `=== 'interval'`** : le défaut est en base, pas sur le
  modèle, donc `create()` sans le champ le laisse `undefined` en mémoire. La non-régression est
  structurelle, pas une convention.
- ⚠️ **Le driver `pg` rend un `time` en `'07:00:00'`**, là où `<input type="time">` veut `'07:00'` :
  donné tel quel le champ resterait **vide** sans un mot. D'où `normalizeTimeOfDay`, appelé à chaque
  dérivation du brouillon.
- ⚠️ **La page poste le mode et *seulement* les champs de ce mode** : une heure envoyée avec un mode
  `interval` enregistrerait un réglage inerte, affiché comme saisi et jamais appliqué.

**Le rafraîchissement manuel a deux comportements, et c'est voulu** : une source → **synchrone**
(seul moyen de vérifier une source qu'on vient d'ajouter, borné par le timeout de 10 s) ; toutes →
**asynchrone**, vingt sources à 10 s tenant la requête HTTP au-delà de ce qu'un navigateur accepte.

## Recherche, tri, pagination

`search_vector` est **`GENERATED ALWAYS AS … STORED`** (tsvector `french` sur `title` + `content`)
avec index GIN : Postgres la maintient seul, **l'application ne l'écrit jamais** et elle n'existe pas
sur le modèle Lucid. Recherche par `whereRaw("search_vector @@ plainto_tsquery('french', ?)", …)` —
tout `whereRaw` **reste paramétré**.

⚠️ **Élargir `title` ou `content` demande de supprimer la colonne, faire l'`ALTER`, puis la recréer
avec son index GIN.** Oublier l'index ne casse rien de visible : la recherche répond toujours, en
`seq scan`. Panne silencieuse.

`orderByRaw('coalesce(published_at, created_at) DESC, id DESC')`, index dédié. ⚠️ **`id` en second
critère rend l'ordre total** : sans lui, deux items publiés à la même seconde peuvent s'échanger
entre deux requêtes, et la pagination sauterait ou répéterait une ligne pendant qu'une collecte
tourne. `published_at` prime sur `created_at`, sinon un article publié il y a trois jours mais
collecté aujourd'hui remonterait en tête.

Pagination Lucid, 50 par page ; tout changement de filtre repart à la page 1. ⚠️ **La page demandée
est bornée à la dernière page réelle, côté serveur** : supprimer les derniers items d'une page
laisse une page qui n'existe plus, et l'écran afficherait « Aucun résultat » — le message qui fait
croire que le filtre est en cause. Le bornage est dans `index` et **pas dans la page** parce que le
retour d'une suppression est un `redirect().back()`, donc vers l'URL qui porte encore `?page=4` ; il
couvre du même coup une collecte qui change le total et une URL tapée à la main. Le **filtre**, lui,
n'est jamais touché : vider « Image » en plusieurs passes est le geste normal de cet écran.

## Pièges techniques

- **Tags et compteurs sont calculés en SQL** (`VeilleStatsService`), plus par un `VeilleItem.all()`
  qui hydratait toute la table pour produire quatre entiers. ⚠️ **La page consomme la prop `tags`,
  elle ne dérive plus la liste affichée** : sinon un clic sur un tag réduisait `items` à ce tag, la
  barre s'effondrait, et choisir un second tag imposait de repasser par « Tout ».
- ⚠️ **Postgres rend `count()` en `bigint`, donc en chaîne** : sans `Number()`, les additions
  deviennent des concaténations.
- ⚠️ **`readingQueue` se lit en booléen, pas en truthy** : `?readingQueue=false` arrive en `"false"`,
  truthy — le filtre s'activait à la première navigation et ne se désactivait plus. D'où `asBool`.
- **`tags` est un `text[]`, pas du JSON** : `@column()` nue, **sans** `prepare: JSON.stringify` ;
  filtrage `whereRaw('? = ANY(tags)', [tag])`. `metadata` est du `jsonb` et porte bien, lui,
  `prepare: JSON.stringify`.
- `captureValidator` ne couvre **pas** `tags` — ajouter le champ = étendre le validateur.
- **`title` et `url` sont en `text`, plus en `varchar(255)`** : beaucoup d'URL de flux dépassent 255
  caractères, c'était un 500 en pleine collecte. Ne les re-borne pas.
- **La FK source est `ON DELETE SET NULL`** : supprimer une source n'efface jamais l'historique lu.
  ⚠️ La suppression de source n'est pas exposée, seulement la désactivation. Si elle l'était : les
  items perdraient leur source et deviendraient irréconciliables, leur clé `immich:` bloquant toute
  réinsertion.
- `metadata` porte `{ sourceTitle, guid }`, et `{ sourceTitle, durationSeconds }` côté Immich ;
  **l'identifiant de l'asset n'y est PAS** — il ne vit que dans `dedup_key`. Le recopier en ferait
  une seconde source de vérité à synchroniser pour rien.
- **`veille_items.url` est nul pour un média** : le lien vers Immich se construit à l'affichage. Figé
  en base, il pointerait sur l'ancien domaine le jour d'un déménagement et **tous** les liens
  casseraient en silence.
- **Le retour arrière de la migration `…191403` DÉTRUIT les items média** : une collecte les
  reconstruit tous, seul ce que le module a produit (lu/non-lu, file, tags) est perdu.

## Tests

Le détail par fichier est dans [TESTS.md](./TESTS.md) — à lire avant de **modifier un test**, pas
avant de modifier le module. Ce qui doit rester présent en permanence :

- **Aucun test ne touche le réseau** : `fake_feed_fetcher.ts` et `fake_immich_client.ts` remplacent
  les clients dans le conteneur (`app.container.swap`), les flux viennent de
  `tests/fixtures/feeds/*.xml`. Seule exception délibérée : `veille_feed_redirect.spec.ts`.
- ⚠️ **Pour Immich c'est une propriété du dispositif, pas une promesse** : `.env.test` **vide les
  trois `IMMICH_*`**. Sans ça, `.env.test` surchargeant `.env`, les tests hériteraient de l'instance
  réelle du poste — clé d'API comprise — et un `swap` oublié suffirait à faire partir de vraies
  requêtes vers une vraie bibliothèque de photos pendant `npm test`. Les tests qui ont besoin d'une
  configuration en passent une explicitement : **ne rétablis pas une lecture directe de
  `immichConfig` dans `ensureSource`.**
- ⚠️ **Les six tests de filtre `deleted_at` se ressemblent** assez pour qu'un faux-positif y passe
  inaperçu — vérifiés mordants un par un. Ne les allège pas.
- ⚠️ **Aucune page de ce module n'a de test de composant** — différent de « le dépôt n'en a pas »,
  il en a depuis CC-33. Le lu/non-lu, la pagination à l'écran et `last_error` se vérifient au
  navigateur ; les câbler est possible, pas fait.

## Limites connues — ne les fais pas passer pour couvertes

- **Le DNS rebinding n'est pas couvert, et c'est assumé** : la résolution du `fetch` est une seconde
  résolution, qu'un DNS hostile peut faire différer de notre contrôle. Le contrer demanderait de
  figer l'IP via un dispatcher undici sur mesure — disproportionné pour un tableau de bord
  mono-utilisateur où celui qui saisit les URL est celui qu'on protège.
- **Le lecteur vidéo est hors périmètre** : un clic ouvre l'asset dans Immich. Aucun flux vidéo ne
  traverse Command Center, seulement des vignettes de 20 Ko.
- ⚠️ **`/photos/<id>` n'a pas pu être vérifié par l'API** (Immich sert son interface en repli sur
  tout chemin, 200 et corps identique) : ça se vérifie au navigateur, en cliquant une vignette.
- **Aucune vue « corbeille », aucune restauration.** ⚠️ **Restaurer un asset depuis la corbeille
  d'Immich ne fait PAS revenir l'item** : la réconciliation ignore les supprimés dans les deux sens,
  sans quoi une mécanique de fond déferait une décision de l'utilisateur. Les 30 jours récupèrent les
  octets, pas la ligne.
- **La suite ne voit pas** : la boucle `setInterval` réelle (provider en `environment: ['web']`, donc
  absent des tests — `collectDue()` est appelée directement), la résolution DNS réelle, le rendu Vue.
