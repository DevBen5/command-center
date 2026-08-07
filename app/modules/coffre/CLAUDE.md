# Module Coffre — notes, URLs, identifiants, médias Immich et médias NAS chiffrés, invisibles, derrière deux portes

Routes `/coffre/ouvrir` · `/coffre` · `/coffre/:section` · `/coffre/:id/secret` ·
`/coffre/media/:id/thumbnail` · `/coffre/nas/:id/stream` · `/coffre/immich/dossier` ·
`/coffre/immich/dossier/:assetId/thumbnail` · pages Inertia
`modules/coffre/{ouvrir, index, section}` · tables
`coffre_vaults`, `coffre_entries`, `coffre_entry_media`, `coffre_entry_nas_file`. Lot 1 de l'épique
CC-177 (CC-178) : le **socle**, dont tous les lots suivants héritent — aucun ne redéfinit sa propre
porte. Lot 2 (CC-179) : les **identifiants**, qui ajoutent une nature d'entrée et une route.
⚠️ **CC-186 (l'édition) et CC-180 (les médias Immich) portent tous deux le numéro « lot 3 » dans
leur ticket** — CC-180 a été planifié avant CC-186 dans l'épique, mais CC-186 a été livré en
premier. Ce fichier ne tranche pas laquelle des deux est *la* troisième : il cite chaque décision
par son numéro de ticket, pas par un rang. Lot 4 (CC-181) : la **lecture NAS**, photos ET vidéos —
voir « Les médias du NAS » plus bas. Lot 5 (CC-182, non livré au moment d'écrire ceci) portera les
fichiers téléversés — un gisement de données distinct, que CC-181 ne recouvre pas. Lot 6 (CC-205) :
le **dossier verrouillé d'Immich**, parcourable en vignettes depuis le coffre — voir « Le dossier
verrouillé — session Immich » plus bas. La refonte d'écran vient ensuite, en deux tickets : CC-207
(la saisie derrière une modale unique) puis CC-208 (l'accueil en cartes de sections, et une page
par section) — voir « La saisie : une modale unique » et « L'écran en cartes de sections » plus
bas.

⚠️ **CC-181 a été amendé le 2026-08-06, en cours de lot** : le ticket ne portait au départ que les
vidéos ; le propriétaire a élargi le périmètre aux photos avant la fin de l'implémentation, parce
qu'il y a sur le NAS des photos autant que des vidéos hors d'Immich, et qu'une seconde garde de
chemin aurait été la même garde rouverte une seconde fois. Toute la nomenclature du lot (routes,
table, service) est donc générique — « NAS », pas « vidéo » — dès la première version livrée.

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
services/vault_service.ts                la partie base + session : créer, ouvrir, lire, écrire,
                                         médias
middleware/vault_unlocked_middleware.ts  le second étage du mur
controllers/coffre_door_controller.ts    la porte : créer, ouvrir, verrouiller — SANS élévation
controllers/coffre_controller.ts         le contenu : lister (accueil ET par section, CC-208),
                                         ajouter, supprimer, RÉVÉLER — AVEC élévation
controllers/coffre_media_controller.ts   le proxy de vignette Immich (CC-180) — AVEC élévation,
                                         repli en session depuis CC-205
controllers/coffre_nas_controller.ts     le proxy de streaming NAS, photos ET vidéos (CC-181) —
                                         AVEC élévation
controllers/coffre_immich_folder_controller.ts  le dossier verrouillé (CC-205) : listing + vignette
                                         — AVEC élévation
models/coffre_vault.ts                   un coffre PAR COMPTE : sel + témoin
models/coffre_entry.ts                   note | url | credential · titre, contenu ET secret chiffrés
models/coffre_entry_media.ts             une référence d'asset Immich, chiffrée (CC-180)
models/coffre_entry_nas_file.ts          une référence de chemin de média NAS, chiffrée, PLUS son
                                         `kind` en clair (CC-181)
services/nas_roots_service.ts            PUR-ish (fs) · résout un chemin contre les racines, APRÈS
                                         realpath (CC-181)
services/nas_file_format.ts              PUR · allow-lists photo/vidéo, content-type, kind (CC-181)
services/byte_range.ts                   PUR · parseur de l'en-tête `Range` (CC-181)
shared/entry_sections.ts                 PUR · le regroupement de l'écran par nature (CC-204),
                                         PLUS les cartes de l'accueil et les segments d'URL de
                                         section (CC-208)
services/immich_session_state.ts         la session Immich en MÉMOIRE, TTL, coordination anti-course
                                         (CC-205)
services/immich_session_client.ts        login, élévation PIN, listing du dossier verrouillé,
                                         vignette (CC-205)
validators/coffre.ts                     ⚠️ des FABRIQUES, jamais des nœuds VineJS partagés
```

⚠️ **Six fichiers hors du module** : `start/routes.ts` · `start/capabilities.ts` · `start/kernel.ts`
(le middleware nommé `coffreOuvert`) · `config/modules.ts` · `resources/lang/{fr,en}/coffre.json`
(les messages **serveur** — `app.languageFilesPath()` ne connaît qu'un dossier, même contrainte
structurelle que `commands/`) · et **`start/navigation.ts`, où l'absence est délibérée**.

⚠️ **Un septième depuis CC-180, et il n'est PAS propre au coffre** : `ImmichClient` vit dans
`app/core/shared/services/immich_client.ts`, partagé avec la veille. Le coffre n'importe QUE cette
classe (via `thumbnail()`) — jamais rien sous `app/modules/veille/`, ce qui aurait recréé
exactement le couplage que ce lot existe pour éviter (désactiver `veille` casserait alors le
coffre). Voir « Les médias Immich » plus bas et `app/modules/veille/CLAUDE.md`.

⚠️ **Un huitième depuis CC-181, et il EST propre au coffre cette fois** : `config/coffre_nas.ts`
vit dans `config/` par convention du dépôt (comme `config/immich.ts`, `config/agents.ts`), pas
sous `app/modules/coffre/` — c'est le seul endroit qu'AdonisJS balaie au démarrage pour ce genre
de fichier. Rien d'autre ne le lit.

⚠️ **Un neuvième depuis CC-205, même raison que le huitième** : `config/coffre_immich.ts`, dans
`config/` pour la même convention. Il relit `IMMICH_BASE_URL`/`IMMICH_TIMEOUT_MS` — les MÊMES
variables que `config/immich.ts` (CC-180), une seule instance Immich à déclarer — et ajoute
`COFFRE_IMMICH_EMAIL`/`COFFRE_IMMICH_PASSWORD`/`COFFRE_IMMICH_PIN`, propres au dossier verrouillé.

⚠️ **Un dixième depuis CC-205 : `providers/coffre_provider.ts`**, à la racine pour la même raison
structurelle que `providers/veille_provider.ts` (voir le `CLAUDE.md` racine, point 7) — un
provider est chargé par le framework au boot/shutdown, avant toute notion de module. Son seul rôle :
fermer la session Immich élevée à l'arrêt du serveur, voir « Le dossier verrouillé » plus bas.

⚠️ **Deux dépendances de plus depuis CC-179, et aucune n'est propre au coffre** : la page importe
`inertia/utils/clipboard.ts` (partagé avec `/reglages` et l'écran LLM de Leitner), et la promesse
« aucun secret dans une réponse de validation » est tenue par
`app/core/shared/exceptions/handler.ts`, dans le **noyau**. Ce dernier point est le seul du module
dont le remède vit ailleurs — parce que le défaut y vivait aussi.

⚠️ **Une troisième depuis CC-207 : `inertia/components/AppModal.vue`**, le chassis de modale
partagé (overlay, clic-extérieur, Échap) — créé **par ce lot**, pas hérité. Voir « La saisie : une
modale unique » plus bas pour la raison de son existence et l'arbitrage qui l'a tranchée.

## La saisie : une modale unique, sur un chassis partagé (CC-207)

Le formulaire de création/édition vivait **déplié en permanence** en haut de `pages/index.vue`,
dupliqué en deux copies quasi identiques (création, édition) — chaque lot depuis CC-180 avait dû
modifier les deux. Il vit désormais dans `components/EntryFormModal.vue`, derrière un bouton
« Ajouter une entrée », monté par `index.vue` en `v-if` (jamais `v-show`) : fermer la modale la
**démonte**, ce qui efface tout état local — y compris un mot de passe frappé non soumis — sans
rien à faire côté page, cohérent avec la doctrine CC-179 (« un mot de passe frappé mais non
soumis quitte l'écran en même temps que le reste »).

⚠️ **Une seule copie du panneau du dossier verrouillé (CC-205), et c'est l'essentiel du gain.**
Il était écrit deux fois dans l'ancien fichier (une par formulaire) ; il n'existe plus qu'une
fois dans `EntryFormModal.vue`, sa cible (`mediaTarget`) se déduisant simplement du mode —
`entry !== null` — puisque le composant ne porte plus qu'un seul mode par montage.

⚠️ **`v-model` ne peut pas cibler un opérateur ternaire.** `v-model="isEdit ? editForm.title :
form.title"` compile en `(isEdit ? editForm.title : form.title) = valeur`, un `SyntaxError` JS
(« left-hand side of an assignment »), pas une astuce Vue qui marcherait. C'est ce qui a forcé
trois `computed` avec `get`/`set` (`titleModel`, `contentModel`, `passwordModel`) plutôt qu'un
seul template alimenté directement par les deux `useForm` sous-jacents — piège à connaître avant
de fusionner un futur formulaire à deux sources.

### L'arbitrage du ticket : composant partagé, pas une modale locale au coffre

CC-206 (remplacer les `confirm()` natifs) et CC-208 (les pages de section) auront eux aussi
besoin d'une modale. Le ticket demandait de trancher, pas de laisser implicite. **Décision :
`inertia/components/AppModal.vue`**, un chassis minimal — overlay `fixed inset-0`,
clic-extérieur (`@click.self`), Échap (`window` keydown posé/retiré au montage, patron déjà
utilisé par la palette ⌘K d'`AppLayout.vue`) — que `EntryFormModal.vue` monte et dont il fournit
le contenu par `<slot>`.

- ⚠️ **Échap n'existait nulle part ailleurs dans le dépôt avant ce lot**, y compris sur la
  modale de `leitner/settings.vue` (seul le clic-extérieur y était géré). Le chassis le couvre
  pour toute modale future qui l'adopte ; `settings.vue` n'a pas été touché — ce lot ne touchait
  que `.vue` et i18n du coffre, migrer Leitner est un geste séparé, pas fait ici.
- ⚠️ **Le chassis ne porte AUCUNE structure interne** (pas de bandes en-tête/corps/pied) : c'est
  au contenu du `<slot>` de les poser, comme le fait `EntryFormModal.vue` en reprenant tel quel
  le patron CC-66 de `leitner/settings.vue` (`max-h-[calc(100vh_-_8rem)]`, `min-h-0`, `shrink-0`
  sur le corps défilant — voir le `CLAUDE.md` du module Leitner pour ce que chaque classe tient).
  Un confirm-modal (CC-206) n'a pas besoin de ces trois bandes ; leur imposer depuis le chassis
  les lui aurait forcées inutilement.

**Mise à jour 2026-08-07 (CC-209)** : le chassis est désormais durci — `role="dialog"` +
`aria-modal="true"` + `aria-labelledby` (l'id est exposé au slot via `v-slot="{ titleId }"`, à
poser sur ce que le contenu considère être son titre, jamais fabriqué par le chassis lui-même),
focus posé sur le premier élément focalisable à l'ouverture et piégé dedans (Tab/Maj+Tab), focus
rendu à l'ouvrant au démontage (donc sur les trois chemins de fermeture à la fois : bouton, Échap,
clic-extérieur), défilement de fond bloqué. Une pile de module (hors `<script setup>`, qui
s'exécute par instance) coordonne plusieurs modales ouvertes en même temps — un cas que CC-206
va créer (confirmation par-dessus un formulaire) : seule l'instance empilée en dernier répond à
Échap, le défilement n'est débloqué qu'au retour à zéro instance. **Les deux overlays maison
restants ont été ramenés dans ce chassis** — `leitner/pages/settings.vue` et la palette ⌘K
d'`AppLayout.vue`, y compris cette dernière (initialement vue comme optionnelle par le ticket) :
le rembourrage vertical (`py-16` pour les deux premiers, `pt-[120px]` pour la palette) est sorti
du chassis, qui n'en porte plus aucun, et reporté en `mt-16`/`mt-[120px]` sur le panneau de
chaque consommateur — visuellement identique (CC-66 réserve déjà le budget vertical via
`max-h-[calc(100vh_-_8rem)]`), vérifié par `npm run build` + grep du CSS produit. `EntryFormModal`
porte donc maintenant `:id="titleId"` sur sa barre de titre existante — geste invisible, pas une
refonte visuelle.

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

## L'édition : remplace, ne fusionne pas (CC-186)

Les trois natures (note, lien, identifiant) partagent le même écran et la même route,
`PUT /coffre/:id` — dans le groupe déjà muré, capacité `coffre.write` : **une édition rechiffre**,
elle n'a donc aucune raison d'échapper au mur qui couvre `store`/`destroy`.

⚠️ **Le formulaire d'édition ne reçoit JAMAIS le clair d'un mot de passe.** La tentation
immédiate — préremplir depuis ce que la base porte — défait exactement ce que CC-179 a construit :
le secret n'est pas filtré après coup, il n'est **pas chargé** par la requête de liste. Le titre et
le contenu, eux, se préremplissent depuis la prop `entries` : ils sont **déjà** en clair côté
navigateur à chaque affichage de la liste (c'est la promesse du lot 1), donc les préremplir n'ouvre
aucune surface nouvelle. Seul le mot de passe reste à part : le champ part **vide**, et un champ
laissé vide veut dire « garde l'actuel », jamais « efface-le ».

⚠️ **Le `type` ne fait pas partie du schéma d'édition, et ce n'est pas une omission.** Une entrée
ne change jamais de nature après coup (une note transformée en identifiant laisserait un
`secret_cipher` orphelin dont plus rien ne dirait ce qu'il est). Deux mécanismes indépendants
ferment cette porte : VineJS ne copie pas les propriétés non déclarées dans l'objet validé (sans
`.allowUnknownProperties()`), donc un `type` posté n'atteint jamais `updateEntry` — **et** même
s'il l'atteignait, `updateEntry` n'assigne jamais `entry.type`, quoi que porte le patch. Testé en
postant délibérément un `type` avec l'édition (`coffre_storage.spec.ts`).

⚠️ **`VaultService.updateEntry` charge la ligne complète (secret compris), et c'est sans risque
ici, contrairement à une liste.** La restriction `COLONNES_DE_LISTE` ne vaut que pour
`listQueryFor` : un point d'accès ciblé sur un seul `id` (comme `secretFor`, comme `deleteEntry`)
n'a jamais eu cette contrainte, parce que rien de ce qu'il charge n'est ensuite sérialisé vers le
client — le contrôleur ne fait ici que rediriger.

⚠️ **Éditer l'entrée d'un autre compte échoue en silence** — même doctrine que la suppression :
`owner_id` dans la clause de lecture, no-op si la ligne n'appartient pas à l'appelant, 302 dans
tous les cas. Une édition ne doit pas plus être un oracle d'existence qu'une suppression.

## Les médias Immich : référencer, jamais copier (CC-180)

**Immich possède les fichiers, le coffre possède le sens** — même partage des rôles qu'en veille
(`app/modules/veille/CLAUDE.md`, « Immich — les vidéos du téléphone »). Une entrée peut référencer
**plusieurs** assets Immich (table `coffre_entry_media`, `entry_id` + `owner_id` FK CASCADE) : une
entrée n'est pas elle-même « de type média », n'importe quelle nature (note, lien, identifiant)
peut porter des pièces jointes.

⚠️ **Table dédiée, jamais un préfixe de plus sur `dedup_key`.** `app/modules/veille/CLAUDE.md`
l'annonçait déjà : « un second module référençant les mêmes médias demanderait une colonne dédiée,
pas un troisième préfixe ». `dedup_key` reste un mécanisme interne à la veille — l'index
d'autorisation de SON proxy — et n'a jamais été réutilisé ici.

### Le client Immich est partagé, pas dupliqué

`ImmichClient` — transport bas niveau, `thumbnail()`, `serverVersion()` — vit dans
`app/core/shared/services/immich_client.ts` depuis ce lot. La veille en hérite (sous-classe
`app/modules/veille/services/immich_client.ts`, qui ajoute `albumAssets`/`trashDays`/`trashAssets`,
propres à son domaine album). Le coffre injecte la classe du core telle quelle : il n'a besoin que
de `thumbnail()`.

⚠️ **Limite connue, assumée, non corrigée par ce lot** : `ImmichConfig.enabled`
(`config/immich.ts`, partagé) exige `IMMICH_BASE_URL` **et** `IMMICH_API_KEY` **et**
`IMMICH_ALBUM_ID`, alors que le proxy de vignette n'utilise jamais l'album. Une installation
coffre-sans-veille doit donc renseigner un album qu'elle n'utilisera jamais pour que le module
fonctionne. Le corriger toucherait le déclenchement du collecteur de veille et sa suite de tests —
disproportionné pour ce ticket. Le message d'erreur reste honnête (il nomme la vraie cause), donc
ce n'est pas un échec silencieux.

### Le proxy de vignette — reprend la décision de sécurité de la veille, avec un mur en plus

`GET /coffre/media/:id/thumbnail` — **le paramètre est l'`id` de NOTRE ligne
`coffre_entry_media`, jamais l'UUID Immich**, pour la même raison que côté veille : une route qui
prendrait l'UUID serait un proxy de lecture ouvert sur toute la bibliothèque personnelle, servi par
un serveur qui porte la clé d'API.

- ⚠️ **Elle hérite EN PLUS du mur du lot 1** (`coffreOuvert()`) : une vignette servie sans
  élévation viderait le coffre de son sens, l'image étant le contenu. Elle est donc dans
  `ROUTES_MUREES` de `coffre_wall.spec.ts` **et** dans l'assertion qui lit le routeur — mesuré :
  la sortir du groupe muré ne fait rougir QUE cette assertion-là, `#key()` du contrôleur rendant
  le même 403 par ailleurs.
- ⚠️ **`cache-control: no-store` + `pragma: no-cache`, PAS `private, max-age=3600` comme la
  veille.** Divergence assumée : le contenu de veille n'est pas verrouillable, celui du coffre
  l'est. Une vignette mise en cache resterait lisible sur le disque du navigateur après un
  verrouillage — la même famille de fuite au repos que CC-179 a fermée sur le flash de validation.
- **L'UUID est chiffré au repos, comme le titre** — mais contrairement au titre, il ne redescend
  **jamais** vers le client : `CoffreEntryView.media` ne porte que `{ id }`, l'`id` de la ligne
  `coffre_entry_media`, jamais l'UUID. Le proxy est le SEUL endroit qui le déchiffre, avec la clé
  de session élevée, juste avant l'appel à Immich.
- Un échec (média introuvable, déchiffrement raté, panne Immich, repli HTML) rend uniformément
  404 côté client, jamais un oracle sur la cause ; `logger.warn` la nomme côté serveur — même
  doctrine que `VeilleMediaController`.
- ⚠️ **Le repli HTML d'Immich n'est pas re-testé côté coffre** : `ImmichClient.thumbnail()` —
  partagé — l'assure déjà, prouvé par `tests/unit/veille_immich_client.spec.ts`.

### L'édition : additive/soustractive, PAS un remplacement intégral

⚠️ **Seul le point du module qui n'applique pas « remplace, ne fusionne pas » (CC-186), et c'est
délibéré.** `title`/`content` se remplacent intégralement parce que le client les reçoit en clair
et peut donc réémettre l'état courant. L'UUID d'un média ne redescend **jamais** (voir plus haut) :
le client ne peut structurellement pas renvoyer un état complet. `entryUpdateValidator` porte donc
`media: { add?: string[]; remove?: number[] }` — même famille de raison que `password`, qui reste
vide = « ne change rien ».

- `media.remove` est scopé `entry_id` + `owner_id` : un `id` posté qui n'appartient pas à
  l'entrée éditée (la sienne ou celle d'un autre compte) ne supprime rien — no-op silencieux,
  vérifié en base et pas sur le code HTTP, même doctrine que la suppression d'entrée.
- `media.add` dédupe les UUID répétés dans un même lot avant insertion.
- `addEntry`/`updateEntry` sont transactionnels (`db.transaction`) : l'entrée et ses médias
  s'écrivent ensemble.

## Le dossier verrouillé — session Immich (CC-205)

CC-180 sait référencer un asset Immich en collant son UUID à la main, mais **une clé d'API ne voit
jamais un asset `visibility: locked`** : `401 Elevated permission is required`, comportement
**voulu** d'Immich — l'issue immich-app/immich#20622 est fermée « as not planned ». Coller l'UUID
d'un asset verrouillé échouait donc silencieusement en 404, comme n'importe quel autre échec. Ce
lot ajoute un second mode d'authentification — une SESSION, avec élévation par PIN — et un écran
qui parcourt le dossier verrouillé en vignettes au lieu d'obliger à connaître l'UUID par cœur.

⚠️ **Le contournement qui existe et qu'il ne fallait pas prendre** : `POST /api/search/random` en
omettant `visibility` renvoie les assets verrouillés à une session qui n'a jamais saisi le PIN
(divulgué en juillet 2026). C'est une **faille de sécurité d'Immich**, pas une API — elle sera
corrigée. Le module dont toute la raison d'être est la sûreté ne s'appuie pas dessus.

### Un secret de premier ordre dans le `.env` — exception ASSUMÉE, ne « corrige » pas

Le `CLAUDE.md` racine explique pourquoi le chiffrement du coffre ne dérive **pas** d'`APP_KEY` :
`APP_KEY` vit dans le `.env`, à côté de la base, et les deux tombent ensemble dans une sauvegarde,
une image disque, un vol de machine.

**Ce lot met dans ce MÊME `.env` les identifiants COMPLETS du compte Immich et le PIN du dossier
verrouillé** (`COFFRE_IMMICH_EMAIL`/`COFFRE_IMMICH_PASSWORD`/`COFFRE_IMMICH_PIN`). Il n'y a pas
d'autre chemin — voir « Pourquoi » ci-dessus, tranché par le ticket. Conséquence, écrite noir sur
blanc : **qui obtient le `.env` et joint le serveur Immich ouvre le dossier verrouillé**, sans
passphrase ni TOTP. Une sauvegarde de configuration devient un secret de premier ordre.

⚠️ **Décision prise en connaissance de cause par le propriétaire le 2026-08-06, le coût sous les
yeux — ne « corrige » pas cette exception en croyant réparer une incohérence.** Ce qui reste vrai,
et qui ne bouge pas : le chiffrement des ENTRÉES du coffre continue de ne dépendre QUE de la
passphrase (`vault_crypto.ts`, inchangé) — un `.env` volé n'ouvre aucune note, aucun identifiant,
aucune photo déjà attachée. Il ouvre uniquement le PARCOURS du dossier verrouillé — un accès en
lecture à ce qu'Immich, lui, protège.

### L'UUID en sélection n'est pas l'UUID en liste

⚠️ **`GET /coffre/immich/dossier` rend l'UUID de chaque photo au navigateur, et ce n'est PAS une
régression de la doctrine « aucun secret ne redescend » de CC-180.** Cette doctrine porte sur les
médias déjà ATTACHÉS à une entrée — `CoffreEntryView.media` ne porte que l'`id` de la ligne
`coffre_entry_media`, jamais l'UUID, parce que l'utilisateur n'a plus aucune raison de le
reconnaître une fois l'entrée créée. La phase de SÉLECTION est une frontière de confiance
différente : l'utilisateur a DÉJÀ cette information en parcourant Immich lui-même, exactement comme
il l'a déjà quand il colle un UUID à la main dans le formulaire (CC-180, chemin qui reste). Le
dossier n'est qu'une commodité qui affiche la même chose en vignette au lieu de forcer un copier-
coller. Cliquer une vignette pousse l'UUID dans le MÊME `form.media`/`editForm.media.add` que le
collage — zéro changement de schéma, de validateur, ou d'`VaultService`.

### Le client de session — cycle de vie

`services/immich_session_state.ts` (l'état, en mémoire) + `services/immich_session_client.ts` (la
logique HTTP) — split volontaire, sur le même principe que `vault_service.ts`/`vault_keyring.ts` :
le second est un singleton manuel exporté par défaut (`export default new ImmichSessionState()`),
le premier est résolu par le conteneur IoC (`@inject()`-compatible comme `ImmichClient` du core),
donc reconstruit à chaque requête — la statefulness qui permet la RÉUTILISATION vient du singleton
importé par défaut, jamais de l'instance du client.

⚠️ **Une seule session pour toute l'installation, jamais une par compte Command Center.** Les
identifiants Immich sont ceux du `.env` — un seul compte Immich, partagé. Fermer une session coffre
(verrouillage, révocation CC-176) ne touche jamais cette session-ci, et réciproquement : les deux
sont des concepts indépendants qui partagent le mot « session » par coïncidence.

⚠️ **Le jeton ET l'élévation par PIN expirent, indépendamment — et c'est indiscernable depuis ce
poste, faute d'instance réelle à observer.** La réponse retenue ne tente PAS de deviner les deux
durées réelles : un 401/403 sur un appel de DONNÉES (listing, vignette) déclenche une reprise
**unique** — nouveau login, nouvelle élévation — que la cause soit l'un, l'autre, ou les deux à la
fois. Un login ou une élévation refusés (mauvais identifiants, mauvais PIN dans le `.env`) ne sont
JAMAIS retentés : ce sont des erreurs de configuration, pas des expirations, et boucler dessus
martèlerait Immich sans jamais réussir.

⚠️ **« Réutilise, et ferme ce que tu ouvres » — les deux moitiés du ticket, à deux endroits
différents.** Chaque `POST /api/auth/login` crée une session visible dans la liste d'appareils
autorisés d'Immich :

1. **Réutilise** — `ImmichSessionState.authorize` ne relogue pas tant que la session n'a pas
   dépassé `SESSION_REUSE_MINUTES` (10, une fenêtre de réutilisation, PAS la durée de vie réelle
   côté Immich, inconnue). Des requêtes CONCURRENTES (la grille de vignettes rend plusieurs `<img>`
   à la fois) sont coordonnées par un verrou en mémoire (`#inFlight`) : une seule établit la
   session, les autres attendent son résultat. ⚠️ La coordination est sûre SANS mutex explicite —
   entre la lecture de l'état et sa pose, aucun `await` n'a lieu : la portion critique s'exécute
   d'un bloc, comme tout code JS synchrone jusqu'à son premier point de suspension.
2. **Ferme** — avant tout renouvellement (`#establish` logue l'ancien jeton s'il y en avait un),
   ET à l'arrêt du serveur (`CoffreProvider.shutdown`, sinon un redémarrage — le cas COURANT sur la
   durée de vie d'une installation, bien plus fréquent qu'un crash — laisserait une session
   orpheline à chaque fois, sans jamais la nettoyer : l'ancien process a disparu).

⚠️ **Le mode d'échec évité, mesuré en écrivant le test avant le correctif :** un premier jet
appelait `state.clear()` explicitement avant de relancer l'établissement — ce qui PERD la référence
au jeton périmé avant que le mécanisme de coordination ne puisse le récupérer pour le fermer côté
Immich. `ImmichSessionState.reauthorize` existe pour ça : il force un nouvel établissement SANS
jamais appeler `clear()` en amont, laissant la coordination interne être la SEULE à décider quel
jeton était là.

⚠️ **Ne réutilise pas `#core/shared/services/immich_client.ts` pour ce transport.** L'en-tête
d'authentification diffère (`Authorization: Bearer` ici, `x-api-key` là-bas) et les endpoints
(`/api/auth/login`, `/api/auth/session/unlock`, `/api/auth/logout`) n'ont pas d'équivalent dans le
client partagé. Le hardening (redirections refusées, assertion de content-type, plafonds de taille
et de temps) est dupliqué plutôt que tordu pour un second mode d'auth — un seul consommateur (le
coffre), donc il reste local au module (voir le point 5 du ticket, et « Modules strictement
séparés »).

### Le proxy de vignette existant — repli, pas remplacement

`CoffreMediaController.thumbnail` (CC-180) tente d'abord la clé d'API (chemin rapide — la majorité
des assets ne sont pas verrouillés), puis, si elle échoue, tente la session. ⚠️ **Aucune garde
`coffreImmichConfig.enabled` dans ce contrôleur, délibérément** : `ImmichSessionClient` porte déjà
son propre refus rapide (« pas configuré », avant tout `fetch`) — dupliquer le contrôle ici ferait
deux sources de vérité, et le rendrait dépendant d'un singleton non substituable en test
(`app.container.swap` remplace la classe injectée, pas la config qu'elle lit).

### Le contrôleur du dossier — deux routes, deux doctrines de réponse différentes

`GET /coffre/immich/dossier` (listing) rend **toujours 200** — `available: false` porte l'échec
(non configuré, panne Immich), jamais un code d'erreur : ce n'est pas « photo introuvable », c'est
« je n'ai pas pu parler à Immich », deux choses différentes que la doctrine 404-uniforme des
proxies par média (établie par CC-180/181) ne couvre pas. `GET
/coffre/immich/dossier/:assetId/thumbnail`, elle, suit cette doctrine à l'identique (404 uniforme,
`logger.warn` côté serveur) — c'est un proxy par média comme les deux autres.

⚠️ **Le listing plafonne à 10 pages de 100 (`MAX_PAGES` de `immich_session_client.ts`), et
`truncated: true` le dit plutôt que de lever.** Différent de `MAX_PAGES` côté veille, qui LÈVE : là-
bas c'est un garde-fou anti-boucle sur un album de collecte qui ne devrait jamais en approcher ;
ici, un dossier verrouillé personnel peut légitimement dépasser 1000 photos au fil des années — ce
n'est pas une anomalie, juste un dossier qu'on ne montre pas en entier.

⚠️ **`POST /api/search/metadata` avec `visibility: 'locked'` n'est PAS vérifié contre une vraie
instance — c'est une extrapolation de l'usage déjà vérifié en veille pour `albumIds` sur le MÊME
endpoint** (même pagination `items`/`nextPage` en chaîne). À confirmer avant de faire confiance au
listing en production.

### Les deux registres du mur, comme les deux autres proxies

Les deux routes du dossier entrent dans `ROUTES_MUREES` de `coffre_wall.spec.ts` **et** dans
l'assertion qui lit le routeur — mesuré à l'identique à CC-180/181 : les sortir du groupe muré ne
fait rougir QUE cette assertion-là, `#requireElevation` du contrôleur rendant le même 403 par
ailleurs.

## Les médias du NAS : lire depuis le disque, sans l'ouvrir — photos ET vidéos (CC-181)

**Le lot dangereux de l'épique**, pris seul une fois les autres livrés — voir CC-177. Servir un
fichier depuis un chemin, c'est ouvrir une lecture arbitraire du disque dès que la garde a un
trou. Trois règles, aucune optionnelle :

1. **Les racines autorisées se déclarent dans `.env`** (`COFFRE_NAS_ROOTS`), jamais en base,
   jamais un formulaire — même raison qu'`IMMICH_BASE_URL` : un chemin persisté depuis une requête
   HTTP serait une lecture arbitraire **permanente**.
2. **L'appartenance à une racine se vérifie APRÈS `realpath`** — voir
   `NasRootsService.resolve` (`services/nas_roots_service.ts`). Un lien symbolique posé DANS
   une racine autorisée et pointant DEHORS sort de la racine sans que le chemin demandé en ait
   l'air ; comparer les chaînes avant résolution ne le voit pas. `resolve()` ferme les trois
   chemins hostiles (traversée, lien symbolique, chemin absolu) par un seul mécanisme : le
   confinement se vérifie sur le `realpath()` du candidat, jamais sur la chaîne brute. Prouvé par
   `tests/unit/coffre_nas_roots.spec.ts` contre un VRAI filesystem — dont un vrai lien
   symbolique, pas mocké. **La garde ne connaît pas la nature du fichier** : le même mécanisme sert
   une photo comme une vidéo.
3. **Streaming avec `Range`, content-type déterminé PAR NOUS** (`services/nas_file_format.ts`,
   allow-list vidéo `mp4`/`webm`/`mov`/`mkv`/`avi` et photo `jpg`/`jpeg`/`png`/`webp`/`gif`/`heic`)
   — jamais déduit de ce que le client annonce. `services/byte_range.ts` parse l'en-tête, une
   seule plage à la fois (le multi-range est refusé, aucun lecteur vidéo n'en a besoin) ; sans
   objet pour une photo, mais le même contrôleur sert les deux sans dupliquer la garde de chemin.

⚠️ **Amendement du 2026-08-06, en cours de lot** : le ticket ne portait au départ que les vidéos.
Le propriétaire a élargi le périmètre aux photos avant la fin de l'implémentation — il y en a sur
le NAS autant que de vidéos, hors d'Immich, et une seconde garde de chemin aurait rouvert
exactement la même sécurité une seconde fois. **Conséquence pour qui lit une trace ancienne du
lot** : tout ce qui portait `video` dans son nom (`VideoRootsService`, `COFFRE_VIDEO_ROOTS`,
`coffre_entry_video`, `/coffre/video/:id/stream`) a été renommé en générique NAS avant tout commit
— rien de ces noms n'a jamais existé dans une version livrée.

### Le patron Docker — chemin hôte en variable de compose, chemin conteneur FIXE

Repris tel quel de `BACKUP_MIRROR_DIR`/`AGENTS_CONFIG_PATH` (voir le `CLAUDE.md` racine, « Les
données »). `COFFRE_NAS_ROOTS` — lue par l'app, dans `config/coffre_nas.ts` — vaut un chemin
réel du poste en dev (le serveur de dev tourne hors conteneur) et le chemin FIXE
`/data/coffre-media` en conteneur ; seul le côté HÔTE du montage se règle, dans
`docker-compose.install.yml`, via `COFFRE_NAS_ROOTS_PATH_HOST` — jamais lue par l'app.

⚠️ **Le montage est en LECTURE SEULE (`:ro`)** — l'app ne fait que lire ces fichiers, jamais y
écrire. ⚠️ **Sans valeur par défaut**, même raison que `BACKUP_MIRROR_DIR` : un `${VAR:-...}` avec
repli monterait — donc créerait — un dossier local dès que la variable est absente, la fausse
sécurité que « le dossier doit exister, jamais le créer » interdit ailleurs.

⚠️ **Isolée en test comme Immich/YouTube/LLM, pour une raison différente.**
`coffreNasConfigFrom` réutilise `externalServicesIsolated` (`config/env_isolation.ts`) : ce
n'est pas un appel réseau, mais la fusion par *truthiness* d'`@adonisjs/env` (CC-88) menace
n'importe quelle variable non vide en `.env.test`, pas seulement celles d'un client externe. Sans
cette garde, un `.env` de poste de dev qui fixerait `COFFRE_NAS_ROOTS` sur un vrai dossier
contaminerait les tests en process. Conséquence : **`NasRootsService` par défaut ne résout
jamais rien en test** — les tests qui doivent prouver le résolveur (ou le proxy) construisent
leurs propres racines de fixtures et substituent le service via `app.container.swap`, exactement
comme `FakeImmichClient`.

### Le cache — même tension que la vignette, tranchée dans le même sens

`cache-control: no-store` + `pragma: no-cache`, comme `CoffreMediaController`. ⚠️ **Ce n'est pas
un oubli d'optimisation** : le contenu du coffre est verrouillable, un média mis en cache par le
navigateur resterait lisible sur son disque après un verrouillage — le même risque que sur une
vignette, en plus lourd pour une vidéo. Le coût assumé : chaque segment demandé par le lecteur
(chaque `seek`) repasse par ce serveur, jamais par un cache local. Cohérence du modèle de sécurité
du module plutôt que performance — à confirmer au navigateur, ce poste n'ayant aucun outil de
pilotage.

### La liste n'affiche AUCUN aperçu à plusieurs médias à la fois — décision assumée, pas un oubli

⚠️ **Aucune vignette n'existe pour ces fichiers, contrairement aux assets Immich.** Le proxy Immich
resize déjà côté Immich ; ici, rien ne redimensionne un fichier NAS avant de le servir. Charger
`<img>`/`<video>` pour PLUSIEURS pièces jointes à la fois (la liste d'édition, un jour une grille)
téléchargerait le fichier **complet** de chacune — un piège de bande passante nommé explicitement
par l'amendement du ticket sur des photos d'appareil moderne (10-20 Mo pièce).

La réponse retenue, **sans nouvelle dépendance** (pas de `sharp` ni d'équivalent — ça toucherait le
`Dockerfile` et le build multi-arch de CC-142, non vérifiable depuis ce poste sans un vrai run
GHCR) :

- **La liste d'édition (chips) ne charge RIEN** : chaque pièce jointe déjà attachée s'affiche comme
  un simple `#<id>`, texte seul, aucune requête réseau.
- **Seule l'entrée OUVERTE affiche un aperçu réel**, un média à la fois — `<video controls>` ou
  `<img>` selon `kind`, jamais plusieurs chargements simultanés hors de ce contexte. C'est la même
  discipline que la vignette Immich (rendue uniquement dans `template v-else-if="opened === …"`),
  étendue à un cas où, sans elle, le coût serait bien plus élevé.
- ⚠️ **Limite connue, assumée** : ouvrir une entrée qui porte une photo de 20 Mo la télécharge en
  entier — il n'y a pas de vraie vignette. Une génération de vignette côté serveur (ex. `sharp`,
  bornée en taille comme `MAX_THUMBNAIL_BYTES` côté Immich) est un candidat naturel de suivi si la
  liste devient lente à l'usage, pas fait ici faute de pouvoir vérifier l'impact sur le build
  multi-arch depuis ce poste.

### Le proxy de streaming — reprend le mur, ajoute `Range`, sert les deux natures

`GET /coffre/nas/:id/stream` — **`:id` désigne notre ligne `coffre_entry_nas_file`, jamais un
chemin ni un id venu du client**, même décision de sécurité que le proxy de vignette. **Un seul
contrôleur pour les deux natures** : `Range` est utile à la vidéo, sans objet pour une photo, mais
dupliquer la route aurait dupliqué la garde de chemin pour un gain nul.

- ⚠️ **Dans `ROUTES_MUREES` de `coffre_wall.spec.ts` ET dans l'assertion qui lit le routeur** —
  mesuré à l'identique à CC-180 : sortir la route du groupe muré ne fait rougir QUE cette
  assertion-là, `#key()` (via `vault.keyFor`) rendant le même 403 par ailleurs.
- Sans en-tête `Range` : 200, corps entier. Avec un `Range` valide : 206,
  `content-range`/`content-length` du segment exact. `Range` invalide ou hors bornes : 416,
  `content-range: bytes */<taille>`.
- Un échec à n'importe quelle étape (référence introuvable, résolution hors racine, extension hors
  allow-list, fichier disparu) rend uniformément 404 côté client, jamais un oracle sur la cause ;
  `logger.warn` la nomme côté serveur — même doctrine que le proxy de vignette.
- ⚠️ **`NasRootsService.resolve` ne lève jamais** : un chemin hostile, une racine non montée ou
  un fichier disparu sont des cas normaux de ce module, traités tous uniformément côté contrôleur.
- ⚠️ **`stat` est gardé par `isFile()`, et ce n'est pas de la ceinture-bretelles.** `realpath`
  réussit sur un **dossier** : un dossier nommé `album.jpg` sous une racine autorisée traverse
  l'allow-list d'extension sans encombre, et `createReadStream` échouerait alors **après** l'envoi
  des en-têtes — une 500 au milieu d'un module dont toute la lisibilité tient à ce que ses échecs
  se ressemblent. Le même `catch` couvre le fichier disparu entre la résolution et la lecture.
  `coffre_nas.spec.ts` porte le cas du dossier ; la garde a été **mutée** pour vérifier qu'elle
  rougit, et elle fait tomber ce test-là exactement.

⚠️ **`.heic` est servi correctement et ne s'affichera pourtant PAS**, sauf sur Safari. Chrome,
Firefox et Edge ne décodent HEIC dans aucun `<img>` — c'est un blocage de licence HEVC, pas un
retard d'implémentation, et **l'échec est silencieux** : ni erreur, ni repli, une image cassée.
L'extension reste dans l'allow-list parce que le fichier, lui, est bien servi (un téléchargement
fonctionne) — mais c'est le format **par défaut des iPhone**, donc le premier qu'on trouve sur un
NAS familial. ⚠️ **Ne cherche pas le bug dans le proxy** : la conversion (côté NAS, ou un jour
côté serveur) est la seule réponse, et elle n'est pas dans ce lot.

### Le modèle de données — table dédiée, comme les médias Immich, PLUS un `kind` en clair

`coffre_entry_nas_file` (`entry_id`, `owner_id` dénormalisé, `path_cipher`, `kind`, `created_at`)
— même schéma que `coffre_entry_media`, avec une colonne de plus. ⚠️ **Une table dédiée, pas un
discriminant sur `coffre_entry_media`** : les deux sources (Immich, disque local) ont des règles de
sécurité entièrement différentes (UUID vs. chemin de fichier avec `realpath`) — les mélanger
brouillerait un mécanisme dont la sûreté tient à être isolé et simple.

⚠️ **`kind` (« video » | « photo ») est en CLAIR, et ce n'est pas une incohérence avec
`path_cipher`.** Le client a besoin de savoir quel élément rendre (`<video>` ou `<img>`) SANS
jamais recevoir le chemin réel (qui reste chiffré, jamais redescendu — voir plus bas). `kind` ne
révèle que la nature du fichier, déjà connue de l'allow-list publique (`nas_file_format.ts`) —
donc rien à protéger. Il est calculé à l'écriture (`nasFileKindFor`, dérivé de l'extension) et
sélectionné par la liste (`#nasFileIdsByEntry`) exactement comme `id`, sans jamais toucher
`path_cipher` — même doctrine que `COLONNES_DE_LISTE` (CC-179) : le chargement du chiffré reste
réservé au proxy de streaming, une ligne à la fois. `kind` n'est pas un enum natif (pas de
`useNative: true`), même doctrine que `coffre_entries.type`.

⚠️ **Contrairement à `#attachMedia`, `#attachNasFiles` NE normalise PAS la casse avant de
dédupliquer.** Un UUID Immich est insensible à la casse par construction ; un chemin de fichier sur
un NAS (ext4/btrfs) ne l'est pas — le mettre en minuscules changerait un chemin réel en un chemin
qui n'existe plus.

### L'édition : additive/soustractive, comme les médias — même raison

`nasFiles: { add?: string[]; remove?: number[] }` sur `entryUpdateValidator` : le chemin ne
redescend jamais vers le client (`CoffreEntryView.nasFiles` ne porte que `{ id, kind }`), qui ne
peut donc pas réémettre l'état complet pour un remplacement intégral.

## L'écran par nature (CC-204)

⚠️ **Amendé par CC-208 (2026-08-07) : `pages/index.vue` ne range plus les entrées en sections —
il en montre un résumé en cartes.** La liste plate groupée par section décrite ci-dessous a
déménagé telle quelle dans `pages/section.vue`, une page par nature. `groupEntriesByNature`, la
fonction pure qui fait la répartition, n'a pas changé et reste au cœur des deux écrans (l'accueil
via `sectionCardsFor`, la page de section via `CoffreController#section`) — voir « L'écran en
cartes de sections » plus bas pour la forme actuelle.

La liste n'est plus plate : `pages/index.vue` range les entrées en sections — notes · liens ·
identifiants · photos — chacune avec son titre et son compte, une section sans entrée n'étant
jamais rendue. Ce lot **range l'écran tel qu'il existait**, il n'ajoute aucune nature : `type`
reste `note | url | credential`, inchangé.

⚠️ **« Photos » n'est PAS une nature au sens de `CoffreEntry.type`, et ce n'est pas une
contradiction avec « une entrée n'est pas elle-même de type média »** (voir plus haut, CC-180).
C'est une **priorité d'affichage** : une entrée qui porte au moins un média (Immich ou NAS, l'un
ou l'autre ou les deux) est rangée en Photos **plutôt que** dans la section de son `type` déclaré,
exclusivement — jamais dans les deux. Le badge de nature affiché par entrée (`natureLabel`)
continue de dire le vrai `type` ; seul l'endroit où l'entrée est rangée à l'écran change.

- **Le regroupement vit dans `shared/entry_sections.ts`, PUR**, hors du `<script setup>` — même
  geste que `inertia/layouts/breadcrumb.ts` et `leitner/shared/review_page.ts` : ce qui reste dans
  un composant est hors de portée de Japa comme de Vitest. `groupEntriesByNature` ne connaît que
  `type`/`media`/`nasFiles`, jamais `title`/`content` — il n'a pas besoin de savoir si une entrée
  est illisible pour la ranger.
- ⚠️ **N'importe jamais par un alias `#modules/*` depuis ce fichier ni depuis `pages/index.vue`
  pour l'atteindre** — l'alias mappe vers `./app/modules/*.js`, qui n'existe qu'après un build ;
  Vite ne le résout pas depuis un `.vue`. L'import est **relatif** (`'../shared/entry_sections.js'`).
- **Aucune requête de plus, aucune colonne de plus.** Le regroupement se fait sur ce que
  `entriesFor` rend déjà ; il n'a jamais justifié de toucher `VaultService.listQueryFor` ni
  `COLONNES_DE_LISTE`.
- ⚠️ **Le tri interne d'une section reste `created_at desc`, et la fonction ne trie JAMAIS
  elle-même** — elle suppose `entries` déjà ordonné par le serveur et se contente de partitionner
  en préservant l'ordre d'arrivée. Le titre est chiffré (voir plus haut) : il n'existe et
  n'existera aucun tri alphabétique, côté serveur comme côté client.
- **Une entrée illisible reste dans sa section normale**, avec son badge `unreadable` existant,
  inchangé : `type` n'est jamais chiffré, seuls `title`/`content` peuvent l'être — la décision de
  section ne dépend donc jamais d'un déchiffrement.

⚠️ **Aucun navigateur n'a affiché l'écran sectionné (CC-204)** — même limite que CC-180/CC-181, ce
poste n'a aucun outil de pilotage. Le regroupement est prouvé par test
(`tests/unit/coffre_entry_sections.spec.ts`) sur la fonction pure, jamais sur le rendu — alignement
visuel, lisibilité des en-têtes, ordre à l'écran restent un passage navigateur pour le propriétaire.

## L'écran en cartes de sections (CC-208)

Second lot de la refonte, le plus visible. L'accueil ressemble désormais au tableau de bord
(`app/core/dashboard/pages/home.vue`) : une grille de deux colonnes, une carte par section — Notes,
Liens, Identifiants, Photos — avec un en-tête cliquable (icône, nom, compteur), et en dessous un
aperçu des trois dernières entrées, elles-mêmes cliquables. Cliquer mène à `/coffre/<section>`, qui
porte tout ce que l'accueil faisait avant ce lot : la liste complète, l'accordéon, la
révélation/copie de mot de passe, l'édition, la suppression.

- **`pages/index.vue`** ne fait plus que résumer : il reçoit `entries` en entier (inchangé côté
  serveur, `CoffreController#index` n'a pas bougé) et calcule cartes et aperçus **côté client**,
  sur ce qui est déjà déchiffré. Aucune requête de plus pour les compteurs — répond au point
  d'attention du ticket sur le déchiffrement, en réutilisant `entriesFor` tel quel.
- **`pages/section.vue`** reçoit `{ section, entries, immichFolderAvailable }` — `entries` est
  **déjà filtré côté serveur** à la nature demandée, via `groupEntriesByNature` (jamais une
  requête SQL `where('type', …)`, voir plus bas pourquoi).

### Une carte par section, TOUJOURS les quatre — un renversement assumé de CC-204

⚠️ **`groupEntriesByNature` omet toujours une section vide de son résultat, et ça ne change PAS**
(voir plus haut) : sur une LISTE, un en-tête suivi du vide est du bruit. Sur une GRILLE de quatre
cartes, une carte manquante casse la mise en page et donne à croire que la fonctionnalité n'existe
pas. `shared/entry_sections.ts` ajoute donc `sectionCardsFor`, une fonction pure **séparée** qui
complète les sections absentes par une carte vide, dans l'ordre fixe de `SECTION_ORDER` (exporté
depuis ce lot).

⚠️ **Ne fusionne jamais `sectionCardsFor` dans `groupEntriesByNature`.** Le contrat de cette
dernière ne change pas — c'est la décision explicite du ticket, écrite ici pour qu'un futur lecteur
ne « répare » pas l'un des deux en croyant l'autre incohérent : une section absente reste une
section absente pour tout appelant qui n'a pas besoin de la compléter.

### Une page par section : URL françaises, un seul fichier

`/coffre/notes` · `/coffre/liens` · `/coffre/identifiants` · `/coffre/photos` sont une **seule**
route dynamique, `GET /coffre/:section`, et un **seul** composant Inertia (`modules/coffre/section`
⇄ `pages/section.vue`) — pas quatre fichiers quasi identiques, exactement le problème que CC-207
venait de fermer pour la modale.

- **`shared/entry_sections.ts` porte `SECTION_SLUGS`** (`CoffreSectionKey → mot français`) et son
  inverse `sectionKeyFromSlug`, **l'unique source du mapping** : `start/routes.ts` construit son
  `.where('section', …)` à partir de `Object.values(SECTION_SLUGS)` plutôt que de recopier les
  quatre mots en dur, et l'accueil s'en sert pour construire les liens des cartes
  (`sectionHref`). Un slug hors de cette liste ne match même pas la route : 404 avant le
  contrôleur, pas un cas à gérer dedans.
- ⚠️ **`CoffreController#section` filtre via `groupEntriesByNature`, jamais une requête SQL sur
  `type`** (point d'attention n°4 du ticket) : la section d'une entrée dépend de la présence de
  médias, pas seulement de sa colonne `type` — une requête `where('type', 'note')` inclurait à tort
  une entrée « note » porteuse d'un média, qui doit sortir en Photos. Réutiliser la même fonction
  pure que l'accueil est ce qui empêche les deux vues de diverger sur ce qu'elles considèrent comme
  une photo. `tests/functional/modules/coffre_section_pages.spec.ts` le prouve explicitement avec
  une entrée `type: 'note'` porteuse d'un média, qui doit sortir dans `/coffre/photos` et nulle
  part ailleurs.
- **Photos n'est pas un `type`** (voir CC-204 plus haut) : le formulaire de création de cette page
  impose donc `'note'` en coulisse — arbitraire, jamais affiché — puisque seule la présence d'un
  média décide du classement, jamais la valeur choisie ici.

### La modale : le type se choisit une fois, jamais deux

`EntryFormModal.vue` gagne une prop optionnelle **`presetType`** (CC-208) : fournie, elle masque le
sélecteur de nature et préinitialise `form.type`. L'accueil ne la fournit pas — c'est le seul
endroit où le type se choisit encore librement (CC-207, inchangé) ; chaque page de section la
fournit, fixée à sa propre nature (`'note'` pour Photos, voir plus haut).

⚠️ **`presetType` n'a d'effet qu'en création.** En édition le type vient toujours de `entry.type`,
non modifiable (CC-186) — la prop est acceptée sans effet si `startEdit` la transmet aussi, ce
qu'elle fait par simplicité d'appel plutôt que par nécessité.

### `redirect().back()` remplace le `/coffre` en dur — `store`/`update`/`destroy`

⚠️ **Changement de comportement non explicitement demandé par le ticket, mais nécessaire à la
cohérence du découpage en pages** : avant ce lot, les trois actions d'écriture redirigeaient
toujours vers `/coffre`, qui était alors la seule page existante. Ajouter, éditer ou supprimer
depuis `/coffre/notes` renverrait sinon systématiquement à l'accueil au lieu d'y laisser
l'utilisateur. Les trois passent donc à `response.redirect().back()` — le pattern déjà dominant du
reste du dépôt (leitner, veille, services l'utilisent tous pour ce type d'action).

- Depuis l'accueil (`referer = /coffre`), le comportement est **inchangé** : c'était le seul cas
  avant ce lot.
- Aucun test existant n'asserte la `location` de ces trois actions (vérifié avant le changement) :
  aucune régression de test à prévoir de ce côté.
- Sans en-tête `Referer` (le cas des clients de test Japa qui n'en posent pas), Adonis retombe sur
  `/` — sans conséquence ici, aucun test de ce module n'inspecte cette valeur.

⚠️ **Aucun navigateur n'a affiché la grille de cartes ni les pages de section (CC-208)** — même
limite que CC-180/CC-181/CC-204/CC-205/CC-207, ce poste n'a aucun outil de pilotage. Sont prouvés
par test : la complétion des quatre cartes (`sectionCardsFor`, fonction pure), le filtrage par
section contre une vraie base, le mur des nouvelles routes, `presetType` sur la modale. Restent un
passage navigateur pour le propriétaire : l'allure des cartes, la lisibilité des aperçus, la grille
sur petit écran, et ce que devient réellement le fil d'Ariane à l'écran — le coffre n'ayant aucune
destination (CC-178), `AppLayout.vue` ne résout jamais de segment pour ses pages (`activeDestination`
reste `null` sur toute URL `/coffre/*`, tracé dans le code), donc les clés `coffre.section.crumb`/
`.title` ajoutées pour satisfaire le plancher de `breadcrumb.spec.ts` (CC-110) ne devraient rien
changer à l'écran — à confirmer, pas déduit.

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

⚠️ **`COFFRE_NAS_ROOTS` n'a PAS sa place dans `.env.test` (CC-181), et c'est la seule exception à
la règle ci-dessus.** L'isolation de `config/coffre_nas.ts` la vide déjà en environnement
`test`, quel que soit le `.env` réel du poste — l'y ajouter ne ferait rien, comme pour
`IMMICH_BASE_URL`. Les tests qui ont besoin de racines réelles construisent leur propre
`NasRootsService` et le substituent, jamais via l'environnement.

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
- ~~Le lot 2 ne porte ni médias, ni fichiers~~ — les médias sont comblés par CC-180, les médias NAS
  (photos et vidéos) référencés par CC-181, voir les sections respectives plus haut. **Le
  TÉLÉVERSEMENT reste hors périmètre** : aucun lot livré ne prévoit d'upload, seulement des
  références vers Immich ou vers un chemin déjà présent sur le NAS — CC-182 (lot 5, non livré) le
  portera.
- ~~Une entrée ne s'ÉDITE pas~~ — comblé par CC-186, voir « L'édition » plus bas.
- **Aucun navigateur n'a affiché une vraie vignette Immich dans le coffre** (CC-180) : ce poste n'a
  aucun outil de pilotage de navigateur. Le proxy est prouvé par test (contenu, en-têtes, mur), pas
  par un œil humain — passage navigateur restant à faire par le propriétaire.
- **Aucune recherche ni parcours de la bibliothèque Immich** : l'utilisateur colle l'UUID d'un
  asset copié depuis Immich. Écarté en connaissance de cause, pas par oubli — voir le ticket CC-180.
- ⚠️ **Aucun navigateur n'a lu un vrai média NAS depuis le coffre (CC-181)**, même limite que
  CC-180 et pour la même raison. Le streaming (contenu, `Range`, en-têtes, mur, résolveur contre un
  vrai filesystem) est prouvé par test ; ce qu'aucun test ne peut prouver — démarrage de la
  lecture vidéo, fluidité du `seek` sous `cache-control: no-store`, rendu réel d'une photo,
  compatibilité de format avec un lecteur/navigateur réel — reste un passage navigateur pour le
  propriétaire.
- **Aucune vraie vignette pour les médias NAS**, contrairement aux assets Immich (voir « La liste
  n'affiche aucun aperçu à plusieurs médias à la fois » plus haut) : décision assumée pour ce lot,
  pas un oubli. Une génération de vignette côté serveur reste un candidat naturel de suivi.
- ⚠️ **Aucun navigateur n'a affiché l'écran rangé par nature (CC-204)**, même limite que CC-180 et
  CC-181. Le regroupement est prouvé par test sur la fonction pure ; l'alignement visuel, la
  lisibilité des en-têtes de section et leur ordre à l'écran restent un passage navigateur pour le
  propriétaire.
- ⚠️ **Aucun accès à une vraie instance Immich pour vérifier le dossier verrouillé (CC-205), et
  c'est plus grave que les limites précédentes** : la forme exacte de `POST /api/auth/login`,
  `POST /api/auth/session/unlock` et `POST /api/search/metadata {visibility: 'locked'}` n'a pas
  été confirmée — seule la pagination (`items`/`nextPage` en chaîne) est une extrapolation d'un
  usage déjà vérifié en veille sur le MÊME endpoint (filtre `albumIds` plutôt que `visibility`).
  Un passage réel (API **et** navigateur) est requis avant d'activer
  `COFFRE_IMMICH_EMAIL/PASSWORD/PIN` en confiance sur une installation qui compte dessus.
- **Le rendu de la grille de vignettes du dossier n'est couvert par aucun test de composant** —
  même limite que le reste du module : jsdom ne fait aucun layout. Le contrôleur et le client de
  session sont prouvés par test ; l'alignement, la lisibilité du bouton « Parcourir », et le fait
  qu'une vignette cliquée s'ajoute visiblement à la sélection restent un passage navigateur.
- ⚠️ **Aucun navigateur n'a ouvert la modale de saisie (CC-207)**, même limite que le reste du
  module. La logique (ouverture, préremplissage sans le mot de passe, fermeture) est prouvée par
  test mutation-vérifié ; le débordement sur petit écran, la superposition qui couvre bien l'écran,
  le comportement d'Échap et du clic-extérieur en conditions réelles, et l'utilisabilité de la
  grille de vignettes du dossier verrouillé **dans** la modale restent un passage navigateur pour
  le propriétaire.
- ⚠️ **Aucun navigateur n'a affiché la grille de cartes de l'accueil ni une page de section
  (CC-208)**, même limite que le reste du module. Sont prouvés par test : la complétion des quatre
  cartes (fonction pure), le filtrage d'une section contre une vraie base, le mur des nouvelles
  routes, `presetType` sur la modale. L'allure de la grille sur deux colonnes, la lisibilité des
  aperçus, le comportement sur petit écran, et ce que le fil d'Ariane affiche réellement (le code
  suggère qu'il n'affiche rien de plus pour ce module sans destination — voir « L'écran en cartes
  de sections » plus haut) restent un passage navigateur pour le propriétaire.
