# Command Center

Tableau de bord auto-hébergé. AdonisJS 6 (ESM, TS strict) + Inertia 2 + Vue 3 + Tailwind v4 + PostgreSQL (Lucid).

Commandes : `npm run dev` · `npm test` · `npm run typecheck` · `npm run lint`

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
  preuve qu'un dump se recharge reste de le recharger ; **ce point est encore ouvert** (CC-69).
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

## Le premier compte — `ADMIN_PASSWORD`, et rien d'autre

`node ace db:seed` sur une base neuve ne crée **aucun compte** tant que `ADMIN_PASSWORD` n'est pas
renseignée dans `.env` (12 caractères minimum, la même exigence que le formulaire d'invitation).
Renseignée, le seed crée le compte propriétaire avec ce mot de passe ; le seeder le dit à l'écran
dans les deux cas.

C'est le seul chemin vers un premier compte : l'écran d'administration exige déjà d'être
administrateur, et aucune page ne fabrique de compte pour un visiteur. Un seed sans la variable
n'ouvre donc rien, et c'est le but (CC-75) — le seeder posait auparavant un mot de passe écrit en
clair dans le code, donc publié avec lui.

⚠️ **Changer ce fichier ne désarme pas une base déjà seedée.** Une base créée avant CC-75 porte
encore l'ancien mot de passe du dépôt, et c'est cette base-là qu'un `npm run db:restore` emporterait
sur une machine exposée. Reposer `ADMIN_PASSWORD` et relancer `db:seed` **écrase** le mot de passe
en place (`updateOrCreate`) : c'est l'outil de rotation du **compte propriétaire**, dont l'adresse
est écrite dans le seeder. Depuis CC-129, `node ace auth:reset-account` en fait autant sur
n'importe quel compte, sans poser de secret dans un fichier — voir ci-dessous.

⚠️ **La variable ne sert qu'au seed — retire la ligne ensuite.** Rien d'autre ne la lit ; la garder
laisse un secret en clair sur la machine sans rien apporter.

**Une rotation par `db:seed` ne touche aucun contenu, et ça se maintient** (CC-106). Tout seeder
enregistré dans `config/database.ts` s'exécute à chaque passage — donc à chaque rotation faite par
ce chemin-là : celui de veille replantait ainsi 7 faux articles dans la veille réelle, comptés dans les
indicateurs de l'écran. Le fichier ne déclare donc plus que ce qu'aucun écran ne permet de saisir ;
`tests/unit/db_seeders.spec.ts` asserte cette liste. ⚠️ Il asserte la liste **déclarée**, pas
l'effet : aucun runner n'exécute `db:seed` de bout en bout, un seeder qui écrirait du contenu depuis
un path légitime passerait au vert.

### Reprendre la main sur un compte — `node ace auth:reset-account <email>` (CC-129)

```bash
node ace auth:reset-account quelquun@exemple.fr
```

Elle repose un mot de passe **et** désarme le second facteur — secret, codes de secours, anti-rejeu.
C'est le filet sous CC-114, dont la sortie ultime (« un **autre** administrateur ») n'existe pas sur
une installation à un seul compte : téléphone et codes perdus voulaient dire base inaccessible, avec
l'unique exemplaire des cartes dedans.

⚠️ **Elle ne crée aucun compte, et le titre de cette section reste donc vrai** : `ADMIN_PASSWORD`
est toujours le seul chemin vers un *premier* compte. Celle-ci répare un compte qui existe.

⚠️ **La règle de longueur d'un mot de passe est désormais écrite à TROIS endroits, et rien ne les
lie.** `acceptInvitationValidator` (`validators/admin.ts`) est la source — c'est elle que voit
l'utilisateur ; `user_seeder.ts` en recopie le **minimum** ; `commands/reset_account.ts` en recopie
le minimum **et** le maximum. Les trois ne sont donc déjà pas identiques, et **aucun test ne
rougirait** si le validateur passait à 14 caractères : les deux copies continueraient d'accepter ce
que le formulaire refuse, c'est-à-dire de poser en base des mots de passe que l'application juge
trop faibles. Une seule constante partagée serait mieux ; en attendant, **changer la règle veut dire
changer les trois fichiers dans le même lot** — le relevé est du 2026-08-02, vérifie-le avant de t'y
fier.

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

⚠️ **Elle ne ferme aucune session déjà ouverte** — le store est `cookie`, il n'existe aucune liste
côté serveur. Un cookie volé reste valable jusqu'à la borne des 7 jours (CC-78), reset ou pas.

## Architecture — feature-based

Chaque feature est une tranche verticale complète. Les dossiers AdonisJS par défaut
(`app/models/`, `app/controllers/`, `database/migrations/`, `inertia/pages/`) **n'existent plus**.

```
app/core/     auth · dashboard · i18n · settings · shared   → import via #core/*
app/modules/  services · agents · veille · leitner  → import via #modules/*
  └── controllers/ models/ migrations/ seeders/ services/ validators/ pages/
providers/    leitner_provider · veille_provider    → import via #providers/*
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

## Six choses qui cassent sans lever d'erreur

1. **Nouveau module → l'enregistrer dans `config/database.ts`**, dans `migrations.paths` *et*
   `seeders.paths`. Rien n'est auto-découvert : un path oublié = migration jamais jouée, en silence.
   L'ordre des tableaux est l'ordre d'exécution (contraintes FK).

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

   ⚠️ **Un refus se lève, il ne se retourne pas.** `throw new ForbiddenException(…)`, jamais
   `response.forbidden({…})` : `statusPages` n'est consulté que par le gestionnaire d'**exceptions**,
   donc une réponse écrite à la main court-circuite la page 403 et rend du JSON brut au navigateur.
   Rien ne le signale — un 403 reste un 403.

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
- **`whereRaw` toujours paramétré** (bindings `?`), jamais concaténé.
- Toute entrée utilisateur passe par un validateur VineJS. CSRF actif (Shield) : les POST de test
  exigent `.withCsrfToken()`.
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
- **`/review-mr`** — self-review d'une de mes PR avant merge. Après un merge, il relit la KB
  YouTrack **en entier** depuis le sommaire `CC-A-1` et corrige ce qui a cessé d'être vrai.

⚠️ **Ces trois noms existent AUSSI en global**, dans une version qui vise l'autre workspace (GitLab,
NestJS, `develop`, pnpm, `Refs: #SAAS-XX`). **Le skill du dépôt ne masque pas le global** — le
harness peut charger l'un ou l'autre, constaté deux fois dans une seule session. Après tout
`/lead-review`, `/git-commit` ou `/review-mr` : vérifier **laquelle a été chargée** (le « Base
directory » l'indique) et le dire si c'est la mauvaise.

### Le dépôt est solo — il n'y a personne à qui assigner

**Le compte GitHub `@DevBen5` est la seule référence.** Le dépôt est `DevBen5/command-center`, tout
part de **`master`** et y retourne : il n'y a **ni `develop`, ni lead dev, ni personne d'autre** à
mentionner ou à assigner. Une PR n'est assignée à personne ; c'est **le propriétaire** qui la merge
(`gh pr merge --merge`, jamais `--squash`, branche conservée), et toi jamais sans **go explicite**
(cf. skill `/git-commit`).

### Le suivi et la doc durable

Le backlog **et** la base de connaissance vivent dans le projet **CC** de `devben5.youtrack.cloud` —
articles `CC-A-1` (sommaire) à `CC-A-13`, accès par le serveur MCP officiel. Avec les `CLAUDE.md` du
dépôt, c'est **toute** la doc durable : une mémoire de conversation n'est jamais le seul porteur
d'une information qui doit lui survivre.

⚠️ **Le dépôt fait autorité contre la KB.** Elle est une synthèse navigable, tenue à jour après
chaque merge — quand elle diverge du code, c'est elle qu'il faut corriger, pas le code.

Commits : Conventional Commits en anglais, atomiques, footer **`CC-XX` nu** — jamais
`Refs: #CC-XX`, c'est explicitement proscrit.
