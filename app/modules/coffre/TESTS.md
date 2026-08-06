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

Le mur. Trois routes murées en 403 **avec un compte réellement capable et une session réellement
valide**, le pendant qui passe une fois l'élévation posée (sans lui, un mur qui refuserait tout
passerait au vert), l'expiration, le marqueur d'un autre compte, le cloisonnement de `coffre.write`,
et la session révoquée qui est expulsée **en amont** (302 vers `/login`, pas 403).

⚠️ Le premier test **lit le routeur** pour asserter que `coffreOuvert` est branché. Il a été ajouté
après mesure : sans lui, retirer le middleware de `start/routes.ts` laissait les dix autres verts,
le `#key()` du contrôleur rendant le même 403.

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
