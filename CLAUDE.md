# Command Center

Tableau de bord auto-hébergé. AdonisJS 6 (ESM, TS strict) + Inertia 2 + Vue 3 + Tailwind v4 + PostgreSQL (Lucid).

Commandes : `npm run dev` · `npm test` · `npm run typecheck` · `npm run lint`

## Distribution — dépôt public, licence MIT, image publiée (CC-142)

Le dépôt est **public** et sous **MIT** (`LICENSE`, `Copyright (c) 2026 DevBen5`). Un tiers installe
depuis `README.md` + `docker-compose.install.yml`, sans cloner : le compose **tire**
`ghcr.io/devben5/command-center`, publié en `linux/amd64` **et** `linux/arm64` par
`.github/workflows/release.yml` à chaque tag `vX.Y.Z`.

⚠️ **`"private": true` reste dans `package.json`, et ce n'est pas une contradiction avec MIT.** Ce
champ ne parle que du registre **npm** : il dit « ce paquet ne se publie pas », ce qui est vrai — une
application, pas une bibliothèque, et aucun champ `files`. Le droit d'usage est porté par `LICENSE`
et par `"license": "MIT"`, et c'est `LICENSE` que GitHub lit, jamais `package.json`. Le retirer
n'ajouterait aucun droit et ouvrirait un `npm publish` accidentel qui pousserait tout le dépôt.

⚠️ **Le piège de la publication, et aucun fichier du dépôt ne peut le fermer : un paquet poussé sur
GHCR par Actions est PRIVÉ par défaut, même depuis un dépôt public.** Le workflow est vert, l'image
est là, `docker manifest inspect` répond depuis une machine authentifiée — et le `docker pull` d'un
inconnu répond `unauthorized`. Le README promet alors des commandes qui échouent, sans que rien ne le
signale. C'est un **geste manuel, une fois** (réglages du paquet → visibilité → Public), à refaire si
le paquet est supprimé puis republié. `packages: write` sait pousser, pas rendre public.

⚠️ **Un tag ne se pose que sur la pointe de `master`, et `release.yml` le vérifie.** Sur un vieux
commit, `latest` **reculerait** : les installations qui le suivent recevraient une application plus
vieille que leur schéma, dont les migrations sont déjà jouées — symptôme diffus, cause introuvable.
Le même job refuse aussi un tag dont la version contredit `package.json`, faute de quoi l'image
porterait un nom que son propre `/reglages` démentirait (la version y vient de `package.json`,
CC-151, pas du nom du tag).

Les gates vivent dans `.github/workflows/gates.yml` (`on: workflow_call`) et sont appelées par
**deux** workflows : `ci.yml` (push master + PR) et `release.yml` (avant de publier). Une recopie
aurait divergé en silence ; ne remets pas les étapes dans un appelant.

⚠️ **Le secret publié, acté mort (2026-08-05).** Le commit `4bc2efc` (CC-75) retire du seeder un mot
de passe de développement écrit en clair — et le **message** du commit le nomme aussi. Il est
atteignable depuis `origin/master`, donc lisible publiquement. **Décision : acté mort, rotationné,
historique NON réécrit.** Le remède d'un secret publié est la rotation, jamais la réécriture — qui ne
rappelle ni les clones, ni les forks, ni les caches, ni les archives GitHub, pour un coût mesuré ici
à **~74 branches distantes à force-pusher, 3 tags à refaire**, et tous les SHA cités dans `docs/`,
dans ce fichier et dans les tickets rendus faux. Le compte de production porte un secret distinct et
un second facteur (CC-114) ; le seeder qui posait cette valeur n'existe plus (CC-138).

- ⚠️ **Ne rouvre pas ce dossier « par prudence ».** La question a été tranchée avec ses coûts sous
  les yeux ; la reposer sans fait neuf est du sur-process, et un force-push de 74 branches est
  précisément le genre d'action irréversible qu'on ne prend pas deux fois pour la même raison.
- Le reste de l'historique **a été balayé** le 2026-08-05 (pickaxe sur `APP_KEY=`, `AIza`, `ghp_`,
  `github_pat_`, `perm:`, `BEGIN RSA`, `BEGIN OPENSSH`, `IMMICH_API_KEY=`, `YOUTUBE_API_KEY=`) :
  **aucun autre secret réel**, uniquement des placeholders vides et des fixtures de test. C'est ce
  balayage-là, et pas la phrase de CC-142 qu'il a fallu corriger, qui fonde « publier ne fuite rien
  d'autre ».
- ⚠️ **Le corollaire vaut pour la suite : ce dépôt est public, donc tout ce qui y entre l'est.** Le
  domaine réel de l'installation en ligne, un chemin de volume du NAS, une valeur de `.env` — rien
  de tout ça ne s'écrit ici. L'arborescence actuelle est propre (tout est en `exemple.fr`) et c'est
  un état à tenir, pas un acquis.

## Les données : où elles vivent, comment on les sauve

Le contenu réel est saisi à la main, sans seeder : **la base est la seule copie**. D'où trois
protections, qui ne se remplacent pas — chacune couvre une panne que les autres laissent passer.

**1. `./pgdata` — un bind mount, pas un volume nommé.** Postgres écrit dans un dossier du dépôt
(ignoré par git), sur le disque de la machine. Un `docker compose down -v` **ne le touche pas** :
le `-v` ne supprime que les volumes gérés par Docker. C'est l'unique raison de ce choix.

- Contrepartie mesurée : ~20 % de transactions/s en moins qu'un volume natif, écritures massives
  nettement plus lentes (système de fichiers partagé Windows ↔ WSL2). Sans importance à cette
  volumétrie.
- Ce n'est **pas** une sauvegarde : c'est le fichier vivant de Postgres, binaire, lié à la version
  majeure (PG 16). Une corruption ou un `rm -rf` l'emporte.

**2. `npm run db:backup` — le vrai filet.** Dump SQL horodaté dans `backups/` (ignoré par git),
restaurable par `npm run db:restore` (le plus récent, ou `-- backups/<fichier>.sql`). Il emporte
**tout** : contenu, réglages, comptes. Le dump est fait avec `--clean --if-exists` : il **remplace**
la base, il ne fusionne pas.

Le dump est **vérifié** avant d'être annoncé, et **relu** avant d'être restauré : en-tête `pg_dump`,
au moins un `CREATE TABLE`, marqueur de fin. À la **sauvegarde**, un fichier qui échoue est supprimé
sur-le-champ plutôt que laissé à passer pour une sauvegarde. À la **restauration**, il est refusé et
**jamais** supprimé — il est peut-être le seul qui reste.

- ⚠️ **Ce n'est pas une restauration à blanc.** Ça attrape la troncature — disque plein, conteneur
  tué en plein dump, copie coupée — pas un dump complet mais logiquement inutilisable. La seule
  preuve qu'un dump se recharge reste de le recharger : **prouvé sur le poste de dev par CC-153**
  (22/22 tables identiques, base jetable, empreinte avant/après) — procédure rejouable dans
  `docs/restauration-verifiee.md`. ⚠️ Ça ne couvre que la chaîne du poste ; la chaîne du NAS (cron
  `pg_dump`, `docs/deploiement-nas.md` §7) reste, elle, non prouvée par un test réel.
- Le marqueur de fin est cherché dans les **derniers 8 Ko**, pas en dernière ligne : `pg_dump`
  écrit un `\unrestrict <jeton>` **après** lui. Le chercher en fin de fichier rejetterait tous les
  vrais dumps.
- L'absence de `CREATE TABLE` n'est pas une curiosité, c'est le symptôme d'un `DB_DATABASE` qui
  désigne une base vide — `app_test`, que `npm test` déroule à chaque exécution. `pg_dump` réussit,
  sort 0, et produit quelques Ko qui ne contiennent rien.
- `db:restore` refuse un dump qui échoue à cette relecture, et c'est le point important : `--clean`
  **supprime** les tables avant de les recréer. Sur un fichier tronqué, `ON_ERROR_STOP=1` s'arrête
  au milieu — base à moitié détruite, et le dump incapable de la reconstruire.

**3. `BACKUP_MIRROR_DIR` — la copie qui n'est pas sur ce disque** (CC-69). `backups/` vit à côté de
`pgdata/` : les deux premières protections sont sur le **même volume**, donc une panne de disque, un
vol ou un rançongiciel les emporte ensemble. Renseignée, cette variable fait copier chaque dump
vérifié vers un NAS ou un second disque. Voir `.env.example` pour les garde-fous ; les deux qui
comptent :

- ⚠️ **Le dossier doit exister — il n'est jamais créé.** Un `mkdir -p` sur un support non monté
  fabriquerait un dossier sur le disque local : on croirait être protégé sans l'être, ce qui est
  pire que de ne rien copier.
- ⚠️ **Les dumps partent en clair.** Décision assumée : la destination est un support de confiance.
- La copie est écrite sous `.part` puis renommée, et **relue depuis le support** : comparer les
  tailles ne prouve que la longueur. C'est la copie qui compte — la seule qui survive à la perte du
  disque — donc c'est celle dont on relit les marqueurs, pas seulement celle qu'on a envoyée.
- Seuls les dumps faits **après** avoir renseigné la variable partent au miroir. Ceux déjà dans
  `backups/` n'y montent pas tout seuls : une copie manuelle, une fois, au moment de l'activer.

**L'ordre des étapes de `db:backup` n'est pas décoratif** : dump → écriture close → vérification →
miroir → purge. `BACKUP_KEEP` (défaut 10) ne garde que les N derniers dumps **locaux** ; le miroir
n'est jamais purgé, c'est l'archive. La purge étant la seule opération destructive, elle vient en
dernier : si la copie vers le miroir échoue, **rien n'est supprimé**. Sans ça, un NAS débranché
ferait disparaître des dumps que l'archive n'a jamais reçus.

La logique qui décide de tout ça vit dans `scripts/lib/dumps.js`, séparée des scripts pour une
raison unique : elle est testable (`tests/unit/db_dumps.spec.ts`), les scripts non — ils dépendent
d'un conteneur Postgres qui tourne. C'est le seul endroit du dépôt où une erreur de logique se paie
en contenu perdu.

**Ces trois protections décrivent le poste de dev.** Depuis CC-140, `node ace db:backup` /
`db:restore` portent la même logique (`scripts/lib/dumps.js`, inchangé) pour toute installation
conteneurisée — `docker compose exec app node ace db:backup`, sans dépôt cloné, `pg_dump` en TCP
direct (`postgresql-client` dans l'image) plutôt que via `docker compose exec`. Les chemins y sont
**fixes** dans le conteneur (`/data/backups`, `/data/backup-mirror`) et montés une fois par le
compose (`BACKUP_DIR_PATH`/`BACKUP_MIRROR_DIR_PATH`, modèle `PGDATA_PATH`) — jamais saisis dans un
formulaire, pour la même raison que `BACKUP_MIRROR_DIR` doit exister sans jamais être créé. Une
sauvegarde quotidienne automatique (`providers/backup_provider.ts`, `environment: ['web']`
seulement) est activable par installation, réglable depuis `/admin/sauvegarde` avec la rétention.
Restaurer reste une commande, jamais une route — même doctrine que `auth:reset-account`.

Les scripts (`scripts/db-*.js`) appellent `docker compose exec` via `spawn` **avec un tableau
d'arguments**, jamais une chaîne interpolée dans un shell.

**Regarder la base.** Trois voies, et aucune n'est requise par l'application :

```bash
docker compose exec postgres psql -U root -d app        # rien à installer, marche tout de suite
docker compose --profile tools up -d adminer            # puis http://127.0.0.1:8081
```

⚠️ **Adminer est derrière le profil `tools` et ne démarre donc PAS avec `docker compose up`.** C'est
délibéré : il donne un accès complet en lecture **et en écriture** à la base qui porte l'unique
exemplaire des cartes. Un outil capable de vider une table ne tourne pas en fond par défaut. Son
port est lié à `127.0.0.1` explicitement — sans ce préfixe, Docker publierait sur `0.0.0.0` et
offrirait un formulaire de connexion à la base à tout le réseau local.

⚠️ Dans le formulaire, le serveur est **`postgres`** (le nom du service, joignable par le réseau du
compose), pas `127.0.0.1` — qui désignerait le conteneur Adminer lui-même. Et la base est **`app`** :
le cluster en porte trois, dont `app_test` que `npm test` vide à chaque exécution. Le port 5433 ne
concerne que les clients installés **sur la machine** (DBeaver, extension VS Code) ; ni `psql` via
`exec`, ni Adminer ne passent par lui.

⚠️ **Les deux ports publiés sont liés à `127.0.0.1`, jamais à `0.0.0.0`.** Docker publie sur toutes
les interfaces quand on écrit `'5433:5432'` : la base — l'unique exemplaire des cartes — serait alors
joignable depuis tout le réseau, et « réseau local » veut dire tous les inconnus connectés dès qu'on
travaille sur un wifi partagé. Ne retire pas ce préfixe : rien de ce que le projet utilise n'y perd,
puisque tout ce qui passe par ces ports tourne sur la même machine.

Le module Leitner a en plus son propre export/import JSON (`/revision/settings`), qui ne couvre que
son contenu et n'ajoute que ce qui manque — voir `app/modules/leitner/CLAUDE.md`. ⚠️ **Depuis
CC-119 ce fichier est PERSONNEL** (format v2) : contenu communal, mais progression et historique de
celui qui exporte. Sur une installation à plusieurs comptes, il ne sauvegarde donc pas tout —
`npm run db:backup` reste la seule sauvegarde complète.

## Le premier compte — l'écran d'installation, et rien d'autre (CC-138)

Sur une base qui ne porte **aucun compte**, l'application redirige vers `/installation` : nom,
email, mot de passe (12 caractères minimum, la même constante que partout — voir CC-147 plus bas)
et le **jeton d'installation**. Le compte créé est **administrateur** — sans le drapeau, personne
ne pourrait ensuite atteindre l'écran qui distribue les droits. `ADMIN_PASSWORD` n'existe plus :
plus rien ne la lit, une ligne restée dans un `.env` est inerte (CC-75 avait retiré le mot de
passe du code ; CC-138 retire le secret du fichier).

⚠️ **La garde qui rend l'écran sûr, et elle est double.** *(1)* L'écran n'est atteignable que si
la table `users` est **vide**, et la condition se relit à chaque requête dans l'état de la base —
jamais un drapeau posé à côté, qui pourrait mentir dans le sens qui rouvre la porte. Le contrôle
« aucun compte » et l'insertion tiennent dans **la même transaction**, sérialisée par
`pg_advisory_xact_lock` (`installation_service.ts`) : dans une table vide il n'y a rien à
verrouiller, et sans ce verrou deux POST simultanés feraient **deux** administrateurs sous READ
COMMITTED. La spec `installation.spec.ts` le prouve par deux POST réellement concurrents — hors
transaction globale, qui sérialiserait tout d'office et rendrait le test décoratif. *(2)* Le
**jeton** (modèle Jenkins, décision CC-128) couvre la fenêtre entre « port ouvert » et « compte
créé » : sur une application joignable d'Internet, « le premier qui se connecte » est le premier
scanner qui passe. Imprimé aux journaux au démarrage **seulement si `users` est vide**
(`providers/installation_provider.ts`), en mémoire seulement (un redémarrage en change la valeur,
les journaux portent toujours la courante), comparé à **temps constant**, jamais rendu dans une
réponse HTTP — erreurs comprises — et throttlé comme `/login` (10 échecs / 15 min par IP, seuls
les échecs de **jeton** comptent).

⚠️ **`node ace db:seed` ne fait plus RIEN, et c'est asserté** : plus aucun seeder n'est enregistré
(`config/database.ts` déclare `paths: []`, `tests/unit/db_seeders.spec.ts` rougit si un path
réapparaît). C'est la fin du chantier CC-106 — les trois derniers seeders écrivaient du contenu de
démo (9 services, 4 agents fictifs) ou l'identité du propriétaire en dur. Le rôle « Lecteur »,
seule donnée de référence du lot, vit désormais dans une migration **idempotente**
(`1785880000000_seed_lecteur_role.ts`, `on conflict do nothing`, `down` volontairement vide).
⚠️ La **rotation** du mot de passe propriétaire ne passe donc plus par le seed : `/reglages`
(connecté, CC-147) ou `auth:reset-account` (CC-129) ci-dessous.

### Reprendre la main sur un compte — `node ace auth:reset-account <email>` (CC-129)

```bash
node ace auth:reset-account quelquun@exemple.fr
```

Elle repose un mot de passe **et** désarme le second facteur — secret, codes de secours, anti-rejeu.
C'est le filet sous CC-114, dont la sortie ultime (« un **autre** administrateur ») n'existe pas sur
une installation à un seul compte : téléphone et codes perdus voulaient dire base inaccessible, avec
l'unique exemplaire des cartes dedans.

⚠️ **Elle ne crée aucun compte, et le titre de cette section reste donc vrai** : l'écran
d'installation est le seul chemin vers un *premier* compte. Celle-ci répare un compte qui existe.

⚠️ **La règle de longueur d'un mot de passe vit dans une seule constante partagée**
(`app/core/auth/constants/password_rules.ts`, `MIN_PASSWORD_LENGTH`/`MAX_PASSWORD_LENGTH`) depuis
CC-147. `acceptInvitationValidator`, `changePasswordValidator` et `installationValidator`
(`validators/admin.ts` et `validators/auth.ts`) la lisent — ce sont eux que voit l'utilisateur —
et `commands/reset_account.ts` fait de même plutôt que de la recopier. Avant CC-147 elle était
écrite à trois endroits sans rien qui les lie, et aucun test ne rougissait si l'un divergeait des
deux autres ; **changer la règle ne demande plus qu'un seul fichier.**

⚠️ **Une commande, jamais une route.** Toute sa valeur tient à ce qu'elle exige un accès que le
réseau ne donne pas — qui a un shell ici a déjà le disque et la base. Exposée en HTTP, même « bien
protégée », ce serait une porte dérobée sur l'écran de connexion.

⚠️ **Saisie interactive, et elle refuse de tourner sans terminal** plutôt que de retomber sur une
variable d'environnement : c'est la leçon de CC-75, un secret posé dans un `.env` y reste. Il n'y a
ni drapeau `--password`, ni variable — rien sur quoi retomber. La garde teste `process.stdin.isTTY`,
c'est-à-dire **exactement la précondition du prompt masqué** (`enquirer` appelle `stdin.setRawMode`,
qui n'existe que sur un TTY) : elle ne peut donc pas refuser une invocation où la saisie aurait
fonctionné. Sur le NAS, `docker compose run` alloue un terminal ; `exec -T` non.

⚠️ **L'ordre des écritures — second facteur d'abord, mot de passe ensuite — n'est pas décoratif.**
Aucune transaction ne les couvre (les `delete` de `twoFactor.disable` en sortiraient). Interrompue
au milieu, la commande laisse un compte au pire aussi ouvrable qu'avant. L'ordre inverse laisserait
un compte au **nouveau** mot de passe et toujours bloqué par son second facteur : l'ancien mot de
passe perdu pour rien, exactement ce qu'on venait réparer.

**Chaque passage laisse une ligne dans `account_reset_events`**, et le journal en dit autant. Les
deux, parce qu'ils ne servent pas au même moment : le journal parle à qui lance la commande, mais
sur le NAS il meurt avec le conteneur jetable de `run --rm`. La ligne en base est ce qui reste dans
six mois — la seule chose qui distingue « je l'ai fait » de « quelqu'un d'autre l'a fait ». Ni l'un
ni l'autre ne cite le mot de passe.

```bash
docker compose exec postgres psql -U root -d app \
  -c 'select user_email, created_at from account_reset_events order by id desc limit 20'
```

⚠️ **Ce n'est pas une alarme.** Qui a le shell peut aussi supprimer la ligne : ça attrape l'intrus
négligent, pas l'intrus soigneux. Son vrai destinataire est le propriétaire légitime, qui est celui
qui relira ce registre.

⚠️ **Elle ne réactive pas un compte désactivé et ne rend personne administrateur** — elle le
*signale*. Agir dessus en ferait un outil d'élévation de privilèges.

⚠️ **Elle doit être déployée AVANT d'en avoir besoin.** Le jour où le propriétaire est dehors,
l'image qui tourne sur le NAS est celle d'avant : il faut d'abord reconstruire et recharger.

**Elle ferme les sessions ouvertes ailleurs** (CC-176), en dernière écriture — après le second
facteur et après le mot de passe, sans rouvrir l'ordre ci-dessus. Livrer un mot de passe neuf en
laissant l'intrus dans la place viderait de son sens le filet du compte perdu : sans ce geste, un
cookie volé restait valable jusqu'à la borne des 7 jours (CC-78), reset ou pas. ⚠️ **Elle n'en
ferme aucune à l'unité** — le store est `cookie`, il n'existe aucune liste côté serveur : c'est
une révocation **en bloc**, et une commande n'ayant pas de session, celle de l'opérateur tombe
avec les autres.

## Architecture — feature-based

Chaque feature est une tranche verticale complète. Les dossiers AdonisJS par défaut
(`app/models/`, `app/controllers/`, `database/migrations/`, `inertia/pages/`) **n'existent plus**.

```
app/core/     auth · dashboard · i18n · settings · shared   → import via #core/*
app/modules/  services · agents · veille · leitner · coffre  → import via #modules/*
  └── controllers/ models/ migrations/ seeders/ services/ validators/ pages/
providers/    installation_provider · leitner_provider · veille_provider    → import via #providers/*
commands/     reset_account                         → import via #commands/*
```

- **Les alias de `package.json` décrivent exactement l'arborescence réelle** : `#core/*`,
  `#modules/*`, `#providers/*`, `#commands/*`, plus `#tests/*`, `#start/*`, `#config/*`. Les douze alias hérités du
  scaffold (`#models/*`, `#controllers/*`, `#services/*`, `#middleware/*`, `#validators/*`,
  `#database/*`…) pointaient vers des dossiers supprimés et ont été **retirés** : un import
  `#models/foo` échoue désormais tout de suite, au lieu de *paraître* correct.
- **`providers/` est à la racine, et c'est le chemin qu'AdonisJS impose** — `adonisrc.ts` y déclare
  `#providers/leitner_provider`, qui balaie au démarrage les ingestions interrompues. Ce n'est pas
  une entorse au découpage par feature : un provider est chargé par le framework au boot, avant
  toute notion de module. La règle « une feature est une tranche verticale » reste vraie pour tout
  le reste ; ce dossier-là est la **première** des deux exceptions, et elle est structurelle. Le
  module Leitner le documente comme le 5ᵉ fichier vivant hors de son dossier.
- **`commands/` est à la racine, et c'est la seconde exception — même raison exactement** (CC-129).
  Le noyau ace ne connaît qu'**un** dossier de commandes : `createAceKernel` construit son
  `FsLoader` sur `app.commandsPath()`, qui résout `directories.commands` (défaut `"commands"`).
  ⚠️ **Une commande posée dans un dossier de module n'est pas refusée — elle n'existe simplement
  pas** : aucune erreur, elle n'apparaît jamais dans `node ace list`. Même famille que le point 1
  des « choses qui cassent sans lever d'erreur ».

  Les deux contournements possibles sont pires, et c'est ce qui a tranché : le tableau `commands`
  d'`adonisrc.ts` n'accepte pas une classe — chaque entrée doit exposer `getMetaData()`/
  `getCommand()`, donc il faudrait écrire un chargeur à la main pour un seul fichier — et pointer
  `directories.commands` sur `app/core/auth/` est un réglage **global** : la prochaine commande,
  quel que soit son module, atterrirait dans le dossier de l'auth.
- **N'utilise pas `node ace make:*` tel quel** : ces commandes génèrent aux chemins par défaut et
  recréent l'ancienne arborescence. Crée les fichiers directement dans le module. Une **commande**
  ace est la seule exception à cette phrase : son chemin par défaut est le bon, et le seul.
- **Les traductions d'un module vivent dans le module** (CC-23). Le châssis — `brand`, `nav`,
  `sidebar`, `palette`, `login`, `forbidden`, `noAccess` — reste dans `inertia/i18n/{fr,en}.json`.
  Le contenu **d'une page de module** va dans `app/<couche>/<module>/i18n/<locale>.json` ; au boot,
  `inertia/i18n/index.ts` les ramasse par `import.meta.glob('/app/**/i18n/…')` et les range sous un
  namespace **égal au nom du dossier module** — les clés d'`agents` s'écrivent donc `t('agents.…')`.
  Trois choses à connaître : *(1)* la logique de fusion vit dans `inertia/i18n/messages.ts`,
  séparée du glob pour être testable (`__tests__/messages.spec.ts`) — même raison que
  `scripts/lib/dumps.js` ; *(2)* une **collision** de namespace (avec une clé du châssis ou entre
  deux modules) **lève au boot**, elle n'écrase jamais en silence ; *(3)* on est en **« FR d'abord »**
  — un module sans `i18n/en.json` retombe sur le français via `fallbackLocale`, ce n'est pas une
  panne mais une dette de traduction. Un `t('mod.clé')` sans clé correspondante s'affiche en **texte
  brut** à l'écran : c'est visible, pas silencieux.

- **Une clé écrite dans un template doit exister, et c'est désormais tenu par un test** (CC-113).
  `inertia/i18n/__tests__/keys.spec.ts` importe l'instance **réelle** — le vrai `import.meta.glob`,
  la vraie fusion — extrait les clés littérales de tous les `.vue` du dépôt (les 26, châssis
  compris, pas seulement les pages) et exige que chacune résolve. « Visible, pas silencieux »
  restait vrai *pour qui ouvre la page* : aucun runner ne montait de page avec cette instance-là,
  et une faute de frappe passait tous les gates. Le spec prouve du même coup qu'aucune collision de
  namespace ne fait lever le boot — ce que `messages.spec.ts`, qui travaille sur des entrées
  synthétiques, ne peut structurellement pas dire.

  - ⚠️ **Les clés calculées échappent par construction** — ``t(`agents.status.${status}`)``,
    `t(filter.labelKey)` : 20 sites, listés dans le fichier. Aucune extraction statique ne les
    atteint, et le sens inverse (une clé déclarée que plus personne n'utilise) n'est pas couvert
    **à cause d'eux** : il ne saurait pas distinguer une clé morte d'une clé consommée par un de
    ces 20 sites.
  - ⚠️ **Seul `fr` est vérifié**, la locale de référence — assertir `en` ferait rougir la dette
    « FR d'abord » ci-dessus, qui est un état choisi.
  - ⚠️ **Le plancher n'est pas décoratif** : c'est lui qui empêche la garde de naître inerte, même
    mode d'échec que `tests_index.spec.ts` (CC-112). Vérifié en cassant le balayage — la garde
    principale passe alors au **vert** en n'ayant rien comparé, seul le plancher rougit.

## Les tests : deux runners, et ce que chacun ne voit pas

`npm test` lance **les deux** suites, dans cet ordre : Japa (`node ace test`) puis Vitest
(`vitest run`). Isolément : `npm run test:back` et `npm run test:front`.

| | Japa | Vitest |
|---|---|---|
| couvre | routes, services, base, contrats HTTP | composants Vue |
| vit dans | `tests/unit/` · `tests/functional/` (globs de `adonisrc.ts`) | **à côté du `.vue`**, dans `__tests__/` |
| config | `adonisrc.ts` | `vitest.config.ts` |

**Les trois gates sont rejoués en CI** (CC-149) — `.github/workflows/ci.yml`, sur `push` vers
`master` et sur toute PR qui la vise : `typecheck`, `lint`, puis les deux suites en **deux étapes
distinctes**, parce que le `&&` de `npm test` n'affiche que la sortie de Japa et ne distingue pas
« Vitest a passé » de « Vitest n'a jamais démarré ». Écrire « gates verts » dans un compte rendu
n'est donc plus une affirmation à croire sur parole.

Son vrai apport n'est pas le badge, c'est qu'**il n'existe aucun `.env` sur un runner** : la classe
de bug de CC-88 — une valeur vide de `.env.test` qui ne masque rien et laisse passer le `.env` réel
de la machine, le chargeur fusionnant sur la *truthiness* — y est structurellement impossible.

⚠️ **Un vert n'y prouve que ce que ces trois commandes prouvent.** Ni le passage navigateur, ni la
divergence entre `app` et `app_test` (point 2 des « choses qui cassent sans lever d'erreur »), ni
l'apparence, ni une phrase fausse dans un message de commit. Le fichier porte cette liste en tête :
elle s'y maintient, pas ici.

⚠️ **Toucher à `.github/workflows/` demande le scope `workflow` sur le jeton, et GitHub refuse le
push sans lui** — API comprise, sans contournement côté client (`refusing to allow an OAuth App to
create or update workflow …`). Le message nomme la cause, pas le remède : `gh auth refresh -h
github.com -s workflow`. Le jeton de ce poste l'a depuis CC-149 ; une autre machine, ou une
rotation de jeton, le reperdra — et le refus arrive **après** que tout le travail est écrit.

**Les tests de composant sont co-localisés**, pas rassemblés dans `tests/`. Deux raisons : la
feature reste une tranche verticale (le test suit son composant s'il déménage), et surtout un
dossier `tests/frontend/` ne serait ramassé par **aucune** suite Japa — on fabriquerait au niveau
du runner le faux-négatif silencieux que ces tests existent pour supprimer.

**Un module qui a un `TESTS.md` doit y citer chacun de ses fichiers de test** (CC-112), par son
chemin relatif au dépôt. `tests/unit/tests_index.spec.ts` le vérifie **dans les deux sens** — une
spec absente de l'index, un chemin cité qui n'existe plus — et exige en plus qu'une spec de
`tests/unit/` ou `tests/functional/modules/` porte un préfixe de module (`veille_`, `leitner_`) ou
figure dans sa liste de specs transverses. Le `CLAUDE.md` de chaque module envoie lire son index
« avant de modifier un test » ; sans cette garde, la promesse ne tenait pas : celui de veille a
accumulé huit fichiers absents sur six tickets, tous gates verts.

- ⚠️ **Il asserte la MENTION, pas l'exactitude** — même limite que `db_seeders.spec.ts`, qui asserte
  la liste *déclarée* et non l'*effet* : une entrée dont la phrase est devenue fausse passe au vert.
- ⚠️ **Seuls les modules qui ont un `TESTS.md` sont couverts.** `services` et `agents` n'en ont pas,
  donc leurs tests ne sont indexés nulle part et rien ne le dit. Écrire un index les fait entrer
  dans la règle ; c'est le seul geste à faire.

**Quand écrire un test de composant : quand il porte de la *logique*, jamais pour du décor.** Un
filtrage, un état actif, une garde avant requête, un raccourci clavier — oui. Un composant qui ne
fait que disposer des `<div>` — non, le test ne dirait rien que la relecture ne dit mieux.

⚠️ **Ce que Vitest ne voit pas, et ne verra pas.** jsdom ne fait aucun layout : ni CSS, ni tokens de
couleur, ni « cette icône est-elle la bonne, est-elle bien colorée ». Le constat de
`TICKET-icones-interface.md:98-100` reste vrai — **l'apparence se vérifie au navigateur, et nulle
part ailleurs**. Ce qui a changé, c'est que la *logique* d'un composant est désormais prouvable.

⚠️ **Un test de composant doit échouer quand le code casse — vérifie-le.** Un composant part souvent
dans l'état que le test observe : monter puis assertir peut ne rien prouver du tout. Le test de
`TaxonomyCombobox` en est l'exemple — `filtering` vaut déjà `false` au montage, donc ouvrir la liste
sans avoir tapé passe même si la remise à zéro disparaît. Il faut reproduire le **geste réel** (taper,
fermer, rouvrir). En cas de doute, casse la ligne concernée et vérifie que le test rougit.

⚠️ **Ne fige jamais un bug connu dans un test.** Un test qui asserterait le comportement bogué du
moment le rendrait incorrigible sans rougir : on couvre le geste réel attendu, jamais l'état inerte
qu'on cherche à corriger. La palette ⌘K en a porté deux exemples, tous deux résolus — son filtrage
(CC-26) et sa navigation ↑↓/↵ (CC-27). `app_layout.spec.ts` les prouve désormais sur le geste réel :
ouvrir, taper, voir les non-correspondances disparaître ; descendre, boucler, ↵ pour naviguer, voir
la sélection se réinitialiser à la frappe. Chacun retombe si son comportement régresse — le reset
est même prouvé *négativement* : un index périmé ne surlignerait rien. C'est ce qui distingue une
couverture d'un décor.

⚠️ **`vitest.config.ts` est séparé de `vite.config.ts`, et doit le rester.** Sans lui, Vitest
chargerait la config applicative, donc les plugins `inertia()` et `adonisjs({ entrypoints })` — qui
résolvent des points d'entrée et un manifeste de build dont un runner n'a que faire.

⚠️ **`vue-shim.d.ts` existe pour `tsc`, pas pour Vite.** `tsconfig.json` n'exclut que `inertia/**` :
les specs co-localisés sous `app/**` entrent dans le graphe du typecheck, et leur import de `.vue`
lèverait TS2307. Contrepartie : les composants y sont typés `any` — le typecheck ne valide donc pas
les props passées à `mount()`, un test qui se trompe échoue à l'exécution. La lever demanderait
`vue-tsc` pour tout le dépôt.

## Sept choses qui cassent sans lever d'erreur

1. **Nouveau module → l'enregistrer dans `config/modules.ts`** (`KNOWN_MODULES`,
   `MODULE_MIGRATION_PATHS`) — **pas directement dans `config/database.ts`** (CC-137). Ce dernier
   ne fait plus que dériver ses `migrations.paths` de `migrationPathsFor` ; ses `seeders.paths`
   sont **vides et le restent** (CC-138, voir « Le premier compte »). Rien n'est auto-découvert :
   un module oublié de `KNOWN_MODULES` = migration jamais jouée, en silence. L'ordre de
   `KNOWN_MODULES` reste l'ordre d'exécution (contraintes FK).

   ⚠️ **Le mode d'échec que CC-137 a ouvert : coder un chemin en dur dans `config/database.ts`,
   « pour aller plus vite ».** Les migrations tournent, les tests restent verts, et rien ne le
   dit — mais le module vient de naître **non désactivable** : il apparaîtra toujours, quoi que
   dise `MODULES`, parce que son chemin ne passe plus par le filtre. Ce n'est pas un plantage,
   c'est l'absence silencieuse d'un comportement qu'on croyait acquis.

   ⚠️ **Être dans `KNOWN_MODULES` ne veut PAS dire « activé par défaut »** (CC-178). La liste dit
   quels noms `MODULES` a le droit de citer, rien de plus — `parseModules` fait échouer le
   démarrage sur un nom absent, donc un module optionnel doit **quand même** y figurer.
   `coffre` en est le premier cas : il est dans `KNOWN_MODULES`, **absent de `.env.example`** (une
   installation tierce ne l'hérite pas), et **présent dans `.env.test`** — ce dernier point est
   obligatoire, `modules_config.spec.ts` l'exige pour tous les modules connus, et pour une bonne
   raison : un module détachable non activé en test est un module dont plus une ligne n'est
   vérifiée. Les deux fichiers ne répondent pas à la même question.

2. **Migration neuve → la jouer sur la base de dev** (`node ace migration:run`). Le cousin du
   précédent, et il mord même quand tout est correct : la migration écrite, le path enregistré,
   les tests verts.

   ⚠️ **Une suite verte ne dit RIEN du schéma de `app`.** `npm test` migre `app_test` à neuf puis
   la déroule à chaque exécution — la base de dev n'est jamais touchée. Les deux peuvent donc
   diverger indéfiniment, et l'écart ne se manifeste qu'au premier appel de la colonne manquante.
   Si cet appel vit dans une boucle de fond (collecte de veille, ingestion Leitner), l'erreur part
   dans une colonne `last_error` que personne ne consulte spontanément : on croit à une panne du
   service distant. C'est arrivé sur CC-63 — le message accusait Immich, la cause était un
   `deleted_at` jamais créé.

   `node ace migration:status` tranche en une seconde. À faire **avant** de conclure qu'un bug
   vient d'ailleurs, et après tout `git pull` qui ramène une migration.

   ⚠️ **Une migration qui DÉPLACE des données ne se prouve pas non plus** : `app_test` est vide,
   donc son backfill ne s'exécute jamais sous Japa. Elle se vérifie à la main, sur la base de dev,
   par une **empreinte relevée avant et après** — c'est ce qu'a fait CC-119 en déplaçant la
   progression Leitner (`md5(string_agg(…))` sur (carte, boîte, échéance), identique avant, après,
   et après un aller-retour `rollback` → `run`). Sans ça, « les tests passent » ne dit rien de ce
   qui est arrivé au contenu réel.

   ⚠️ **`migration:rollback --batch=0` déroule TOUT le schéma, il ne revient pas d'un cran.** Sans
   argument, la commande annule le dernier lot — c'est presque toujours ce qu'on veut. Fais un
   `npm run db:backup` avant d'y toucher : sur la base de dev, `--batch=0` vide l'unique exemplaire
   des cartes en une seconde.

3. **Pages Inertia : le nom dérive du chemin du fichier**, résolu à la main dans `inertia/app/app.ts`
   (on retire `/app/` et `/pages/`). `inertia.render('modules/veille/index')` ⇄
   `app/modules/veille/pages/index.vue`. Un écart échoue au runtime, pas au build.

4. **Couleurs : uniquement les tokens `@theme` de `inertia/css/app.css`**
   (`bg`, `panel`, `panel-2`, `line`, `txt`/`txt-2`/`txt-3`, `accent`, `aqua`, `ok`/`bad`/`warn`).
   Aucune couleur en dur. Tout le style est utility-first dans les `.vue`.

5. **Route neuve → lui déclarer sa condition d'accès** (CC-71), sinon elle répond **403**.
   Trois formes, une seule par route, dans `start/routes.ts` :

   ```ts
   middleware.can('module.action')  // exige une capacité
   middleware.admin()               // is_admin seul (Services, Agents, /admin/*)
   middleware.openRoute()           // intentionnellement sans capacité (/login, /logout, /locale…)
   ```

   Celle-ci ne casse pas « en silence » au sens des quatre autres — elle **ferme**, et c'est le
   but : l'oubli va vers le refus, jamais vers l'ouverture. Ce qui déroute, c'est le 403 sur une
   route qu'on vient d'écrire et qui *paraît* correcte. `logger.error` nomme alors la route
   fautive, et `tests/functional/core/capabilities_routes.spec.ts` rougit en la nommant aussi.

   ⚠️ **Le noyau ne connaît le nom d'aucune capacité.** Chaque module déclare les siennes dans son
   `capabilities.ts`, enregistré au démarrage par `start/capabilities.ts`. Une capacité citée par
   une route mais absente du registre — une faute de frappe suffit — ferme la route pour tout
   non-admin **sans que `is_admin` s'en aperçoive** ; le même test l'attrape.

   ⚠️ **Il n'existe pas de capacité `*`.** L'accès total est le booléen `users.is_admin`, jamais
   une liste qu'il faudrait tenir à jour à chaque ajout. Ne retourne jamais le modèle « pour
   simplifier » : c'est ce qui rend sûres les routes que personne n'a encore écrites.

   ⚠️ **Depuis CC-137, cet enregistrement est CONDITIONNEL** : `start/capabilities.ts` n'enregistre
   les capacités d'un module que si `MODULES` l'active. Un module hors de `MODULES` n'a donc
   AUCUNE capacité au registre — à ne pas confondre avec la faute de frappe ci-dessus : l'une est
   un module qu'on a choisi d'éteindre, l'autre une capacité mal orthographiée dans un module
   allumé. Les deux produisent le même symptôme (capacité absente du registre), pas la même cause.

6. **Module neuf → déclarer sa destination** dans son `destinations.ts`, enregistré par
   `start/navigation.ts` (CC-81). C'est le pendant exact du point précédent, sur l'autre registre.

   Une destination est une **porte d'entrée** de module — l'écran vers lequel on envoie quelqu'un
   qui n'a rien demandé. Le registre en tire trois choses : les entrées de la barre latérale,
   **la page d'atterrissage** après connexion, après acceptation d'invitation, et quand un compte
   connecté rouvre `/login`, et **la racine du fil d'Ariane** de la topbar (CC-83). Tous
   redirigeaient vers `/` en dur, qui exige `dashboard.view` : un collègue sans cette capacité
   recevait un JSON d'erreur comme tout premier écran.

   ⚠️ **La racine du fil d'Ariane est `destinations[0]`, jamais `/`.** C'est la même valeur que
   l'atterrissage, donc le lien de la topbar et la redirection post-connexion désignent le même
   écran par construction. Un `href="/"` codé là rejouerait le bug : le seul élément cliquable de
   la topbar répondrait 403 aux comptes sans `dashboard.view`. La topbar affichait auparavant
   `Pilotage /` — une chaîne fixe, dans un `<span>`, qui nommait la *section* de la barre latérale
   et mimait une hiérarchie inexistante.

   ⚠️ **L'ordre de `start/navigation.ts` est l'ordre de la barre ET la page d'accueil des comptes.**
   Déplacer une ligne change l'écran d'arrivée ; c'est le seul endroit où ça se décide.

   ⚠️ **Le dernier segment du fil nomme l'ÉCRAN, et il se dérive — il ne se déclare nulle part**
   (CC-110). `AppLayout` lit `page.component` (`modules/leitner/stats`) et cherche
   `leitner.stats.crumb`, puis `leitner.stats.title` en repli : **les clés i18n de premier niveau
   d'un module portent le nom du fichier de page**, c'est le même invariant que le point 3 ci-dessus,
   lu dans l'autre sens. Une table `chemin → libellé` dans le châssis casserait la règle « il
   connaît la liste des modules, jamais celle des écrans » et vieillirait en silence à chaque page
   ajoutée. Ajouter un écran nommé dans le fil = ajouter sa clé dans le `i18n/` de **son** module,
   rien d'autre.

   - `crumb` **et** `title` parce que ce sont deux besoins : `title` remplit le `<title>` de
     l'onglet, où « Configuration du LLM » est juste ; un fil d'Ariane veut « Configuration ». Un
     écran au titre déjà court ne pose que `title` — c'est le cas de `stats`, et c'est ce qui garde
     le repli vivant plutôt que théorique.
   - ⚠️ **Clé absente → aucun segment, jamais la clé.** Un `t()` sans clé rend son chemin en texte
     brut : `agents.detail.crumb` s'afficherait dans la topbar. La garde est un `te()`, et
     `app_layout.spec.ts` la tient sur **deux** cas — aucune clé du tout, et `crumb` absent mais
     `title` présent. ⚠️ Tester ce repli depuis la **racine** d'un module ne prouve rien : on y sort
     avant même de chercher une clé. Il faut une sous-page.
   - ⚠️ **`ingest_show.vue` → `leitner.ingestShow`** : les fichiers de page sont en snake_case, les
     clés en camelCase. Tant qu'un nom tient en un mot les deux coïncident et on peut croire qu'il
     n'y a pas de règle.
   - La logique vit dans `inertia/layouts/breadcrumb.ts`, **pure**, testée par Vitest — même raison
     que `inertia/i18n/messages.ts` : ce qui reste dans un `<script setup>` n'est atteignable par
     aucun exécuteur.

   ⚠️ **Un module oublié va vers le refus, mais en mentant** : son entrée disparaît de la barre, et
   un compte qui n'aurait de droits que sur lui atterrit sur « aucun accès » alors qu'il en a.
   `tests/functional/core/navigation_registry.spec.ts` asserte la liste attendue, croise chaque
   capacité citée avec le registre de capacités, et vérifie que **la condition d'accès déclarée est
   celle de la route** — sans quoi l'atterrissage enverrait droit sur un 403.

   ⚠️ **Un module peut vouloir n'avoir AUCUNE destination, et c'est alors une décision qui
   s'écrit** (CC-178). `coffre` est le premier : sans entrée au registre, il disparaît de la barre,
   du fil d'Ariane **et** de la palette ⌘K, qui en dérivent tous les trois — il n'y a aucun code
   d'invisibilité à écrire. Deux choses à ne pas rater : `start/navigation.ts` porte la raison sur
   place, pour qu'on ne « répare » pas l'absence ; et `DESTINATION_PAR_MODULE` du spec accepte
   `null` **en gardant son `Record` total**, pour qu'un module ajouté demain doive toujours
   *déclarer* ce qu'on attend de lui — le passer en `Partial` ferait naître la garde inerte de
   CC-112/CC-113. La contrepartie est réelle et assumée : un compte qui n'aurait de droits que sur
   ce module atterrit sur « aucun accès » et doit taper l'URL.

   ⚠️ **Un refus se lève, il ne se retourne pas.** `throw new ForbiddenException(…)`, jamais
   `response.forbidden({…})` : `statusPages` n'est consulté que par le gestionnaire d'**exceptions**,
   donc une réponse écrite à la main court-circuite la page 403 et rend du JSON brut au navigateur.
   Rien ne le signale — un 403 reste un 403.

   ⚠️ **Depuis CC-137, `start/navigation.ts` conditionne de la même façon que `start/capabilities.ts`
   au point précédent** : un module hors de `MODULES` n'a pas de destination enregistrée. Son
   entrée disparaît de la barre pour une raison structurelle — le module est éteint —, pas par
   l'oubli que le paragraphe ci-dessus décrit sur un module allumé.

7. **Rendre un module détachable ne s'arrête pas aux quatre registres** (CC-137). La liste complète
   des endroits à conditionner sur `MODULES`, tenue à jour ici parce qu'un module futur qui en
   oublie un ne plante pas — il fuit silencieusement :

   - les quatre registres de démarrage, chacun lu **une seule fois au boot** : `start/routes.ts`,
     `start/capabilities.ts`, `start/navigation.ts`, `config/database.ts` (via `config/modules.ts`,
     voir le point 1) ;
   - ⚠️ **les providers de tâche de fond** (`providers/`) — le point dur du lot, trouvé en faisant
     tourner un vrai serveur avec `MODULES` réduit plutôt qu'en le déduisant du code : sans garde,
     `VeilleProvider` et `LeitnerProvider` démarrent au boot quel que soit `MODULES`, et un module
     désactivé dont le provider tourne quand même **spamme une erreur SQL à chaque tick,
     indéfiniment**, contre une table qui n'existe pas — constaté, pas seulement redouté. Chaque
     provider doit lire `isModuleEnabled(...)` en tête de `ready()` (et de `shutdown()` s'il en a
     un) ;
   - les points de couplage hors module qui interrogent plusieurs modules à la fois
     (`app/core/dashboard/controllers/home_controller.ts`,
     `app/core/shared/services/nav_stats_service.ts`) — ils ne passent jamais par le `Set` lu au
     boot, mais par `isModuleEnabled(...)`, relu à chaque requête.

   ⚠️ **La distinction entre les deux façons de lire `config/modules.ts` n'est pas cosmétique.**
   Les quatre registres lisent le `Set` **une seule fois, au démarrage** : le muter en cours de
   route (comme le font les tests, sur le modèle de `dockerConfig.disponible`, CC-116) ne retire
   AUCUNE route déjà commitée ni AUCUNE capacité déjà enregistrée. `isModuleEnabled(...)`, lui, est
   relu à **chaque appel** — c'est la seule des deux formes qu'un test peut faire varier sans
   redémarrer le process, et c'est pour ça qu'un admin qui court-circuite les capacités
   (`HomeController`, `NavStatsService`) reste protégé même sans redémarrage entre deux requêtes.

   ⚠️ **`.env.test` doit garder `MODULES` NON VIDE.** Le chargeur d'`@adonisjs/env` fusionne par
   truthiness, jamais par présence : une valeur vide n'y masquerait rien, le `.env` réel de la
   machine qui lance les tests passerait derrière — le mécanisme mesuré en CC-88 sur
   `IMMICH_BASE_URL`, documenté en détail dans `.env.test`. `tests/unit/modules_config.spec.ts`
   rougit si `MODULES` cesse d'activer tous les modules connus en environnement de test.

## Sécurité — ne pas régresser

- **`agent.config.command` est une commande shell exécutée telle quelle** (`AgentRunnerService`).
  C'est assumé (modèle « cron »), sur la seule garantie que **ce champ n'est écrivable par aucun
  formulaire**. Ne l'expose jamais dans une UI d'édition : ce serait une RCE.
- **Docker : `execFile` + whitelist regex sur le nom de conteneur** (`SystemStatsService`).
  Jamais `exec()` avec interpolation de chaîne.
- **Masquer un bouton n'est pas un droit.** Une route est un contrat public : `POST /revision/cards`
  répond que le bouton soit affiché ou non, et un `curl` muni d'un cookie de session valide n'a que
  faire du rendu Vue. Le middleware de capacité ferme ; le masquage dans l'UI évite seulement de
  proposer une action qui échouerait. **Les deux, jamais l'un sans l'autre.**
- **En dev et en test, une route déclarée passe AVANT le serveur d'assets** (CC-170). La pile de
  `start/kernel.ts` n'appelle plus `@adonisjs/vite/vite_middleware` directement mais
  `#core/shared/middleware/vite_dev_server_middleware`, qui lui délègue tout **sauf** ce que
  `router.match` reconnaît. Sans ce garde, le middleware vendeur — qui est un middleware
  **serveur**, donc antérieur au routeur — laissait le serveur de dev Vite résoudre le chemin
  contre la racine du projet : `agents.json` (CC-141, ignoré par git) répondait à `GET /agents`
  en 200 `text/javascript`, **sans authentification**, `config.command` en clair. Rien ne le
  signalait — un 200 reste un 200 — et la CI restait verte, n'ayant pas le fichier. Ne « reviens
  pas au scaffold » sur cette ligne ; `tests/functional/core/vite_route_shadowing.spec.ts`
  fabrique lui-même le fichier masquant, il rougirait donc partout, y compris en CI.
- **`whereRaw` toujours paramétré** (bindings `?`), jamais concaténé.
- Toute entrée utilisateur passe par un validateur VineJS. CSRF actif (Shield) : les POST de test
  exigent `.withCsrfToken()`.
- **Une validation ratée ne rejoue PAS le corps soumis** (CC-179,
  `app/core/shared/exceptions/handler.ts`). ⚠️ Ce n'est pas le comportement du framework, c'est un
  correctif : `@adonisjs/session` remplace `renderValidationErrorAsHTML` par une macro dont le
  `flashValidationErrors` appelle `flashExcept(['_csrf', '_method', 'password',
  'password_confirmation'])` — **tout le reste du corps repart dans la session**, et le store
  étant `cookie`, il voyage chiffré par `APP_KEY` chez le client. Un code TOTP mal formé sur
  `POST /coffre/ouvrir` suffisait à y expédier la **passphrase du coffre**, c'est-à-dire la seule
  chose que ce module existe pour tenir hors d'`APP_KEY`. Le handler laisse `super` écrire le
  bagage d'erreurs puis écrase l'input par `flashOnly([])`.
  - ⚠️ **Ne « restaure » pas le rejeu en croyant réparer un formulaire.** Rien ici ne le lit : les
    vues sont Inertia, `useForm` garde l'état côté client, et les lectures de `flashMessages`
    portent toutes une clé nommée (`notice`, `errorsBag`, `importReport`…), jamais `input`.
  - ⚠️ **Le corps rejoué s'étale à la RACINE du bagage**, il n'est pas rangé sous `input` — c'est
    ce qui fait marcher `old('champ')`. Un test qui lirait `flashMessages().input` obtiendrait
    `undefined` et passerait au vert sans rien vérifier. `validation_flash.spec.ts` porte le
    piège, teste sur `passphrase` (un nom **hors** de la liste du vendeur, sinon la garde
    passerait sans le correctif) et garde un plancher qui exige que les messages d'erreur, eux,
    soient toujours flashés.
- **La CSP est active** (`config/shield.ts`, CC-78), et `script-src` est strict. Toute ressource
  externe ajoutée à une page — script, police, image non proxifiée — sera **bloquée en silence** :
  rien au build, rien aux tests (jsdom ne charge rien), seule la console du navigateur le dit.
  Ajouter le domaine à la directive concernée **et re-passer l'écran au navigateur**.
  `style-src 'unsafe-inline'` est un compromis assumé (liaisons `:style` de Vue, barre de
  progression Inertia — aucun nonce ne les couvre) : ne pas le « durcir » sans passage navigateur
  complet. `tests/functional/core/security_headers.spec.ts` empêche l'en-tête de disparaître ou de
  s'affaiblir ; il ne voit **pas** les violations.
- **`POST /login` est throttlé** (CC-78) : 10 échecs / 15 min par IP, 5 par email. Seuls les
  **échecs** comptent et un succès efface — c'est ce qui empêche deux comptes derrière un même NAT
  de se verrouiller mutuellement ; ne pas « simplifier » en comptant tout. Deux variables :
  `LIMITER_STORE` (**requise au boot** ; `database` partout, `memory` réservé à `.env.test` — les
  compteurs mémoire survivent aux transactions de test, d'où les `limiter.clear` en setup des
  specs qui postent `/login`) et `TRUST_PROXY` (à renseigner au déploiement derrière le proxy DSM,
  sinon toutes les requêtes portent l'IP du proxy et un seul attaquant bloque tout le monde ; trop
  large, un client direct forge son `X-Forwarded-For` — voir `.env.example`).
- **Les sessions expirent 7 jours après la connexion**, quelle que soit l'activité
  (`session_lifetime.ts`, contrôle dans `auth_middleware`) : le store cookie n'a aucune liste
  serveur, cette borne est la seule chose qui limite un cookie volé rejoué régulièrement. Un
  tampon absent est **posé, jamais expulsé** (sessions d'avant CC-78, `loginAs` des tests) ; le
  contrôleur re-tamponne à chaque connexion — retirer l'un des deux bouts recrée une boucle
  d'expulsion ou une session immortelle. Les liens d'invitation valent **48 h**.
- **Les sessions ouvertes ailleurs se ferment en bloc** (CC-176) : `users.sessions_valid_from`,
  comparée au même tampon par le même middleware — toute session connectée **avant** cette borne
  est morte. Trois déclencheurs : le bouton de `/reglages`, le changement de mot de passe, et
  `auth:reset-account`. Rien d'autre n'a changé — pas de table, pas de requête de plus (le compte
  est déjà chargé), pas de store en base.

  ⚠️ **`revokeSessions` (`session_revocation.ts`) est le seul chemin, et il fait les DEUX
  écritures.** Le mode d'échec de ce mécanisme est un bug d'**appelant** : poser la borne d'un
  côté puis re-tamponner sa propre session de l'autre revient à appeler `now` deux fois, et
  l'utilisateur qui vient de cliquer se déconnecte lui-même au rechargement suivant. Aucun
  appelant ne connaît donc l'instant — il passe sa session, ou rien (`auth:reset-account` n'en a
  pas). Le tampon reposé vient de la valeur **relue en base**, jamais du `DateTime` fabriqué :
  l'égalité avec la borne devient vraie par construction, quoi que fasse le driver, et la
  comparaison **strictement `<`** laisse alors passer cette session-là.

  ⚠️ **Un tampon absent est révoqué quand la borne est posée**, alors qu'`isStampExpired` le
  tolère — c'est le trou par lequel la révocation fuirait. `AuthMiddleware` *repose* le tampon
  quand il manque (décision de CC-78) : sans cette règle, une session sans tampon se verrait
  offrir une date postérieure à la borne et y survivrait, le geste paraissant fonctionner sans
  rien fermer. Quand la borne est `null`, on retombe sur la tolérance d'origine, intacte.

  ⚠️ **La garde est `isSessionRevoked`, PAS la position du contrôle dans le middleware — mesuré,
  contre ce que le ticket affirmait.** Déplacer le bloc *après* la branche « tampon absent » ne
  fait rougir aucun test : le contrôle lit `stamp`, capturé en `const` avant le `session.put`,
  donc l'ordre des deux blocs n'y change rien. Ce qui tient réellement est le `return true` sur
  un tampon illisible, et une mutation le prouve. Le vrai piège pour un futur lecteur est de
  **relire `ctx.session.get(…)` après la branche** au lieu d'utiliser la valeur capturée. Ne
  « préserve » donc pas l'ordre en croyant préserver la garde.

  ⚠️ **Aucune liste d'appareils, aucune révocation à l'unité, et rien ne doit le laisser
  espérer.** Le serveur ne sait ni combien de sessions existent, ni depuis où. Un écran
  « Appareils » demanderait de passer le store en base, avec une requête par requête HTTP et une
  table à purger : autre ticket, autre arbitrage. L'écran dit « sessions », jamais « appareils
  connectés ».

  ⚠️ **`silent_auth_middleware` ne porte pas ce contrôle**, comme il ne porte déjà ni l'expiration
  absolue ni `isActive` : il ne sert que les routes ouvertes, qui n'exposent aucune donnée
  protégée.

  ⚠️ **`invitation_controller.ts:74` est le seul chemin de connexion qui ne pose pas de tampon**,
  contrairement à `auth_controller.store` et `two_factor_controller`. C'est inerte aujourd'hui —
  un compte fraîchement invité a `sessions_valid_from` à `null`, donc le middleware lui pose le
  tampon au premier écran — mais c'est le fil qui casserait si quelqu'un durcissait un jour le
  cas « tampon absent » **sans** le conditionner à une borne posée : les comptes invités seraient
  déconnectés au premier clic. Le lot ne l'a pas touché faute de besoin, pas par oubli.

- **Le coffre a sa propre porte, et elle ne se recopie pas ailleurs** (CC-178,
  `app/modules/coffre/CLAUDE.md`). Deux points de ce fichier y sont **volontairement enfreints**,
  et il faut savoir lesquels avant de « corriger » :
  - ⚠️ **Son chiffrement n'utilise PAS `encryption` / `APP_KEY`**, contrairement au secret TOTP.
    `APP_KEY` vit dans le `.env`, à côté de la base : les deux tombent ensemble. La clé dérive
    d'une **passphrase** (scrypt + AES-256-GCM, `node:crypto` seul), qui n'est stockée nulle part —
    donc **passphrase perdue = contenu perdu**, sans équivalent d'`auth:reset-account` possible :
    ce serait une porte dérobée. C'est le raisonnement des codes de secours de CC-114, poussé d'un
    cran.
  - ⚠️ **Il n'enregistre aucune destination** (voir le point 6) et reste **hors de `MODULES` par
    défaut**. Le rideau protège d'un regard, jamais d'une recherche : le bundle JS livré au
    navigateur porte ses clés i18n, et le dépôt est public. Ce qui protège est le mur —
    `can('coffre.view')` **plus** une élévation de session à durée courte (15 min), sans laquelle
    chaque route du contenu lève `ForbiddenException`, `curl` avec un cookie valide compris.
  - ⚠️ **La clé déchiffrée vit en MÉMOIRE du process**, jamais en session : le store est `cookie`,
    donc tout ce qu'on y écrit est chiffré par `APP_KEY` et voyage chez le client. Un redémarrage
    referme donc tous les coffres, et le mécanisme suppose une seule instance.
  - ⚠️ **L'élévation ne survit pas à une reconnexion** : le marqueur est comparé au
    `LOGIN_STAMP_KEY` de CC-78 — `auth.logout()` n'efface que la clé du guard, pas la session.

### Le second facteur TOTP (CC-114)

Optionnel par compte, activé depuis `/reglages` — l'écran de `core/settings`, où vit aussi le
sélecteur de langue. ⚠️ **Ce domaine existe pour que l'entrée « Réglages » de la barre latérale ne
mente pas** : CC-81 l'avait retirée parce qu'elle pointait vers `/`, donc vers un refus pour un
non-admin. La remettre n'était acceptable qu'avec un écran derrière. Elle est **visible par tout le
monde**, contrairement à l'administration — chacun y règle son propre facteur, et un compte que
`ADMIN_2FA_REQUIRED` renvoie là doit pouvoir l'atteindre. `POST /login` valide le mot de passe puis,
si le compte est enrôlé, **ne connecte pas** : il pose un marqueur de session expirant (5 min,
`two_factor_challenge.ts`) et renvoie vers `/login/2fa`, qui seul appelle `auth.login()`. Le
paramétrage TOTP (SHA-1, 6 chiffres, 30 s) vit dans `totp.ts` et est figé par un vecteur de la
RFC 6238 — c'est lui qui rend le QR lisible par une application d'authentification, et le changer
produirait des codes refusés **sans lever d'erreur**.

- ⚠️ **`clearFor` du throttle ne s'appelle qu'à la connexion complète**, jamais après le seul mot
  de passe. Le remettre à l'étape 1 rouvrirait la force brute sur six chiffres : il suffirait de
  rejouer `/login`, dont on connaît le mot de passe, pour remettre le compteur à zéro entre chaque
  essai de code. « Un succès efface » (CC-78) veut dire un succès **complet**.
- ⚠️ **L'acceptation d'une invitation exige le code, elle aussi.** Ce lien pose un mot de passe
  **et** connecte : sans ce détour, quiconque l'intercepte entrerait sans jamais croiser le second
  facteur, quel que soit le soin mis à le vérifier sur `/login`. Une porte fermée d'un seul bout
  n'est pas fermée.
- ⚠️ **Le secret est chiffré (APP_KEY), les codes de secours sont hachés (SHA-256).** Ce n'est pas
  une incohérence : un secret TOTP doit être *relu* à chaque connexion, donc il ne peut pas être
  haché. Et une APP_KEY changée rend tous les secrets illisibles d'un coup — si les codes de
  secours en dépendaient, ils tomberaient avec ce qu'ils sont censés rattraper. Un secret
  indéchiffrable **refuse** la connexion (jamais « pas de TOTP », qui l'ouvrirait) mais laisse
  passer un code de secours : c'est ce qui en fait une vraie porte et pas une seconde serrure sur
  le même barillet.
- ⚠️ **`totp_last_step` est l'anti-rejeu, et il n'est pas décoratif** : un code vaut ~90 s (fenêtre
  ±1 pas), donc sans lui un code intercepté resservirait dans sa fenêtre.
- ⚠️ **`ADMIN_2FA_REQUIRED` est opt-in, défaut `false`, et l'oubli va vers l'OUVERTURE** — l'inverse
  de la règle des routes, délibérément. Fermer par défaut enfermerait dehors l'unique administrateur
  d'une base existante au premier `git pull`. Le verrou vit dans `auth_middleware`, pas dans la
  redirection post-connexion : un contrôle qui ne tient que sur le chemin nominal se contourne par
  une URL tapée à la main. Ses exemptions (`/reglages` **et ses sous-chemins**, `/logout`,
  `/locale`) sont ce qui empêche la boucle de redirection ; `two_factor.spec.ts` prouve que l'écran
  s'ouvre *et* que ses POST passent.
- ⚠️ **Rien ne prouve, et rien ne prouvera par test, qu'un téléphone lit le QR.** jsdom ne rend rien.
  Avant d'allumer `ADMIN_2FA_REQUIRED` sur une installation : passage navigateur, vraie application
  d'authentification, et noter les codes de secours. La sortie ultime — téléphone **et** codes
  perdus — est `/admin/users/:id`, donc un **autre** administrateur ; sur une installation à un seul
  compte, il n'y en a pas.

## Conventions

- Contrôleurs fins ; la logique va dans les `services/` du module.
- Code et commentaires **en français**. Messages de commit en **anglais**, Conventional Commits.
- Les `catch {}` de `SystemStatsService` et `AgentRunnerService` avalent l'échec Docker/script et
  simulent le succès en base : **c'est volontaire** (poste de dev sans conteneurs réels), ne le
  « corrige » pas.
- **Ne ré-épingle pas `@swc/core` en version exacte.** Le pin `1.11.24` hérité du scaffold
  `create-adonisjs` segfaulte à la terminaison du process de test dès que le graphe de modules
  dépasse un certain volume : `npm test` affiche `PASSED` mais sort en **code 1**. Range `^1.15.43`.
- Ne t'ajoutes jamais en tant que co-author sur les commit, si tu vois des commit ou tu es co-author, supprimes toi.

## Comment travailler sur CE dépôt

> Les principes généraux — style de collaboration, vérification du réel, fabrication de ticket,
> relais entre conversations, mémoire et compaction — vivent dans `~/.claude/CLAUDE.md` et valent
> partout. Ici, seulement ce qui est propre à Command Center.

### Les skills du dépôt (`.claude/skills/`)

- **`/lead-review`** — review pre-commit d'un diff à substance, **avant** `/git-commit`.
- **`/git-commit`** — commits, branches, PR. Applique-le dès qu'il est question de message de
  commit, de découpe ou de nom de branche.
- **`/review-mr`** — self-review d'une de mes PR avant merge. Ne relit **plus** la KB YouTrack
  après merge — voir `/kb-sync`.
- **`/kb-sync`** — balaie la KB YouTrack (`CC-A-1` à `CC-A-13`) en entier et corrige ce qui a
  cessé d'être vrai. Détaché de `/review-mr` (2026-08-03, coût en tokens) : **à lancer à la
  main**, plus jamais systématiquement à chaque PR. N'existe qu'en version dépôt, pas de
  version globale.
- **`/plan-sync`** (2026-08-06, CC-187) — met à jour **`CC-A-14`**, le plan d'exécution : *quoi
  faire ensuite, dans quel ordre et pourquoi*, là où `CC-A-12` dit seulement ce qui existe. Il
  rejoue `/kb-sync` **en phase 1** — un plan bâti sur une KB périmée propage l'erreur dans le
  document qui décide de la suite — puis relit le backlog réel via un sous-agent et réécrit
  l'article **en place**. À lancer à la main, depuis une conversation-orchestrateur seulement.
  ⚠️ **Deux articles, jamais un** : un inventaire vieillit à chaque ticket créé, un plan à chaque
  arbitrage pris ; les fondre ferait perdre laquelle des deux moitiés est encore vraie.
  ⚠️ **C'est lui qui interdit `disable-model-invocation: true` sur `/kb-sync`** — voir le bloc du
  drapeau plus bas : la phase 1 échouerait sans un mot.
- **`/triage-youtrack`**, **`/create-issue-from-code`**, **`/summarize-sprint`**,
  **`/link-commit-to-issue`** (2026-08-04) — quatre skills légers autour du
  MCP YouTrack, pensés pour rester **strictement en MCP, jamais en REST direct** : un appel REST
  exigerait le bearer token accessible à un script, ce qui contredit le point Sécurité sur les
  tokens (§ Garde-fous) pour un gain mesuré comme marginal (les champs qu'une sélection REST
  couperait pèsent quelques dizaines de tokens face aux corps de texte, qui doivent de toute façon
  être lus). `/summarize-sprint` et les volumes de `/triage-youtrack` passent par un sous-agent
  (`Agent`, `subagent_type: general-purpose`) qui ne renvoie qu'une synthèse — même pattern que
  `/kb-sync`. Toute écriture (`create_issue`, `update_issue`, `add_issue_comment`) attend une
  confirmation explicite avant l'appel MCP, jamais d'envoi silencieux.
  ⚠️ **`/prepare-issue-context` a été SUPPRIMÉ le 2026-08-06 — ne le recrée pas.** Il enveloppait
  un unique `get_issue` dans un skill, et il ne portait aucune connaissance qui ne soit ailleurs :
  son seul contenu propre, `recentCommentsCount: 0`, est déjà la consigne par défaut de la mémoire
  `youtrack-mcp-cout-tokens`. Surtout, il n'avait **aucune place dans le cursus réel** : quand
  l'orchestrateur vient de créer le ticket, il en a le contenu en tête ; quand la
  conversation-ticket démarre, l'étape 1 de `/task-flow` lit déjà tout — et en plus, elle passe
  `In Progress`. Il n'a jamais été invoqué une seule fois (`.claude/youtrack-usage.log` n'existait
  même pas), tout en coûtant sa `description` dans le contexte système de **chaque** session.

- **`/youtrack-stats`** (2026-08-04) — agrège `.claude/youtrack-usage.log` (non versionné), alimenté
  par les cinq skills ci-dessus à chaque invocation, et rapporte la réduction de contexte réelle de
  la délégation à un sous-agent. Le journal est vide tant qu'aucun des cinq n'a tourné : le format
  est en place, la mesure ne l'est pas encore.

⚠️ **Cinq skills YouTrack portent `disable-model-invocation: true` depuis le 2026-08-06 — il faut
donc les TAPER, je ne les proposerai jamais.** Mesuré ce jour-là sur 298 sessions depuis le
01/07 : `git-commit` 67 invocations, `lead-review` 62, `task-flow` ~74, `review-mr` 18 — et **zéro**
pour les six skills YouTrack. Un skill que je n'invoque pas coûte quand même sa `description` dans
le contexte système de **chaque** session ; le drapeau la retire de ma liste sans supprimer le
skill, qui reste atteignable au slash. C'est la voie moyenne entre garder un poids mort et perdre
une procédure écrite.

- ⚠️ **`/kb-sync` est le SIXIÈME, et il est resté hors du lot — ce drapeau ne coupe pas seulement
  la suggestion, il coupe l'APPEL.** Un skill qui le porte n'est plus atteignable par l'outil Skill
  **depuis un autre skill** : `/plan-sync` (CC-187) rejoue `/kb-sync` en phase 1, et le flaguer
  ferait échouer cette phase **sans un mot**. C'est exactement la raison pour laquelle
  `/git-commit` et `/lead-review` sont eux aussi restés dehors — `/task-flow` les atteint de la
  même façon à son étape 8. **Ne repose pas ce drapeau sur `/kb-sync` en croyant l'avoir oublié.**
- ⚠️ **Zéro invocation ne prouve pas l'inutilité, et c'est pour ça qu'on n'a supprimé que
  `/prepare-issue-context`.** `/kb-sync` était à zéro parce qu'il était **reporté** — la mémoire le
  disait « passé d'utile à nécessaire » — pas parce qu'il ne servait à rien. Ce qui a condamné
  `prepare`, c'est la redondance structurelle avec l'étape 1 de `/task-flow`, pas le compteur.
- ⚠️ **Le coût du drapeau reste réel pour les cinq autres** : plus rien ne me fera dire « tu
  devrais lancer `/triage-youtrack` ». Leur usage ne se rappellera plus tout seul ; il ne vit que
  dans la mémoire de reprise et ici. `/kb-sync` échappe à ce coût par un autre chemin :
  `/plan-sync` le rejoue, donc son rappel est devenu **structurel** plutôt que suggéré.

⚠️ **Les trois premiers de ces noms existent AUSSI en global**, dans une version qui vise l'autre
workspace (GitLab, NestJS, `develop`, pnpm, `Refs: #SAAS-XX`). **Le skill du dépôt ne masque pas le
global** — le harness peut charger l'un ou l'autre, constaté deux fois dans une seule session. Après
tout `/lead-review`, `/git-commit` ou `/review-mr` : vérifier **laquelle a été chargée** (le « Base
directory » l'indique) et le dire si c'est la mauvaise.

### Le dépôt est solo — il n'y a personne à qui assigner

**Le compte GitHub `@DevBen5` est la seule référence.** Le dépôt est `DevBen5/command-center`, tout
part de **`master`** et y retourne : il n'y a **ni `develop`, ni lead dev, ni personne d'autre** à
mentionner ou à assigner. Une PR n'est assignée à personne ; c'est **le propriétaire** qui la merge
(`gh pr merge --merge`, jamais `--squash`, branche conservée), et toi jamais sans **go explicite**
(cf. skill `/git-commit`).

### Les gestes qui appartiennent au propriétaire — et comment les lui livrer

Certaines actions ne peuvent pas être prises depuis une conversation : soit parce qu'elles sont
irréversibles et lui reviennent (merger, publier, fermer un ticket), soit parce qu'aucun outil de
ce poste ne les atteint (un clic dans une interface web, un écran à regarder). **Elles ne se
contournent pas.** Ce qui suit est la façon de les lui livrer, et c'est aussi contraignant que le
reste de ce fichier.

⚠️ **Une intention n'est pas une consigne.** Écrire « il reste le clic de visibilité GHCR » ou
« il faudrait un passage navigateur » transfère au propriétaire le travail de retrouver la
procédure — alors qu'on vient de la lire dans le dépôt. Un geste attendu de lui se livre en
**procédure exécutable, dans le même message**, avec trois choses :

1. **Où** — l'URL complète et le chemin exact dans l'interface (« tout en bas → Danger Zone →
   Change package visibility → Public »), jamais le seul nom de la fonctionnalité ;
2. **La preuve** — la commande qui établit que c'est fait, **et ce qui la rend probante**. Exemple
   réel : `docker logout ghcr.io` **avant** le `docker pull`, sans quoi on teste son propre accès
   et pas celui d'un inconnu (c'est le faux-positif que l'étape 0 de CC-143 existe pour fermer) ;
3. **Ce qu'on attend en retour** — la sortie à coller, ou « fait » quand rien n'est vérifiable de
   ce côté (une rotation de mot de passe, par exemple : la vérifier coûterait plus cher que la
   refaire, et c'est précisément l'arbitrage retenu).

S'il manque une information pour écrire la procédure, **poser la question et continuer le reste du
travail** — ne pas s'arrêter, ne pas la remettre à un message suivant.

**Les gestes récurrents, et ce que la question doit dire :**

| Geste | Ce qu'on attend | Ce que la question doit annoncer |
|---|---|---|
| **Merge** | Un « oui » explicite, jamais déduit d'un accord antérieur | La commande exacte (`gh pr merge --merge`) et ce qui suit |
| **Tag / publication** | Un « oui » **séparé** de celui du merge | Ce que le tag déclenche, et ce qui restera à faire après |
| **Passage en `Done`** | Un « oui », posé **après** le merge | Que l'état sera relu après l'update (`updatedFields` ne prouve rien) |
| **Un clic hors de portée** | La sortie de la commande de preuve, ou « fait » | La procédure complète, points 1 à 3 ci-dessus |
| **Un passage navigateur** | La liste des écrans **et** de ce qu'il faut y voir | Voir plus bas : ce poste n'a aucun outil de pilotage |

⚠️ **L'attente d'un run long ne demande AUCUN geste de lui.** Si le propriétaire doit demander
« alors, c'est vert ? », c'est la méthode de notification qui a échoué, pas son rôle. Utiliser une
commande de fond qui **se termine** quand la condition est vraie (boucle `until` sur `gh run view`
/ `gh pr checks`) plutôt qu'un observateur qui scrute en continu — mesuré sur ce poste au
2026-08-05 : la seconde forme n'a jamais notifié, la première l'a fait à chaque fois.

⚠️ **Aucun outil de pilotage de navigateur n'existe sur ce poste** (ni Playwright, ni chromium-cli,
ni Chrome/Edge en PATH). Tout ce qui se vérifie à l'écran — apparence, CSP, lecture d'un QR par un
téléphone, un bouton réellement cliqué — est **son** geste, et ne s'écrit jamais comme fait. Voir
la note sur `npm run build` plus haut : c'est la même frontière, entre ce qu'un exécuteur prouve
et ce que seul un œil constate.

### Le suivi et la doc durable

Le backlog **et** la base de connaissance vivent dans le projet **CC** de `devben5.youtrack.cloud` —
articles `CC-A-1` (sommaire) à `CC-A-13`, accès par le serveur MCP officiel. Avec les `CLAUDE.md` du
dépôt, c'est **toute** la doc durable : une mémoire de conversation n'est jamais le seul porteur
d'une information qui doit lui survivre.

⚠️ **Le dépôt fait autorité contre la KB.** Elle est une synthèse navigable, tenue à jour après
chaque merge — quand elle diverge du code, c'est elle qu'il faut corriger, pas le code.

Commits : Conventional Commits en anglais, atomiques, footer **`CC-XX` nu** — jamais
`Refs: #CC-XX`, c'est explicitement proscrit.
