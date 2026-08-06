# Module Coffre — notes, URLs et identifiants chiffrés, invisibles, derrière deux portes

Routes `/coffre/ouvrir` · `/coffre` · `/coffre/:id/secret` · pages Inertia
`modules/coffre/{ouvrir, index}` · tables `coffre_vaults`, `coffre_entries`. Lot 1 de l'épique
CC-177 (CC-178) : le **socle**, dont tous les lots suivants héritent — aucun ne redéfinit sa propre
porte. Lot 2 (CC-179) : les **identifiants**, qui ajoutent une nature d'entrée et une route, et rien
d'autre.

⚠️ **Le module est HORS de `MODULES` par défaut.** Il figure dans `KNOWN_MODULES`
(`config/modules.ts`) — sans quoi `parseModules` ferait échouer le démarrage de qui l'active — mais
`.env.example` ne le cite pas : une installation tierce qui suit le README n'en hérite pas.
`.env.test`, lui, l'active, et c'est obligatoire (voir « Les registres » plus bas).

```
capabilities.ts                          coffre.view · coffre.write
destinations.ts                          N'EXISTE PAS, et c'est le rideau (voir plus bas)
services/vault_crypto.ts                 PUR · scrypt + AES-256-GCM · node:crypto SEUL
services/vault_session.ts                PUR · le marqueur d'élévation, ses TROIS conditions
services/vault_keyring.ts                la clé en MÉMOIRE du process, TTL, purge paresseuse
services/vault_service.ts                la partie base + session : créer, ouvrir, lire, écrire
middleware/vault_unlocked_middleware.ts  le second étage du mur
controllers/coffre_door_controller.ts    la porte : créer, ouvrir, verrouiller — SANS élévation
controllers/coffre_controller.ts         le contenu : lister, ajouter, supprimer, RÉVÉLER — AVEC
                                         élévation
models/coffre_vault.ts                   un coffre PAR COMPTE : sel + témoin
models/coffre_entry.ts                   note | url | credential · titre, contenu ET secret chiffrés
validators/coffre.ts                     ⚠️ des FABRIQUES, jamais des nœuds VineJS partagés
```

⚠️ **Six fichiers hors du module** : `start/routes.ts` · `start/capabilities.ts` · `start/kernel.ts`
(le middleware nommé `coffreOuvert`) · `config/modules.ts` · `resources/lang/{fr,en}/coffre.json`
(les messages **serveur** — `app.languageFilesPath()` ne connaît qu'un dossier, même contrainte
structurelle que `commands/`) · et **`start/navigation.ts`, où l'absence est délibérée**.

⚠️ **Deux dépendances de plus depuis CC-179, et aucune n'est propre au coffre** : la page importe
`inertia/utils/clipboard.ts` (partagé avec `/reglages` et l'écran LLM de Leitner), et la promesse
« aucun secret dans une réponse de validation » est tenue par
`app/core/shared/exceptions/handler.ts`, dans le **noyau**. Ce dernier point est le seul du module
dont le remède vit ailleurs — parce que le défaut y vivait aussi.

## Le rideau — ce qu'il achète, et ce qu'il n'achète pas

Le module **n'enregistre aucune destination**. Il disparaît alors mécaniquement de la barre
latérale, du fil d'Ariane et de la palette ⌘K, qui dérivent tous les trois du registre de
navigation. Il n'y a **aucun code d'invisibilité** à écrire, et il ne faut pas en écrire : on entre
en tapant `/coffre/ouvrir`.

- ⚠️ **N'ajoute pas sa ligne dans `start/navigation.ts` « pour réparer un oubli ».** Le fichier
  porte l'avertissement sur place, et `coffre_curtain.spec.ts` rougit si une destination `/coffre`
  apparaît.
- ⚠️ **Le rideau protège d'un regard, jamais d'une recherche.** Le bundle JS livré au navigateur
  contient les clés i18n et les noms de pages : qui ouvre les outils de développement **verra
  qu'un coffre existe**. Et le dépôt est public depuis CC-142 — le nom du module, ses routes et
  ses écrans sont lisibles sur GitHub par n'importe qui. Ce qui protège est le **mur**, pas le
  rideau.
- ⚠️ **Conséquence assumée** : un compte qui n'aurait de droits que sur le coffre atterrit sur
  « aucun accès » après connexion, et doit taper l'URL. C'est le prix exact de l'invisibilité,
  choisi les yeux ouverts — pas le symptôme d'un module oublié.
- ⚠️ **Les capacités, elles, SONT au registre.** Le rideau ne concerne que la *navigation*. Sans
  `start/capabilities.ts`, les routes citeraient des capacités inconnues : fermées à tout
  non-admin, sans que `is_admin` s'en aperçoive.

## Le mur — deux étages, et la porte est hors du mur

1. `middleware.can('coffre.view' | 'coffre.write')` — *qui a le droit d'entrer* ;
2. `middleware.coffreOuvert()` — *que la personne vient de le prouver*.

Les deux, jamais l'un sans l'autre : un cookie volé porte toutes les capacités de son propriétaire
pendant sept jours (CC-78), et ne dit rien de qui le tient.

⚠️ **`/coffre/ouvrir`, `/coffre/creation` et `/coffre/verrouiller` sont hors du second étage**, et
ça ne peut pas être autrement : exiger d'avoir ouvert le coffre pour atteindre l'écran qui l'ouvre
serait le cercle que `/reglages` évite avec `openRoute()` (CC-114).

⚠️ **`GET /coffre` répond 403 quand l'élévation expire, il ne redirige pas.** Aspérité d'usage
assumée : on revient à la porte en tapant son URL, le rideau n'offrant aucun lien. Une redirection
serait plus douce et rendrait le mur invisible depuis `curl`.

⚠️ **Le refus se LÈVE** (`ForbiddenException`), il ne se retourne pas : `response.forbidden()`
court-circuiterait `statusPages` et rendrait du JSON brut au navigateur, sans que rien ne le
signale.

⚠️ **Deux mécanismes indépendants rendent ce 403, et c'est mesuré** : le middleware, et le
`#key()` de `CoffreController`. Retirer *l'un des deux* laisse la suite verte — c'est de la
défense en profondeur, pas une redondance à nettoyer. C'est pour ça que `coffre_wall.spec.ts`
**lit le routeur** et asserte que `coffreOuvert` est bien branché : sans ce test-là, le middleware
pouvait disparaître sans un rouge. ⚠️ Le garde du contrôleur, lui, n'est couvert par aucun test —
limite nommée, pas oubliée.

### L'ouverture : TOTP **puis** passphrase

- **TOTP d'abord** : un code refusé évite de payer un `scrypt`, le travail qu'on rationne.
- ⚠️ **Les deux échecs rendent le MÊME message.** Les distinguer dirait à qui tient l'un des deux
  secrets qu'il ne lui manque que l'autre.
- ⚠️ **Un code accepté est CONSOMMÉ, même si la passphrase échoue ensuite** : `verifyTotp` avance
  `totp_last_step` dès qu'il valide (l'anti-rejeu de CC-114). Reprendre après une passphrase mal
  tapée demande donc d'attendre le code suivant. Sens sûr ; le relâcher rouvrirait une fenêtre de
  rejeu de 90 s sur six chiffres.
- ⚠️ **Un code de secours n'ouvre PAS le coffre**, contrairement à `/login/2fa`. Là-bas il rattrape
  un téléphone perdu, faute de quoi la base entière devient inaccessible ; ici il n'y a rien à
  rattraper — le contenu reste intact et le coffre se rouvre dès le second facteur réenrôlé.
- ⚠️ **Un compte sans TOTP ne peut pas ouvrir son coffre.** `ADMIN_2FA_REQUIRED` étant opt-in et
  faux par défaut, c'est un vrai prérequis : enrôler depuis `/reglages` **avant** d'activer le
  module. L'écran le dit avant le formulaire, et le serveur le tient aussi.
- ⚠️ **Le throttle est celui de CC-147** (`ReauthThrottleService`, `reauth_<userId>`), jamais un
  second compteur : il compte les échecs d'une preuve fraîche, ce que cette porte demande
  exactement. Un deuxième diviserait le budget d'essais sans rien fermer. Il n'est effacé que sur
  une ouverture **complète**.

## Le chiffrement — pourquoi PAS `APP_KEY`

`two_factor_service.ts:57,188` chiffre le secret TOTP avec `encryption.encrypt/decrypt`, qui dérive
d'`APP_KEY`. **Ne recopie pas ce patron ici.** `APP_KEY` vit dans le `.env`, à côté de la base : les
deux partent ensemble dans une sauvegarde, une image disque, un vol de machine. C'est exactement le
raisonnement des codes de secours de CC-114, **hachés** pour ne pas tomber avec ce qu'ils rattrapent.

- **Clé** = `scrypt(passphrase, kdf_salt, 32)`, `N=2^15 · r=8 · p=1`. ⚠️ `maxmem` doit être relevé
  au-delà du défaut de 32 Mo de Node, sinon la dérivation échoue.
- **Contenu** = AES-256-GCM, `iv.tag.ciphertext` en base64, **IV neuf à chaque écriture**.
- **Vérification de la passphrase** = un **témoin chiffré**, pas un second hachage. Ce qu'il faut
  établir n'est pas « cette chaîne correspond » mais « cette clé **déchiffre** ce coffre » — le tag
  GCM répond exactement à ça, pour une dérivation au lieu de deux, et sans poser une seconde prise
  sur la passphrase dans le dump.

⚠️ **Changer les paramètres de scrypt rend TOUS les coffres illisibles, sans erreur au démarrage** :
la clé ne sera simplement plus la même et chaque ouverture répondra « passphrase invalide ». Même
famille que le paramétrage TOTP figé de `totp.ts`.

⚠️ **Le TITRE est chiffré, pas seulement le contenu.** Un titre en clair (« Compte bancaire ») dit
l'essentiel de ce que le coffre protège, et partirait tel quel dans chaque `npm run db:backup` —
donc vers `BACKUP_MIRROR_DIR`, où les dumps voyagent **en clair** par décision assumée du dépôt.
Conséquence directe et non contournable : **aucune recherche, aucun tri SQL sur le contenu**. Pas de
`search_vector`, pas d'index GIN, pas d'`orderBy('title')` — l'ordre est `created_at`. C'est le prix
du chiffrement au repos, pas un manque à combler.

⚠️ **Un déchiffrement raté est un REFUS, jamais « pas de contenu ».** Même distinction que le
`unreadable` de `TwoFactorService` : confondre « illisible » et « absent » désarmerait la protection
au moment précis où quelque chose d'anormal est arrivé à la base. Une entrée illisible est
**signalée à l'écran**, jamais sautée — un coffre qui perd une ligne en silence est pire qu'un
coffre qui dit avoir mal.

⚠️ **Nonce GCM** : 96 bits aléatoires, borne d'anniversaire vers 2³² messages sous une même clé.
Sans objet à cette volumétrie — mais l'IV ne doit jamais devenir un compteur « pour simplifier ».

## Où vit la clé pendant une session élevée

**En mémoire du process**, dans `vault_keyring.ts`, indexée par un `keyId` tiré au sort. Le marqueur
de session ne porte qu'un **pointeur** vers elle.

⚠️ **Pas en session, et le store est la raison** : `SESSION_DRIVER` vaut `cookie`, donc tout ce
qu'on y écrit est chiffré par `APP_KEY` et voyage chez le client à chaque requête. Y ranger la clé
la rendrait fonction d'`APP_KEY` — précisément ce que tout ce qui précède existe pour éviter.

Trois contreparties, toutes assumées :

1. **un redémarrage referme tous les coffres** — le `keyId` du cookie ne désigne plus rien. C'est
   même une propriété ;
2. **mono-instance** — à plusieurs processus, le coffre paraîtrait se refermer au hasard. Même
   hypothèse que la garde anti-chevauchement de `veille_scheduler`, et c'est une hypothèse ;
3. **une clé survit à la révocation de la session qui l'a ouverte**, jusqu'à son échéance — mais
   **inatteignable** : le cookie porteur du `keyId` est mort, et `AuthMiddleware` expulse avant
   qu'aucune route du coffre ne soit atteinte. Purger depuis `session_revocation.ts` ferait
   dépendre le **noyau** d'un module détachable (point 7 du `CLAUDE.md` racine).

⚠️ **L'échéance est tenue par `#purge`, et par elle seule.** Un second contrôle dans `keyFor` a
existé le temps d'une mutation : il est *structurellement inatteignable*, la purge tournant juste
avant avec le même `now`. Une ligne qu'aucun test ne peut faire rougir se lit comme une garde sans
en être une — ne la remets pas.

⚠️ **Pas de minuteur** : la purge est paresseuse. Un `setInterval` retiendrait le processus (il
faudrait `unref()`) pour nettoyer une `Map` de quelques entrées.

## Les trois conditions du marqueur d'élévation

`vault_session.ts`, **pur**, sur le patron de `two_factor_challenge.ts` (CC-114). Chacune ferme un
trou distinct :

1. **l'âge** — `VAULT_UNLOCK_MINUTES` (15). ⚠️ La **même** constante borne le trousseau : deux TTL
   divergents laisseraient une des deux moitiés ouverte ;
2. **le compte** — un marqueur ne vaut que pour celui qui l'a posé ;
3. ⚠️ **la connexion** — `auth.logout()` **ne détruit pas la session**, il oublie la clé du guard.
   Sans la comparaison au tampon `LOGIN_STAMP_KEY` de CC-78, ouvrir le coffre, se déconnecter puis
   se reconnecter dans le quart d'heure le **rouvrirait sans passphrase**. La borne existe déjà ;
   on la lit, on n'en fabrique pas une seconde.

⚠️ **Un tampon de connexion absent ferme**, alors qu'`isStampExpired` le tolère. L'asymétrie est
voulue : un marqueur d'élévation ne se pose qu'après une connexion, donc après que `AuthMiddleware`
a posé le tampon. Un tampon manquant devant un marqueur présent n'est pas un état légitime.

## Les identifiants : montrer sans exposer (CC-179)

Un identifiant est **une entrée de plus**, pas une table de plus. Il réutilise les colonnes du lot 1
— `title_cipher` porte le **service**, `content_cipher` le **nom d'utilisateur** — et n'ajoute que
`secret_cipher`, nullable, pour le mot de passe. ⚠️ **Cette correspondance n'est écrite nulle part
en base** : elle vit dans le modèle, le validateur et l'écran, et c'est pour ça qu'elle est nommée
ici. Trois colonnes neuves auraient dupliqué un chiffrement déjà en place et donné trois occasions
d'en oublier une.

⚠️ **La liste ne CHARGE pas la colonne du secret — elle ne la filtre pas après coup.**
`VaultService.listQueryFor` énumère ses colonnes (`COLONNES_DE_LISTE`) et n'y met pas
`secret_cipher` : le chiffré n'est donc jamais lu, et le clair n'existe à **aucun instant** en
mémoire du serveur pendant un rendu de liste. Il n'y a rien à *oublier* de retirer. Charger puis
filtrer marcherait aujourd'hui et fuirait au premier `...entry` de complaisance.

- ⚠️ **La méthode est publique pour être INSPECTABLE, pas pour être appelée ailleurs.** Deux
  mécanismes indépendants gardent le mot de passe hors de la charge utile : ce `select`, et la vue
  d'`entriesFor`, construite champ par champ, qui n'a pas de place pour un secret. **Retirer le
  `select` laisse la charge utile propre et la suite verte** — mesuré. C'est le même piège que le
  middleware du mur, et le même remède : `coffre_credentials.spec.ts` lit le **SQL**, comme
  `coffre_wall.spec.ts` lit le **routeur**.
- ⚠️ **Et « le SQL ne contient pas `secret_cipher` » ne suffit pas** : sans le `select`, la requête
  devient `select * …`, qui charge la colonne **sans la nommer**. C'est l'absence de `select *` qui
  porte la règle — « les colonnes sont énumérées, et celle-là n'y est pas ».
- ⚠️ **Énumérer plutôt que « tout sauf une »** : une colonne ajoutée demain entre dans un `*`, elle
  n'entre pas dans une liste. L'oubli va vers l'absence, jamais vers la fuite.

### La révélation : `GET /coffre/:id/secret`, du JSON nu

- ⚠️ **Surtout pas une prop Inertia.** Le client range les props de page dans `history.state` : un
  secret passé par une prop, fût-elle rechargée partiellement, serait **écrit sur le disque du
  navigateur** par l'historique et y resterait après la fermeture du coffre. La page fait donc un
  `fetch`, avec `accept: application/json` — sans cet en-tête, un refus reviendrait en page HTML
  403 au lieu d'un corps exploitable (voir la négociation de `renderForbidden`).
- ⚠️ **En GET, donc sans corps — délibérément.** Un POST devrait porter un jeton CSRF, dont
  l'unique copie côté client vit dans le module Leitner (un module n'importe pas chez un voisin), et
  son corps repartirait dans la session à la moindre erreur de validation. Il n'y a rien à protéger
  d'une écriture : la route ne modifie rien, et une lecture inter-origine de sa réponse est
  impossible faute de CORS. `cache-control: no-store` — **pas `no-cache`**, qui autorise le
  stockage et n'impose qu'une revalidation.
- **`coffre.view`, pas `coffre.write`** : c'est une lecture.
- ⚠️ **Une note rend 404, jamais « secret vide »**, et un chiffré illisible rend **422**. Même
  doctrine que la liste : un déchiffrement raté est un refus, pas une absence. Un secret vide rendu
  200 s'afficherait comme un mot de passe blanc et se copierait comme tel.
- ⚠️ **Rien n'est journalisé** — ni le clair, ni un extrait, ni une longueur.

### L'écran : copier d'abord, afficher en secours

Le geste nominal est **Copier** : le mot de passe ne touche jamais le DOM. **Afficher** existe à
côté, re-masqué seul au bout de 20 s, et devient le **seul** chemin quand `navigator.clipboard` est
absent — le bouton Copier est alors désactivé **avec la raison à l'écran**.

⚠️ **`navigator.clipboard` n'existe QUE dans un contexte sécurisé** (HTTPS, ou `localhost` que la
spécification traite comme tel). Sur une installation jointe en HTTP depuis une autre machine du
réseau, l'objet est `undefined` et l'appel lève. Avant CC-179, les deux appelants du dépôt
écrivaient `await navigator.clipboard.writeText(…)` puis `copié = true` **sans garde** : la promesse
rejetait, la ligne suivante ne s'exécutait pas, et l'écran restait muet. Pour des codes de secours
c'est fâcheux ; pour un mot de passe, c'est croire l'avoir copié et coller autre chose. Le geste vit
donc dans `inertia/utils/clipboard.ts` — **l'unique copie**, sous `inertia/` parce que `~/` est le
seul alias que Vite résout depuis un `.vue` de `core/` comme de `modules/`.

⚠️ **Le presse-papiers s'efface 30 s après une copie, à l'aveugle.** Ne remplacer que si le contenu
est toujours le nôtre exigerait `clipboard.readText()`, donc une **demande de permission** du
navigateur au milieu d'une action de coffre, et un refus rendrait l'effacement impossible. Ce qui a
été copié entre-temps est donc perdu : **l'écran annonce le délai**, ce n'est pas négociable.

⚠️ **L'effacement est une atténuation, pas une garantie.** Sur un onglet qui n'a plus le focus au
moment dit, `writeText` lève « Document is not focused » et le secret reste dans le presse-papiers ;
un rechargement complet ou la fermeture de l'onglet tuent le minuteur avant qu'il ne parte. Ne
l'écris jamais autrement.

⚠️ **Le minuteur d'effacement n'est PAS annulé au démontage**, contrairement à celui du
re-masquage. L'annuler signifierait qu'il suffit de quitter la page dans les trente secondes pour
que le mot de passe y reste indéfiniment. Il vit dans le contexte JS de l'application et survit donc
à une navigation Inertia.

⚠️ **Le secret révélé, lui, part au premier de ces quatre gestes** : re-masquage, repli de la ligne,
verrouillage du coffre, démontage de la page. Le laisser vivre derrière un panneau replié serait la
même erreur que de l'avoir mis dans la liste.

### Aucun secret dans une réponse de validation — et le remède est dans le noyau

⚠️ **`@adonisjs/session` rejouait le corps soumis dans la session à chaque validation ratée**, et
ça touchait ce module de plein fouet. Sa macro sur `renderValidationErrorAsHTML` appelle
`flashValidationErrors`, lequel fait `flashExcept(['_csrf', '_method', 'password',
'password_confirmation'])` : tout le reste du corps repart en session, donc — le store étant
`cookie` — **chiffré par `APP_KEY` chez le client**. Un code TOTP mal formé sur `POST /coffre/ouvrir`
suffisait à y expédier la **passphrase**, c'est-à-dire la seule chose que tout ce fichier existe pour
tenir hors d'`APP_KEY`.

`app/core/shared/exceptions/handler.ts` laisse désormais `super` écrire le bagage d'erreurs puis
écrase l'input par `flashOnly([])`. Deux choses à savoir :

- ⚠️ **Le champ du mot de passe s'appelle `password` en plus de ça, et c'est voulu** : la liste en
  dur du paquet l'exclut d'office, ce qui fait une seconde barrière indépendante de la nôtre.
- ⚠️ **`validation_flash.spec.ts` teste sur `passphrase`, pas sur `password`** — sur un nom que la
  liste du vendeur ne connaît pas. Un test écrit sur `password` passerait au vert sans le
  correctif, et ne prouverait donc rien.

## Un coffre par compte

`coffre_vaults.user_id` est **unique**, les entrées portent `owner_id`, rien n'est partagé. Un
coffre commun rendrait le contenu du propriétaire lisible par quiconque reçoit `coffre.view` et
connaît la passphrase — c'est la leçon de CC-139 sur Leitner, appliquée avant d'avoir à la
réapprendre.

⚠️ **L'unicité est une contrainte en base, jamais un `if`.** Deux `POST /coffre/creation`
concurrents généreraient deux sels : la clé changerait sous les pieds des entrées déjà écrites, qui
deviendraient indéchiffrables **sans qu'aucune erreur ne le signale**. Le contrôle applicatif du
contrôleur ne sert qu'à rendre un message propre ; c'est l'index unique qui tranche. Doctrine de
`veille_items.dedup_key` — **pas** celle de la dédup applicative de Leitner, qui ne tient pas ici.

⚠️ **FK en `CASCADE`, contrairement au contenu de Leitner qui survit en `SET NULL`.** Une entrée
orpheline serait un chiffré que plus personne au monde ne peut déchiffrer : la garder ne
conserverait pas des données, seulement des octets.

## Passphrase perdue = contenu perdu

Elle n'est stockée **nulle part** — ni en clair, ni hachée. Il n'existe donc, et il n'existera, ni
commande de récupération, ni équivalent d'`auth:reset-account` : ce serait une porte dérobée sur le
coffre. L'écran de création le dit en toutes lettres avant le premier enregistrement.

⚠️ **`npm run db:backup` sauvegarde bien le coffre** — les colonnes chiffrées partent dans le dump
comme les autres. Restaurer un dump rend donc le coffre, à condition d'avoir toujours la passphrase.
Le sel voyage avec (`coffre_vaults`) ; `APP_KEY` n'entre nulle part dans ce calcul.

## Les registres, et ce qui casse sans lever d'erreur

Les cinq points du `CLAUDE.md` racine s'appliquent tels quels. Deux propres à ce module :

- ⚠️ **`.env.test` DOIT citer `coffre`.** `tests/unit/modules_config.spec.ts` l'exige pour tous les
  `KNOWN_MODULES`, et ce n'est pas une formalité : un module détachable non activé en test est un
  module dont plus une ligne n'est vérifiée. Ce n'est **pas** en contradiction avec son absence de
  `.env.example` — l'un décrit ce qu'une installation tierce reçoit, l'autre ce que la suite exerce.
- ⚠️ **`validators/coffre.ts` expose des FABRIQUES, pas des constantes.** Un schéma VineJS se
  construit en **mutant** l'objet sur lequel on chaîne : avec un nœud partagé, le `.confirmed()` du
  validateur de création s'appliquait aussi à celui d'ouverture, qui exigeait alors un
  `passphrase_confirmation` que le formulaire n'envoie pas. Mesuré pendant le lot — et le refus
  était **indiscernable d'une passphrase fausse** : même redirection, même message.

## Tests

Le détail par fichier est dans [TESTS.md](./TESTS.md) — à lire avant de **modifier un test**.
⚠️ Un fichier de test du module absent de cet index fait rougir `tests/unit/tests_index.spec.ts`
(CC-112). Ce qui doit rester vrai :

- **La preuve du chiffrement se lit dans la COLONNE BRUTE** (`coffre_storage.spec.ts`,
  `db.rawQuery`). « On relit ce qu'on a écrit » réussirait à l'identique sans le moindre
  chiffrement : c'est le point de validation qu'un test rend faussement vert.
- **Le compte des tests du mur porte réellement ses capacités et une session valide.** Un 403 sur
  un compte sans droit ne prouverait rien — `can_middleware` l'aurait fermé de toute façon.
- **Chaque requête du client Japa est indépendante** (aucun cookie partagé) : l'état « coffre
  ouvert » est forgé par `withSession()`, comme `two_factor.spec.ts` forge son demi-tour de
  connexion. ⚠️ Le tampon de connexion doit être forgé **avec** — sinon `AuthMiddleware` en pose un
  à *maintenant* et la condition 3 rejette le marqueur : on chercherait un bug dans le mur alors
  que c'est le décor qui ment.
- ⚠️ **Le trousseau n'est PAS rollbacké** par la transaction globale : il vit en mémoire. C'est ce
  qui rend `unlockedSession()` possible, et ce qui interdit de partager le singleton entre tests
  unitaires — d'où l'export nommé `VaultKeyring`.

## Limites connues — ne les fais pas passer pour couvertes

- **Aucun test ne couvre le garde `#key()` de `CoffreController`** : le middleware le masque. Sa
  disparition serait sans conséquence tant que le middleware est là, et `coffre_wall.spec.ts`
  surveille le middleware.
- **Le rendu des deux `.vue` n'est couvert par rien** : jsdom ne fait aucun layout. Le dépliage
  d'une entrée, le dialogue de suppression, l'avertissement de création se vérifient au navigateur.
- ⚠️ **Le presse-papiers réel n'est prouvé par rien, et c'est l'essentiel de la valeur du lot 2.**
  `clipboard.spec.ts` couvre la *logique* (disponibilité, échec rendu, minuteur annulable) contre
  un faux `navigator` ; jsdom n'a aucun presse-papiers. Qu'un `Ctrl+V` rende bien la valeur, que
  l'effacement à 30 s la retire vraiment, que le bouton se désactive sur une installation en HTTP
  — **tout ça se vérifie au navigateur et nulle part ailleurs**.
- **Rien ne prouve que le secret ne reste pas quelque part côté navigateur** (extension, gestionnaire
  de mots de passe, capture d'écran, journal de plantage). Le module tient ce qu'il envoie et quand ;
  ce que la machine du lecteur en fait ensuite lui échappe. C'est aussi ce que le ticket avait déjà
  acté en écartant, en connaissance de cause, un gestionnaire dédié.
- **Rien ne prouve qu'une vraie application d'authentification produise le code attendu** — même
  limite que CC-114, et elle mord davantage ici : sans TOTP, le coffre est inatteignable.
- **Le lot 2 ne porte ni médias, ni fichiers** : notes, URLs et identifiants seulement. Les lots
  suivants héritent de ce socle et ne redéfinissent pas leur propre porte.
- ⚠️ **Une entrée ne s'ÉDITE pas** — ni au lot 1, ni au lot 2. Un mot de passe qui change se
  resaisit, l'ancienne entrée se supprime. Ce n'est pas un oubli, mais ce n'est pas non plus une
  décision défendue : c'est le comportement du lot 1 qu'on n'a pas élargi, et c'est le premier
  manque qu'un usage réel fera remonter.
