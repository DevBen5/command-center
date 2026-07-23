# Command Center

Tableau de bord auto-hébergé. AdonisJS 6 (ESM, TS strict) + Inertia 2 + Vue 3 + Tailwind v4 + PostgreSQL (Lucid).

Commandes : `npm run dev` · `npm test` · `npm run typecheck` · `npm run lint`

## Les données : où elles vivent, comment on les sauve

Le contenu réel est saisi à la main, sans seeder : **la base est la seule copie**. D'où deux
protections, qui ne se remplacent pas.

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
son contenu et n'ajoute que ce qui manque — voir `app/modules/leitner/CLAUDE.md`.

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
en place (`updateOrCreate`) : c'est l'outil de rotation, et le seul.

⚠️ **La variable ne sert qu'au seed — retire la ligne ensuite.** Rien d'autre ne la lit ; la garder
laisse un secret en clair sur la machine sans rien apporter.

## Architecture — feature-based

Chaque feature est une tranche verticale complète. Les dossiers AdonisJS par défaut
(`app/models/`, `app/controllers/`, `database/migrations/`, `inertia/pages/`) **n'existent plus**.

```
app/core/     auth · dashboard · i18n · shared      → import via #core/*
app/modules/  services · agents · veille · leitner  → import via #modules/*
  └── controllers/ models/ migrations/ seeders/ services/ validators/ pages/
providers/    leitner_provider                      → import via #providers/*
```

- **Les alias de `package.json` décrivent exactement l'arborescence réelle** : `#core/*`,
  `#modules/*`, `#providers/*`, plus `#tests/*`, `#start/*`, `#config/*`. Les douze alias hérités du
  scaffold (`#models/*`, `#controllers/*`, `#services/*`, `#middleware/*`, `#validators/*`,
  `#database/*`…) pointaient vers des dossiers supprimés et ont été **retirés** : un import
  `#models/foo` échoue désormais tout de suite, au lieu de *paraître* correct.
- **`providers/` est à la racine, et c'est le chemin qu'AdonisJS impose** — `adonisrc.ts` y déclare
  `#providers/leitner_provider`, qui balaie au démarrage les ingestions interrompues. Ce n'est pas
  une entorse au découpage par feature : un provider est chargé par le framework au boot, avant
  toute notion de module. La règle « une feature est une tranche verticale » reste vraie pour tout
  le reste ; ce dossier-là est la seule exception, et elle est structurelle. Le module Leitner le
  documente comme le 5ᵉ fichier vivant hors de son dossier.
- **N'utilise pas `node ace make:*` tel quel** : ces commandes génèrent aux chemins par défaut et
  recréent l'ancienne arborescence. Crée les fichiers directement dans le module.

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

⚠️ **Ne fige jamais un bug connu dans un test.** La palette ⌘K est inerte (CC-26) et annonce des
raccourcis qu'elle n'implémente pas (CC-27) : `app_layout.spec.ts` ne teste ni l'un ni l'autre, et
dit pourquoi en tête de fichier. Un test qui asserterait le comportement actuel rendrait le bug
incorrigible sans rougir.

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
   qui n'a rien demandé. Le registre en tire deux choses : les entrées de la barre latérale, et
   **la page d'atterrissage** après connexion, après acceptation d'invitation, et quand un compte
   connecté rouvre `/login`. Les trois redirigeaient vers `/` en dur, qui exige `dashboard.view` :
   un collègue sans cette capacité recevait un JSON d'erreur comme tout premier écran.

   ⚠️ **L'ordre de `start/navigation.ts` est l'ordre de la barre ET la page d'accueil des comptes.**
   Déplacer une ligne change l'écran d'arrivée ; c'est le seul endroit où ça se décide.

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

### Habitudes de travail Youtrack

Si on travailles avec ou que un skill fais appel a Youtrack :
- Les noms de sessions doivent correspondre au nom du ticket qui est travaillé (ex : `Ticket CC-42 - $Nom du ticket`)
- Il faut également une session par Epic, si on créer une session pour gérer une Epic le nom sera (ex : `Epic CC-42 - $Nom de l'epic`)
