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

### `tests/functional/modules/coffre_wall.spec.ts`

Le mur. Quatre routes murées en 403 **avec un compte réellement capable et une session réellement
valide**, le pendant qui passe une fois l'élévation posée (sans lui, un mur qui refuserait tout
passerait au vert), l'expiration, le marqueur d'un autre compte, le cloisonnement de `coffre.write`,
et la session révoquée qui est expulsée **en amont** (302 vers `/login`, pas 403).

⚠️ Le premier test **lit le routeur** pour asserter que `coffreOuvert` est branché. Il a été ajouté
après mesure : sans lui, retirer le middleware de `start/routes.ts` laissait les dix autres verts,
le `#key()` du contrôleur rendant le même 403. La route d'édition (CC-186), le proxy de vignette
(CC-180) et le proxy de streaming NAS (CC-181) y entrent pour la même raison, mesurée à
l'identique : la retirer du mur ne fait rougir QUE cette assertion-là.

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

### `tests/unit/coffre_nas_roots.spec.ts`

Le résolveur de racines de médias NAS (CC-181), **pur-ish** : fs réel, aucune requête HTTP ni
base. Un dossier temporaire par test, dont un vrai lien symbolique posé DANS la racine autorisée
et pointant DEHORS — le cas qu'une comparaison de chaînes avant `realpath` ne voit pas. Couvre les
trois chemins hostiles du ticket (traversée, lien symbolique, absolu), un chemin légitime,
plusieurs racines dont une non montée (ignorée sans lever), et l'absence de toute racine
configurée. Ne teste rien de spécifique à une nature de fichier : le résolveur ne connaît que des
chemins.

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

### `tests/functional/modules/coffre_curtain.spec.ts`

Le rideau : le plancher qui vérifie que le module est bien activé (sinon rien ne prouve rien),
l'absence de toute destination `/coffre`, la prop partagée `destinations` vue depuis une page du
coffre ouvert, et le rappel que les **capacités**, elles, sont bien au registre.

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
