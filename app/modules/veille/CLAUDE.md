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
                                         + intervalWithinBounds / resolveIntervalMinutes
                                         + timeOfDay / scheduleFields
shared/interval.ts                       PUR · toMinutes / fromMinutes / unitBounds
                                         + parseTimeOfDay / normalizeTimeOfDay / formatSchedule
                                         partagé par le serveur ET la page Vue
shared/schedule_draft.ts                 PUR · la logique du brouillon de cadence de sources.vue :
                                         isDraftValid / schedulePayload / isScheduleDirty
                                         / switchUnit / boundsHint
```

⚠️ Ce module touche **trois** fichiers hors de son dossier : `start/routes.ts`,
`providers/veille_provider.ts` (déclaré dans `adonisrc.ts` sous `environment: ['web']`, comme le
provider Leitner) et **`config/veille.ts`** (le fuseau des collectes à heure fixe, voir plus bas).
Voir « Le déclenchement ».

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

**Aucun test ne touche le réseau** — `tests/fakes/fake_feed_fetcher.ts` remplace `FeedFetcher` dans le
conteneur (`app.container.swap`), les flux viennent de `tests/fixtures/feeds/*.xml`. Seule exception,
délibérée : le test de redirection ci-dessus.

Ce que la suite ne voit **pas** : la boucle `setInterval` réelle (le provider est en
`environment: ['web']`, donc absent des tests — `collectDue()` est appelée directement), la
résolution DNS réelle (la garde est testée sur des littéraux), et le rendu Vue.

⚠️ **Le dépôt sait écrire des tests de composant depuis CC-33** (Vitest, voir le `CLAUDE.md`
racine) — mais **aucune page de ce module n'en a**, et c'est différent de « le dépôt n'en a
pas », ce que cette section affirmait à tort jusqu'à CC-60. Le lu/non-lu, la pagination à l'écran
et l'affichage de `last_error` se vérifient donc toujours au navigateur ; ce qui a changé, c'est
que les câbler est désormais possible, pas qu'ils le soient.
