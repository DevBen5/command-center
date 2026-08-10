# Index des tests — module Coffre

Écrit **à la main**, rien ne le génère. `tests/unit/tests_index.spec.ts` (CC-112) vérifie dans les
deux sens qu'aucune spec du module n'en est absente et qu'aucun chemin cité n'a disparu du disque.
⚠️ Il asserte la **mention**, jamais l'exactitude : une phrase devenue fausse ici passe au vert.

## Ce que la suite prouve, et ce qu'elle ne peut pas prouver

Le lot porte quatre affirmations, et elles ne se vérifient pas au même endroit :

| affirmation | où elle se prouve |
|---|---|
| une route du coffre sans élévation **refuse** | `tests/functional/modules/coffre_wall.spec.ts` |
| l'élévation **expire** | idem, plus `tests/unit/coffre_vault_session.spec.ts` pour la borne |
| le contenu **n'est pas lisible en base** | `tests/functional/modules/coffre_storage.spec.ts`, sur la **colonne brute** |
| le module **n'apparaît nulle part** dans l'interface | `tests/functional/modules/coffre_curtain.spec.ts` |
| un mot de passe **ne descend pas dans la liste** | `tests/functional/modules/coffre_credentials.spec.ts`, sur la prop Inertia **et** sur le SQL |
| éditer **remplace** en base, un mot de passe vide ne l'efface pas (CC-186) | `coffre_storage.spec.ts` (remplacement, cloisonnement) et `coffre_credentials.spec.ts` (rotation, préservation, type non postable) |
| une référence de média n'est pas lisible en clair en base, s'ajoute/se retire sans oracle d'existence (CC-180) | `coffre_storage.spec.ts` (colonne brute, dédup, cloisonnement) |
| le proxy de vignette refuse sans élévation, sert la bonne image sans cache, absorbe une panne Immich en 404 (CC-180) | `coffre_media.spec.ts`, plus `coffre_wall.spec.ts` pour le mur |
| une référence de média NAS n'est pas lisible en clair en base, s'ajoute/se retire sans oracle d'existence, `kind` dérivé de l'extension (CC-181) | `coffre_storage.spec.ts` (colonne brute, dédup, cloisonnement) |
| le résolveur de racines NAS refuse une traversée, un lien symbolique posé DANS une racine et pointant DEHORS, et un chemin absolu — contre un vrai filesystem, photos et vidéos confondues (CC-181) | `coffre_nas_roots.spec.ts` |
| le proxy de streaming refuse sans élévation, sert le corps entier (photo/vidéo) ou une plage `Range` exacte (vidéo), refuse une plage invalide, absorbe une résolution ratée **et un DOSSIER portant une extension autorisée** en 404 (CC-181) | `coffre_nas.spec.ts`, plus `coffre_wall.spec.ts` pour le mur |
| l'écran range les entrées en sections par nature, une entrée avec média (Immich ou NAS) primant sur son `type`, exclusivement, une section sans entrée n'apparaît jamais (CC-204) | `coffre_entry_sections.spec.ts` |
| le client de session Immich réutilise entre requêtes, coordonne les logins concurrents, retente UNE fois sur expiration, ferme la session précédente avant d'en ouvrir une autre, ne retente jamais un login/PIN refusé (CC-205) | `coffre_immich_session_client.spec.ts` |
| le dossier verrouillé et sa vignette refusent sans élévation, le listing rend `available: false` sur une panne plutôt qu'une erreur, la vignette absorbe un échec en 404 (CC-205) | `coffre_immich_folder.spec.ts`, plus `coffre_wall.spec.ts` pour le mur |
| un asset verrouillé (clé d'API refusée) est servi par le repli en session du proxy existant (CC-205) | `coffre_media.spec.ts` |
| l'activation du dossier verrouillé exige les quatre variables, et n'y touche jamais en test (CC-205) | `coffre_immich_config.spec.ts`, plus `tests/unit/env_isolation.spec.ts` pour l'isolation |
| l'accueil complète les quatre sections y compris vides, une page de section ne rend que les entrées de sa nature (CC-208) | `coffre_entry_sections.spec.ts` (`sectionCardsFor`, pur) et `coffre_section_pages.spec.ts` (le contrôleur, contre une vraie base) |
| le listing de catalogue Immich extrait nature/nom/date/taille avec repli sur `null`/`'other'`, jamais une valeur devinée, plafond d'indexation séparé de l'affichage (CC-225) | `coffre_immich_session_client.spec.ts` (groupe « le catalogue Immich ») |
| l'adaptateur Immich de l'abstraction `CatalogSource` traduit vers `CatalogSourceItem` sans rattraper une panne d'énumération (CC-225) | `coffre_catalog_source_immich.spec.ts` |
| le couple (owner, source, référence) est unique en base, une énumération réussie mais TRONQUÉE ou en ÉCHEC ne marque rien absent, une seconde synchro identique n'insère aucun doublon, chaque compte reçoit sa propre copie (CC-225) | `coffre_catalog_sync.spec.ts` |
| le parcours des racines NAS refuse un lien sortant, ne boucle jamais sur un cycle (y compris un lien pointant vers un dossier ordinaire déjà sur le chemin), distingue une racine absente (lève) d'une racine vide, ignore les dossiers spéciaux Synology, indexe une extension hors allow-list en `other`, préserve la casse, contre un vrai filesystem (CC-226) | `coffre_nas_directory_walker.spec.ts` |
| l'adaptateur NAS de l'abstraction `CatalogSource` délègue au parcours sans rattraper une racine absente (CC-226) | `coffre_catalog_source_nas.spec.ts` |
| la commande `coffre:sync-catalog` avec la source NAS réelle : découverte avec métadonnées exactes, racine absente → échec propre et catalogue INTACT, second passage sans doublon, fichier supprimé du disque marqué absent puis réapparu (CC-226) | `coffre_catalog_sync_nas.spec.ts` |
| `COFFRE_NAS_ROOTS` exige un identifiant déclaré par racine (`nom=chemin`), échoue au démarrage sur une racine sans nom, un nom vide, un nom portant `/`, ou deux racines de même nom ; la référence de catalogue porte cet identifiant, deux racines partageant un fichier de même chemin relatif produisent deux lignes distinctes (CC-233) | `coffre_nas_config.spec.ts`, `coffre_nas_directory_walker.spec.ts`, `coffre_catalog_sync_nas.spec.ts` |
| le générateur de vignettes NAS lit réellement les 5 formats photo (dont un HEIC RÉEL, jamais un fichier renommé — le codepath que `sharp` ne couvre pas), borne dimensions et octets de sortie, refuse une source trop volumineuse AVANT tout appel au binaire, refuse un fichier corrompu ou un dossier-piège sans exception non catchée (CC-228) | `coffre_nas_thumbnail_generator.spec.ts` |
| `thumbnailFor()` du catalogue NAS résout TOUJOURS contre la racine nommée de la référence, jamais l'essai-dans-l'ordre — reproduit l'angle « vignette » de la collision CC-233 (CC-228) | `coffre_catalog_source_nas.spec.ts`, `coffre_nas_roots.spec.ts` (`resolveInRoot`) |
| le cache de vignettes est chiffré par la clé du coffre (colonne brute illisible), un chiffré illisible est traité comme une absence (jamais un refus), une regénération REMPLACE la ligne (CC-228) | `coffre_catalog_thumbnail_cache.spec.ts` |
| la route de vignette du catalogue NAS refuse sans élévation, sert une photo réelle ET un HEIC réel, ne régénère pas au second appel, absorbe un item inconnu/d'un autre compte/de source Immich/corrompu/introuvable en 404 uniforme (CC-228) | `coffre_catalog_nas_thumbnail.spec.ts`, plus `coffre_wall.spec.ts` pour le mur |

⚠️ **Le troisième est celui qu'un test rend faussement vert.** Relire ce qu'on vient d'écrire
réussirait à l'identique sans le moindre chiffrement ; seul un `select` qui court-circuite le modèle
et le service dit quelque chose.

⚠️ **Le quatrième n'est prouvé que parce que le module est ACTIVÉ en test.** Sur un module éteint,
l'absence de destination serait une conséquence de `MODULES`, pas du rideau.

## Les fichiers

### `tests/unit/coffre_crypto.spec.ts`

Le chiffrement, **pur**. Ce qui compte n'est pas l'aller-retour (il réussirait sans chiffrement)
mais ce qui **échoue** : mauvaise clé refusée par le tag GCM, chiffré altéré d'un octet refusé,
charge malformée qui rend `null` au lieu de lever, chiffré qui ne contient le clair ni tel quel ni
en base64, deux chiffrements du même clair qui diffèrent (l'IV est bien tiré au sort), témoin qui
ne s'ouvre qu'avec sa clé, témoin illisible qui **refuse** au lieu d'ouvrir.

### `tests/unit/coffre_vault_session.spec.ts`

Le marqueur d'élévation, **pur**, et ses trois conditions — chacune sur son test : la borne d'âge
prise à une seconde de part et d'autre, le marqueur d'un autre compte, et surtout **« une élévation
ne survit pas à une reconnexion »**, le trou que `auth.logout()` laisserait ouvert. Plus la table
des valeurs illisibles, traitées comme absentes.

### `tests/unit/coffre_keyring.spec.ts`

Le trousseau en mémoire : pointeurs distincts à chaque ouverture, expiration à la **même** borne que
le marqueur, cloisonnement par compte, pointeur inconnu (le cas d'un redémarrage), fermeture unitaire
et en bloc, et l'effacement du tampon de clé. ⚠️ Une instance neuve par test, jamais le singleton —
sinon l'ordre d'exécution déciderait du résultat.

### `tests/unit/coffre_entry_sections.spec.ts`

Le regroupement de l'écran par nature (CC-204), **pur** — `shared/entry_sections.ts`, hors de portée
de `pages/index.vue` : partition exclusive des trois types, priorité de « photo » sur `type` dès
qu'un média Immich ou un fichier NAS est présent (l'un, l'autre, les deux à la fois), une section
sans entrée absente du résultat plutôt que rendue vide, ordre des sections fixe indépendamment de
l'ordre d'arrivée des entrées, ordre interne d'une section jamais retrié (suppose `created_at desc`
déjà appliqué côté serveur), et chaque entrée comptée exactement une fois.

Depuis CC-208, deux groupes de plus, toujours **purs** : `sectionCardsFor` (les quatre cartes de
l'accueil, TOUJOURS les quatre — complétion vérifiée y compris sur une base vide, contrat de
`groupEntriesByNature` inchangé) et `sectionKeyFromSlug`/`SECTION_SLUGS` (l'aller-retour des quatre
segments d'URL français, et un segment inconnu qui ne résout à rien).

### `tests/functional/modules/coffre_wall.spec.ts`

Le mur. Quatre routes murées en 403 **avec un compte réellement capable et une session réellement
valide**, le pendant qui passe une fois l'élévation posée (sans lui, un mur qui refuserait tout
passerait au vert), l'expiration, le marqueur d'un autre compte, le cloisonnement de `coffre.write`,
et la session révoquée qui est expulsée **en amont** (302 vers `/login`, pas 403).

⚠️ Le premier test **lit le routeur** pour asserter que `coffreOuvert` est branché. Il a été ajouté
après mesure : sans lui, retirer le middleware de `start/routes.ts` laissait les dix autres verts,
le `#key()` du contrôleur rendant le même 403. La route d'édition (CC-186), le proxy de vignette
(CC-180), le proxy de streaming NAS (CC-181), les deux routes du dossier verrouillé (CC-205), la
page de section (CC-208) et la vignette du catalogue NAS (CC-228) y entrent pour la même raison,
mesurée à l'identique : les retirer du mur ne fait rougir QUE cette assertion-là.

### `tests/functional/modules/coffre_unlock.spec.ts`

La porte, avec un vrai code TOTP. C'est la moitié que le fichier précédent ne peut pas tenir : là-bas
le marqueur est forgé, ici il est **écrit par la route**. Ouverture complète, code faux, passphrase
fausse, compte sans second facteur, throttle de CC-147 (avec sa seconde moitié : après `clear`, ça
rouvre — sinon le test passerait sur une porte qui refuse tout), création du coffre et **refus d'un
second coffre**, verrouillage.

### `tests/functional/modules/coffre_storage.spec.ts`

Ce que la base porte vraiment. Titre **et** contenu absents des colonnes, en clair comme en base64 ;
la relecture par la page qui rend bien le clair ; le chiffré qui ne descend jamais au navigateur ;
et le cloisonnement par compte en lecture **et** à la suppression — vérifié en base, jamais sur le
code de réponse, la suppression ne devant pas être un oracle d'existence.

Depuis CC-186 : l'édition **remplace** la colonne en base (même ligne, chiffré différent — la
mutation l'a confirmé) plutôt que d'en ajouter une, et le cloisonnement par compte vaut aussi pour
elle, vérifié en base comme pour la suppression.

Depuis CC-180, un groupe séparé (« Coffre / les médias ») couvre les références Immich :
`asset_id_cipher` illisible en clair et en base64 sur `coffre_entry_media` ; coller deux fois le
même UUID à la création ne pose qu'une ligne (dédup) ; `media.add`/`media.remove` sur l'édition
ajoutent/retirent réellement, vérifié en base (compte de lignes, id de la ligne restante) ; et
retirer l'id de média d'un autre compte ne supprime rien — même doctrine que la suppression
d'entrée, vérifiée en base et pas sur le code HTTP (toujours 302).

Depuis CC-181, un groupe de plus (« Coffre / les médias NAS ») couvre les références NAS — photos
ET vidéos, à l'identique : `path_cipher` illisible en clair et en base64 sur
`coffre_entry_nas_file` ; `kind` (« video »/« photo ») bien dérivé de l'extension, lui EN CLAIR
(pas le secret que la colonne protège) ; dédup à la création ; `nasFiles.add`/`nasFiles.remove`
vérifiés en base ; cloisonnement par compte au retrait.

### `tests/functional/modules/coffre_credentials.spec.ts`

Les identifiants (CC-179), en trois groupes. **Ce que la base porte** : le mot de passe absent de
`secret_cipher` en clair comme en base64, service et identifiant toujours chiffrés, et le cas où le
formulaire poste un mot de passe avec une **note** — le service ne l'écrit pas. **Ce que la liste ne
porte pas** : la prop Inertia sérialisée, sur une entrée dont on vient de vérifier qu'elle a bien un
secret ; puis le **SQL** de `listQueryFor`. **La révélation** : `GET /coffre/:id/secret` rend le
clair avec `cache-control: no-store`, l'entrée d'un autre compte rend 404 sans souffler la valeur,
une note n'a rien à révéler, et un chiffré altéré **refuse** en 422 au lieu de rendre un secret vide.

⚠️ **Les deux assertions de la liste ne font pas double emploi, et la mutation l'a prouvé.** Deux
mécanismes indépendants gardent le mot de passe hors de la charge utile : le `select` qui ne charge
pas la colonne, et la vue construite champ par champ, qui n'a pas de place pour un secret. En
retirant le `select`, la charge utile **reste propre** et sept des huit tests restent verts. Même
famille que le premier test de `coffre_wall.spec.ts` : on lit le mécanisme, pas seulement le
résultat.

⚠️ **Et `notInclude(sql, 'secret_cipher')` ne suffit pas non plus** — mesuré au même moment. Sans le
`select`, la requête devient `select * …` : elle charge la colonne **sans la nommer**, donc
l'assertion d'absence passe au vert sur le code qu'elle interdit. C'est `notInclude(sql, 'select *')`
qui porte la règle réelle — « les colonnes sont énumérées, et celle-là n'y est pas ».

Depuis CC-186, un groupe de plus couvre l'édition : la rotation d'un mot de passe (le chiffré
change, l'ancien secret n'est plus rendu, le nouveau l'est), sa **préservation** quand le champ est
laissé vide (mutation vérifiée : sans le garde, le test rougit et lui seul), et l'absence d'effet
d'un mot de passe posté en éditant une note — la validation ne portant pas de champ `type`, il n'y a
rien à contourner côté client.

### `tests/functional/modules/coffre_media.spec.ts`

Le proxy de vignette (CC-180), avec `FakeImmichClient` — **le même que la veille**, `ImmichClient`
vivant désormais dans `#core/shared/services/immich_client`. Un média connu rend l'image avec le
bon `content-type`, `cache-control: no-store` et `pragma: no-cache` ; un id de média inconnu, le
média d'un autre compte, et une panne du client Immich (asset non scripté) rendent tous 404.

⚠️ **Le repli HTML d'Immich (`content-type: text/html`) n'est PAS re-testé ici.** C'est
`ImmichClient.thumbnail()` — partagé, prouvé par `tests/unit/veille_immich_client.spec.ts` — qui
l'assure ; `FakeImmichClient` remplace la couche API tout entière, comme pour la veille. Ce qui se
prouve ici, c'est ce que le contrôleur du coffre fait d'un succès et d'un échec de cette couche,
jamais le transport lui-même.

Depuis CC-205, deux tests de plus : un asset dont la clé d'API échoue (aucun asset scripté dans
`FakeImmichClient`, comme le ferait une vraie clé sur `visibility: locked`) est servi par
`FakeImmichSessionClient` — le repli fonctionne ; et les deux modes en échec restent un 404 propre,
jamais une erreur brute.

### `tests/unit/coffre_immich_session_client.spec.ts`

Le client de session Immich du dossier verrouillé (CC-205), `fetch` mocké — aucun test ne touche le
réseau ni une vraie instance, comme `veille_immich_client.spec.ts`. Login puis unlock avec le jeton
en `Authorization: Bearer` sur l'appel de données ; réutilisation entre deux appels (une seule paire
login+unlock) ; des appels CONCURRENTS ne déclenchent qu'un seul login (le cas réel de la grille de
vignettes) ; un 401 sur un appel de données déclenche une reprise UNIQUE, jamais une boucle ; la
session précédente est fermée (`/api/auth/logout`) avant qu'une nouvelle ne s'établisse ; des
identifiants ou un PIN refusés ne sont JAMAIS retentés ; le repli HTML d'Immich sur le login ;
aucune redirection suivie ; la pagination en chaîne (`nextPage` en string) et son plafond
(`truncated`) ; un identifiant malformé sauté sans faire échouer le listing ; `closeSession` ferme
une session ouverte et ne fait rien sans session.

⚠️ **Une `ImmichSessionState` neuve à chaque test, jamais le singleton par défaut** — même doctrine
que `VaultKeyring` (CC-178) : le singleton est un état partagé entre tous les tests du process, et
l'ordre d'exécution déciderait du résultat.

Depuis CC-225, un second groupe (« le catalogue Immich ») couvre `lockedAssetsForCatalog()` :
extraction de nature/nom/date/taille quand Immich les rend, repli sur `null`/`'other'` sur des
champs absents ou malformés (jamais une valeur devinée, jamais un crash), identifiant malformé
sauté (même doctrine que `lockedPhotos`), pagination sur plusieurs pages, et une session refusée
en cours de listing qui lève sans rendre de résultat partiel.

### `tests/unit/coffre_immich_config.spec.ts`

La configuration du dossier verrouillé (CC-205), **pure** — sur le patron de
`veille_youtube_config.spec.ts`. `enabled` exige les QUATRE valeurs (base URL, email, mot de passe,
PIN) ; retrait des blancs et du slash parasite sur l'hôte et l'email, JAMAIS sur le mot de passe ni
le PIN (un espace en fait partie, même doctrine que la passphrase du coffre) ; délai par défaut
repris d'`IMMICH_DEFAULT_TIMEOUT_MS`.

### `tests/functional/modules/coffre_immich_folder.spec.ts`

Le dossier verrouillé (CC-205), avec `FakeImmichSessionClient` — remplace la couche API tout
entière, même doctrine que `coffre_media.spec.ts`. Le listing rend les photos scriptées avec
`cache-control: no-store` ; une panne de la session rend `available: false` en 200, jamais une
erreur brute ; la vignette d'une photo connue est servie avec le bon `content-type` ; un identifiant
qui n'est pas un UUID Immich rend 404 SANS appeler le client (`isImmichAssetId` en amont) ; une
vignette inconnue du client rend 404.

⚠️ **Le mur (l'élévation requise) se prouve dans `coffre_wall.spec.ts`, pas ici** — même répartition
que les deux autres proxies du module.

### `tests/unit/coffre_nas_roots.spec.ts`

Le résolveur de racines de médias NAS (CC-181), **pur-ish** : fs réel, aucune requête HTTP ni
base. Un dossier temporaire par test, dont un vrai lien symbolique posé DANS la racine autorisée
et pointant DEHORS — le cas qu'une comparaison de chaînes avant `realpath` ne voit pas. Couvre les
trois chemins hostiles du ticket (traversée, lien symbolique, absolu), un chemin légitime,
plusieurs racines dont une non montée (ignorée sans lever), et l'absence de toute racine
configurée. Ne teste rien de spécifique à une nature de fichier : le résolveur ne connaît que des
chemins.

Depuis CC-228, un second groupe couvre `resolveInRoot()` : résout contre la racine nommée, **ne
retombe JAMAIS sur une autre racine** (deux racines de fixtures portant chacune un fichier de même
chemin relatif, chaque appel rend le chemin réel de SA racine, jamais celui de l'autre — l'angle
« vignette » de la collision CC-233), identifiant de racine inconnu → `null`, traversée et chemin
absolu toujours refusés.

### `tests/unit/coffre_nas_thumbnail_generator.spec.ts`

Le générateur de vignettes ImageMagick (CC-228), avec le **binaire réel** (`magick`), jamais
mocké — même doctrine que ce fichier pour le filesystem. Un JPEG synthétisé plus grand que la
borne est réellement redimensionné (dimensions relues via `magick identify` sur les octets
rendus) ; un HEIC **réel** (fixture commitée `tests/fixtures/coffre_nas_thumbnail.heic`, encodé
avec `libheif`+`x265`, jamais un fichier renommé) rend une vignette JPEG — le codepath précis que
la mesure a écarté pour `sharp` ; PNG/WEBP/GIF réels rendent tous une vignette JPEG. Une extension
hors de l'allow-list photo est rejetée SANS invoquer le binaire ; un contenu qui ne correspond pas
à son extension (payload MVG déguisé `.jpg`, la famille ImageTragick) échoue proprement, jamais
exécuté ; un fichier volontairement énorme (`MAX_NAS_THUMBNAIL_SOURCE_BYTES + 1`, garbage — pas une
vraie image) est rejeté sur la SEULE taille, avant tout appel au binaire ; un dossier-piège
(`album.jpg` est un dossier) et un fichier disparu rendent tous deux un refus, jamais une
exception non catchée.

⚠️ **Ces tests exigent `magick` sur le PATH** — installé localement via `winget` pour ce lot
(2026-08-10), avec l'accord du propriétaire, pour que la génération réelle soit prouvée plutôt que
skippée. Sans lui, seule l'image publiée reste la preuve — comme le reste du dépôt pour le build
multi-arch.

### `tests/unit/coffre_nas_config.spec.ts`

Le format `nom=chemin` de `COFFRE_NAS_ROOTS` (CC-233), **pur**. Une racine, plusieurs racines dans
l'ordre déclaré, absente/vide → aucune racine, blancs retirés autour du nom et du chemin. Quatre
gardes de démarrage : une racine sans `nom=` échoue avec un message qui nomme le remède, un
identifiant vide échoue, un identifiant portant un `/` échoue (il entre dans une référence), deux
racines de même identifiant échouent (il sert de clé). Un chemin contenant lui-même un `=` reste
intact : seul le PREMIER `=` de l'entrée sépare le nom du chemin.

### `tests/unit/coffre_nas_file_format.spec.ts`

L'allow-list de formats (CC-181), **pure**. `nasContentTypeFor`/`nasFileKindFor` sur une extension
vidéo connue, une extension photo connue, la casse (sans effet), une extension hors allow-list
(`null`, jamais un type deviné), un chemin sans extension.

### `tests/unit/coffre_byte_range.spec.ts`

Le parseur de l'en-tête `Range` (CC-181), **pur**. Plage simple, ouverte (`start-`), suffixe
(`-N`), bornes hors taille, multi-range (refusé), syntaxe invalide, ressource de taille nulle.

### `tests/functional/modules/coffre_nas.spec.ts`

Le proxy de streaming (CC-181), avec `NasRootsService` substitué par une vraie racine de
fixtures (`app.container.swap`, même patron que `FakeImmichClient`). Vidéo sans `Range` → 200
corps entier ; `Range` valide → 206 avec le segment exact ; `Range` hors bornes → 416 ; photo →
200 avec le bon `content-type`, sans `Range` ; média inconnu, média d'un autre compte, et
référence qui ne résout sous aucune racine (fichier disparu) rendent tous 404, jamais une erreur
brute.

### `tests/functional/modules/coffre_section_pages.spec.ts`

Les pages de section (CC-208), contre une vraie base. `GET /coffre/<section>` ne rend que les
entrées de la nature demandée — y compris le cas qui prouve que le filtre passe par
`groupEntriesByNature` et non par une requête `where('type', …)` : une entrée `type: 'note'`
porteuse d'un média sort dans `/coffre/photos`, jamais dans `/coffre/notes`. Une section sans
entrée rend une liste vide (200), un segment inconnu répond 404 (fermé par le `.where()` de la
route, avant le contrôleur).

⚠️ **Le mur de cette route se prouve dans `coffre_wall.spec.ts`, pas ici** — même répartition que
les autres routes du module.

Un second groupe, dans le même fichier, prouve `redirect().back()` sur `store` (CC-208) : ajouter
depuis `/coffre/notes` (`referrer` posé sur la requête de test) ramène à `/coffre/notes`, ajouter
depuis `/coffre` y reste — le seul cas qui existait avant ce lot, donc le comportement à ne pas
casser. `update`/`destroy` partagent le même appel (`response.redirect().back()`), non re-testé
séparément.

### `tests/unit/coffre_catalog_source_immich.spec.ts`

L'implémentation Immich de l'abstraction `CatalogSource` (CC-225), avec `FakeImmichSessionClient`
injecté directement (pas de `app.container.swap`, pas de DB) : `key` vaut `'immich_locked'`,
`enumerate()` traduit les assets vers `CatalogSourceItem` et propage `truncated`, une panne du
client remonte telle quelle (l'adaptateur ne l'avale jamais), `thumbnailFor()` délègue au client.

### `tests/unit/coffre_nas_directory_walker.spec.ts`

Le parcours récursif des racines NAS du catalogue (CC-226), contre un VRAI filesystem — même
doctrine que `coffre_nas_roots.spec.ts` : dossiers et liens symboliques réels, aucun mock. Une
racine vide rend 0 élément sans erreur ; une racine absente (ou aucune racine configurée) LÈVE,
jamais une liste vide ; un fichier de premier niveau et un fichier en sous-dossier sont découverts
avec leurs métadonnées réelles (taille, date de modification, chemin relatif) ; une extension hors
allow-list photo/vidéo est indexée en `other` ; la casse du chemin est préservée. Trois cas de
liens symboliques : un lien sortant de la racine n'est jamais indexé ; un lien vers un dossier
légitime AUSSI dans la racine est suivi normalement (deux références distinctes, ce n'est pas un
cycle) ; un cycle — y compris un lien pointant vers un ANCÊTRE atteint sans aucun lien — ne boucle
pas indéfiniment. Un second passage sur un contenu inchangé rend exactement les mêmes références.
Les dossiers spéciaux Synology (`@eaDir`, `#recycle`) et les dotfiles ne sont jamais indexés. Le
plafond anti-boucle rend `truncated: true` sans lever.

⚠️ **Depuis CC-233, `reference` porte l'identifiant de sa racine** (`<nom>/<chemin relatif>`), et
le fichier le prouve deux fois : un test dédié sur une racine unique nommée, et **le test qui
reproduit l'écrasement silencieux du ticket** — deux racines de fixtures portant chacune un fichier
de même chemin relatif produisent deux références distinctes (`principale/photo.jpg`,
`secondaire/photo.jpg`), jamais une seule.

### `tests/unit/coffre_catalog_source_nas.spec.ts`

L'implémentation NAS de l'abstraction `CatalogSource` (CC-226, `thumbnailFor` depuis CC-228), avec
une vraie racine de fixtures : `key` vaut `'nas'`, `enumerate()` délègue au parcours (déjà prouvé
en détail dans le fichier précédent — ce test-ci ne re-prouve pas les pièges du parcours) et ne
rattrape pas une racine absente.

`thumbnailFor()` : délègue via `resolveInRoot()` puis génère une vraie vignette (image réelle,
binaire réel) ; rejette une référence sans identifiant de racine ; **ne retombe JAMAIS sur une
autre racine** — deux racines de fixtures portant chacune un fichier `plage.jpg`, la référence
`secondaire/plage.jpg` rend bien le contenu de la racine SECONDAIRE (l'angle « vignette » de la
collision CC-233, complémentaire du test posé côté `coffre_nas_roots.spec.ts`) ; rejette une
référence dont la racine ne résout pas.

### `tests/functional/modules/coffre_catalog_sync_nas.spec.ts`

La source NAS bout-en-bout (CC-226) : `NasRootsService` substitué par une vraie racine de
fixtures, `ImmichSessionClient` substitué par un faux qui réussit toujours (catalogue vide) pour
ne pas contaminer les assertions de succès avec l'échec attendu de la source Immich non
configurée en test. Découverte réelle avec métadonnées exactes en base ; **le test le plus
important du lot** — une racine devenue absente entre deux passages fait échouer la commande et
laisse le catalogue INTACT ; un second passage identique n'insère aucun doublon ; un fichier
réellement supprimé du disque est marqué absent puis redevient présent s'il réapparaît.

⚠️ **Depuis CC-233, un test de plus reproduit l'écrasement silencieux CONTRE LA BASE** — le
symptôme réel que le ticket corrige : deux racines de fixtures portant chacune un fichier de même
chemin relatif, synchronisées, puis assertion que les DEUX lignes existent en base
(`principale/photo.jpg`, `secondaire/photo.jpg`). Sans l'identifiant de racine dans la référence,
`CatalogSyncService#applyEnumeration` trouverait la ligne du premier fichier en cherchant celle du
second et la mettrait à jour à sa place — une seule ligne, sans qu'aucune contrainte ne s'y
oppose ; c'est ce que ce test rougit sans le correctif.

### `tests/functional/modules/coffre_catalog_sync.spec.ts`

Le catalogue des sources (CC-225, lot 1 de l'épique CC-224), en deux groupes.

**La contrainte unique**, contre la vraie base : un second `(owner, source, référence)` identique
échoue à l'insertion ; le même triplet est permis sur deux comptes différents — c'est la décision
« par compte » du cadrage, prouvée plutôt que lue dans le code.

**La commande `coffre:sync-catalog`**, bout-en-bout avec `FakeImmichSessionClient` substitué dans
le conteneur : aucun coffre sur l'installation ne fait rien ; chaque compte avec un coffre reçoit
sa PROPRE copie des lignes découvertes ; une seconde synchronisation identique n'insère aucun
doublon et ne perd aucune ligne ; un élément disparu d'un listing **réussi et complet** est marqué
absent puis redevient présent s'il réapparaît ; **le test qui compte le plus du lot** — un listing
**tronqué** ne marque rien absent, et une énumération qui **échoue** ne touche à rien (ni écriture,
ni marquage), sur un catalogue déjà peuplé.

### `tests/functional/modules/coffre_catalog_thumbnail_cache.spec.ts`

Le cache de vignettes du catalogue NAS (CC-228), contre une vraie base — même doctrine que
`coffre_storage.spec.ts` : un aller-retour rend exactement les mêmes octets ; la **colonne brute**
ne porte ni le clair ni le clair en base64 (assertion sur les octets, pas sur une intention) ; un
chiffré illisible (mauvaise clé) est traité comme une ABSENCE, jamais un refus — la seule
exception à la doctrine « illisible ≠ absent » du reste du module, parce que cette ligne est
régénérable ; regénérer pour le même élément REMPLACE la ligne (une seule survit), jamais une
seconde ; aucune ligne rend `null`, jamais une exception.

### `tests/functional/modules/coffre_catalog_nas_thumbnail.spec.ts`

La route `GET /coffre/catalog/nas/:id/thumbnail` (CC-228), avec `NasRootsService` substitué par
une vraie racine de fixtures (même patron que `coffre_nas.spec.ts`). Une photo réelle rend une
vignette JPEG avec le bon `content-type`, `cache-control: no-store`, `pragma: no-cache` ; un HEIC
**réel** (la même fixture commitée que le générateur) rend aussi une vignette JPEG ; un second
appel sert le cache SANS régénérer — prouvé par un `CatalogSource` factice substitué dans le
conteneur qui compte ses appels (`callCount`), jamais par une inspection indirecte ; un élément
inconnu, celui d'un autre compte, un élément de source `immich_locked` (hors périmètre de cette
route), un fichier corrompu et une référence qui ne résout sous aucune racine rendent tous 404,
jamais une 500.

⚠️ **Le mur (l'élévation requise) se prouve dans `coffre_wall.spec.ts`, pas ici** — même
répartition que les deux autres proxies du module.

### `tests/functional/modules/coffre_curtain.spec.ts`

Le rideau : le plancher qui vérifie que le module est bien activé (sinon rien ne prouve rien),
l'absence de toute destination `/coffre`, la prop partagée `destinations` vue depuis une page du
coffre ouvert, et le rappel que les **capacités**, elles, sont bien au registre.

### `app/modules/coffre/components/__tests__/entry_form_modal.spec.ts`

Vitest — la modale de création/édition (CC-207), sur le patron de `useForm` factice
d'`app/core/settings/pages/__tests__/index.spec.ts` (`post`/`put` invoquent `onSuccess`
directement, jsdom ne fait aucune visite Inertia réelle) : le sélecteur de nature n'apparaît
qu'en création, le titre et le contenu se préremplissent en édition, **le mot de passe reste
vide en édition d'un identifiant** (il n'est même pas dans la prop `entry`, CC-179), la
soumission (création comme édition) émet `close`, le bouton Annuler aussi sans soumettre, et les
médias déjà attachés ne s'affichent qu'en édition.

Depuis CC-208 : `presetType` masque le sélecteur **et** fixe réellement le type créé — prouvé sur
un champ qui ne dépend QUE du type effectif (le mot de passe n'apparaît que sur `credential`),
pas seulement sur l'absence du sélecteur, sans quoi un bug qui masquerait le sélecteur sans
changer la valeur par défaut `'note'` passerait au vert.

Depuis CC-218 : la bascule du collage manuel — `immichFolderAvailable` à vrai replie le champ
derrière un dépliant fermé par défaut (absent du DOM tant qu'on n'a pas cliqué le dépliant) ;
à faux, le champ reste visible sans aucun geste préalable et le dépliant n'existe pas du tout.
Les deux cas sont recherchés par le `placeholder` de l'input pour ne pas se confondre avec un
autre champ du formulaire.

Depuis CC-221 : deux tests de plus, sur les deux dépliants (dossier verrouillé, collage manuel) —
`aria-expanded` suit l'état RÉEL sur le geste (déplier PUIS replier, pas seulement l'état de
montage), `aria-controls` ne référence l'id du panneau QUE lorsqu'il est monté, jamais un id
inexistant côté replié. Les deux mutation-vérifiés : figer `aria-expanded` en dur fait rougir
chacun des deux tests, et lui seul.

⚠️ **Le rendu du panneau du dossier verrouillé et le CSS de la modale ne sont couverts par
aucun test** — même limite que le reste du module, jsdom ne fait aucun layout. Voir
`inertia/components/__tests__/app_modal.spec.ts` (hors index, `tests_index.spec.ts` ne balaie
pas `inertia/**`) pour le chassis partagé (Échap, clic-extérieur) qu'`AppModal.vue` fournit.

### `app/modules/coffre/pages/__tests__/section.spec.ts`

Vitest — le premier test de composant de cette page (CC-221). Prouve uniquement l'accordéon
d'une entrée : `aria-expanded` suit l'état réel sur le geste (déplier PUIS replier),
`aria-controls` référence l'id du panneau (`coffre-entry-panel-<id>`) seulement quand il est
monté. Mutation-vérifié : figer `aria-expanded` en dur fait rougir ce test, et lui seul.

⚠️ **Ne couvre RIEN d'autre de cette page** — la révélation/copie de mot de passe, la
suppression, l'édition, l'aperçu média restent un passage navigateur pour le propriétaire, comme
avant ce lot (voir la limite déjà notée plus bas, « Aucun navigateur n'a affiché la grille de
cartes ni les pages de section »).

## Hors du module, mais amendés par CC-179

- `tests/functional/core/validation_flash.spec.ts` — **une validation ratée ne rejoue pas le corps
  soumis dans la session**. Il est rangé hors du module parce que le correctif est dans le noyau
  (`app/core/shared/exceptions/handler.ts`) et vaut pour tous les formulaires ; mais c'est bien la
  **passphrase du coffre** qu'il prend pour témoin, et pour une raison précise : `password` est
  exclu d'office par une liste en dur du paquet `@adonisjs/session`, donc un test écrit sur ce
  nom-là passerait au vert **sans** le correctif.
- `inertia/utils/__tests__/clipboard.spec.ts` — la copie vers le presse-papiers, partagée avec
  `/reglages` et l'écran LLM de Leitner. Hors index par construction : `tests_index.spec.ts` ne
  balaie ni `app/core/**` ni `inertia/**`.

## Hors du module, mais amendés par ce lot

- `tests/functional/core/navigation_registry.spec.ts` — `DESTINATION_PAR_MODULE` accepte `null`
  pour un module sans destination. ⚠️ Le `Record` reste **total** : un module ajouté demain doit
  toujours *déclarer* ce qu'on attend de lui, fût-ce « rien ».
- `tests/unit/modules_config.spec.ts` — le chemin de migrations du coffre dans la liste en dur.
- `tests/functional/modules/pages.spec.ts` — `/coffre/ouvrir`, **la porte et pas `/coffre`**, qui
  répondrait 403 à un compte qui vient seulement de se connecter.
- `inertia/layouts/__tests__/breadcrumb.spec.ts` — `coffre` rejoint les modules à i18n par page.

## Fabriques

`tests/helpers/coffre.ts` — `createVault` (écrit les colonnes directement, comme `enrollTotp`),
`unlockedSession` et `lockedSession`. ⚠️ `unlockedSession` forge **aussi** le tampon de connexion :
sans lui, `AuthMiddleware` en poserait un à *maintenant* et le marqueur serait rejeté par la
condition 3 — le test rougirait en accusant le mur alors que c'est le décor qui ment.

`createMedia` (CC-180) — attache une référence de média à une entrée sans passer par la route, même
doctrine que `createVault` : écrit `asset_id_cipher` directement avec la clé fournie.

`createNasFile` (CC-181) — même doctrine, écrit `path_cipher` directement ; `kind` se dérive du
chemin par défaut, comme le fait réellement `VaultService.#attachNasFiles`.

`createCatalogItem` (CC-228) — pose une ligne de `coffre_catalog_items` directement, sans passer
par `coffre:sync-catalog`. ⚠️ **Aucune clé nécessaire**, contrairement aux trois fabriques
précédentes : `reference` est stockée EN CLAIR (doctrine de la table, voir son CLAUDE.md), pas
chiffrée.

`tests/fixtures/coffre_nas_thumbnail.heic` (CC-228) — un HEIC **réel** (447 octets, encodé avec
`libheif`+`libheif-plugin-x265` depuis un PNG synthétique), pas un fichier renommé : c'est le seul
moyen de prouver le codepath HEVC que la mesure a écarté pour `sharp`, puisque le générer à la
volée demanderait un encodeur HEIC absent de ce dépôt.

`tests/fakes/fake_immich_session_client.ts` (CC-205) — sur le patron de `fake_immich_client.ts` :
remplace la couche API (`lockedPhotos`, `thumbnail`) tout entière, jamais le transport ni la
coordination des sessions, qui ont leur propre test.
