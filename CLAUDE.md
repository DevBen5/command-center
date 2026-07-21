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

## Quatre choses qui cassent sans lever d'erreur

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

## Sécurité — ne pas régresser

- **`agent.config.command` est une commande shell exécutée telle quelle** (`AgentRunnerService`).
  C'est assumé (modèle « cron »), sur la seule garantie que **ce champ n'est écrivable par aucun
  formulaire**. Ne l'expose jamais dans une UI d'édition : ce serait une RCE.
- **Docker : `execFile` + whitelist regex sur le nom de conteneur** (`SystemStatsService`).
  Jamais `exec()` avec interpolation de chaîne.
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
