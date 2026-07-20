# Module Veille — sources · articles collectés · signets · notes

Routes `/veille` et `/veille/sources` · pages Inertia `modules/veille/index` et
`modules/veille/sources` · tables `veille_items`, `veille_sources`.

```
controllers/veille_controller.ts         index (filtres type/tag/source/readingQueue/unread/search
                                         + pagination) · store · toggleQueue · toggleRead
controllers/veille_sources_controller.ts index · store · update (activer/désactiver)
                                         · refresh (UNE source, SYNCHRONE) · refreshAll (async)
services/feed_fetcher.ts                 le SEUL point qui parle au réseau : garde SSRF, timeout,
                                         plafond de taille, etag/304, redirections re-validées
services/feed_parser.ts                  rss-parser (RSS 2.0 ET Atom) · HTML → texte · URL
                                         canonique · clé de dédup
services/veille_collector_service.ts     une passe : par source, isolée, insert ON CONFLICT
services/veille_scheduler.ts             la boucle en processus (démarrée par le provider)
services/veille_stats_service.ts         les agrégats SQL de la bande d'indicateurs et des tags
models/veille_source.ts                  le robinet · isDue()
models/veille_item.ts                    ce qui en sort · types article · bookmark · note
validators/veille.ts                     captureValidator · sourceValidator · sourceUpdateValidator
                                         + isPublicFeedUrl / isBlockedAddress (GARDE SSRF)
```

⚠️ Ce module touche **deux** fichiers hors de son dossier : `start/routes.ts` et
`providers/veille_provider.ts` (déclaré dans `adonisrc.ts` sous `environment: ['web']`, comme le
provider Leitner). Voir « Le déclenchement » plus bas.

## `type` dit ce que c'est, `kind` dit d'où ça vient

C'est le cœur du schéma, et la confusion qu'il existe pour dissiper. Avant CC-54, `veille_items.type`
valait `rss | bookmark | note` : il mélangeait la **provenance** (`rss`) et la **nature**
(`bookmark`, `note`), et imposait une migration par source nouvelle.

- **`veille_sources.kind`** porte la provenance (`rss` pour ce lot — qui couvre RSS 2.0 **et** Atom :
  même collecteur, même parseur).
- **`veille_items.type`** vaut `article | bookmark | note`. `rss` a été renommé `article`
  (migration `…191401`), `bookmark` et `note` n'ont pas bougé : **la capture manuelle continue
  d'exister**, elle n'a pas de source et ne doit jamais régresser.

⚠️ **`type` n'est pas un enum Postgres natif**, malgré le `table.enum()` de la migration d'origine.
Sans `useNative: true`, knex produit une colonne `text` plus une contrainte `CHECK` nommée
`veille_items_type_check`. Ajouter une valeur (`video`, `podcast` aux lots suivants) demande donc un
`DROP CONSTRAINT` / `ADD CONSTRAINT`, **pas** un `ALTER TYPE … ADD VALUE`.

⚠️ La liste des types est écrite à **trois** endroits : `VeilleItemType` (modèle), la contrainte
CHECK (migration), `captureValidator` (VineJS). Les trois bougent ensemble.

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
```

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

## Le déclenchement — une boucle en processus, pas une file

Ce projet n'a **aucune infrastructure de job**, et le lot 1 n'en introduit pas. Comme l'ingestion
Leitner : une tâche de fond dans le processus, démarrée par un provider sous `environment: ['web']`
(ni `node ace`, ni les tests n'ont de collecte à faire tourner).

`veille_scheduler` regarde **toutes les minutes quelles sources sont dues** — il ne collecte pas tout
à chaque tick. La cadence réelle est portée par `fetch_interval_minutes`, source par source, et une
source jamais collectée est due immédiatement (`VeilleSource.isDue`).

⚠️ **Différence assumée avec Leitner : aucun statut « en cours » n'est persisté**, donc **rien à
balayer au démarrage**. Un redémarrage en pleine passe ne laisse rien de sale : la collecte est
idempotente par construction (contrainte d'unicité), elle est simplement rejouée au tick suivant. Un
`sweepInterrupted` ici serait du code sans objet — ne l'ajoute pas par symétrie.

⚠️ **La garde anti-chevauchement (`running`) vit en mémoire : elle suppose une seule instance.** À
plusieurs, deux processus feraient le travail en double — sans rien corrompre pour autant : c'est la
**contrainte d'unicité en base** qui garantit l'absence de doublon, jamais ce booléen.

⚠️ **`timer.unref()`** — sans lui, le timer suffit à retenir le processus.

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
  la désactivation (`active`).
- `metadata` porte `{ sourceTitle, guid }` pour les items collectés — la colonne, restée vide depuis
  la création du module, sert enfin.

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
  **l'etag non mémorisé quand l'insert a échoué**.
- `tests/functional/modules/veille_items.spec.ts` — **CC-20** : la recherche plein texte (dont
  l'apostrophe, l'injection SQL et les caractères spéciaux — avec une assertion sur le **résultat**,
  pas seulement sur l'absence de crash), le filtre par tag accentué, `store`, `toggleQueue`,
  `toggleRead`, la pagination sans chevauchement, et que **la capture manuelle survit à la
  migration**.

**Aucun test ne touche le réseau** — `tests/fakes/fake_feed_fetcher.ts` remplace `FeedFetcher` dans le
conteneur (`app.container.swap`), les flux viennent de `tests/fixtures/feeds/*.xml`. Seule exception,
délibérée : le test de redirection ci-dessus.

Ce que la suite ne voit **pas** : la boucle `setInterval` réelle (le provider est en
`environment: ['web']`, donc absent des tests — `collectDue()` est appelée directement), la
résolution DNS réelle (la garde est testée sur des littéraux), et le rendu Vue — ce dépôt n'a aucun
test de composant. Le lu/non-lu, la pagination à l'écran et l'affichage de `last_error` se vérifient
au navigateur.
