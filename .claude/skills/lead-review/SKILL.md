---
name: lead-review
description: |
  Review pre-commit d'un lead dev, avec le contexte complet du projet Command Center.
  À invoquer avant de stager, quand le diff a de la substance.
  Relit le diff stagé (ou non stagé si rien n'est stagé) contre la task YouTrack (projet CC),
  le CLAUDE.md racine et celui du module touché.
  Ne vérifie PAS que le style — vérifie que l'implémentation fait ce qui était demandé.
  Bloque si quelque chose cloche. À lancer AVANT /git-commit sur tout changement non trivial.
---

# Lead-Dev Review — Command Center

Tu joues le rôle d'un lead développeur senior qui relit du code qu'il n'a pas écrit.
Tu n'as aucune complaisance envers l'auteur. Ton objectif est de trouver les problèmes
avant qu'ils n'atteignent `master`.

> **Ce skill est la version projet.** Il prend le pas sur le `lead-review` global, qui vise
> l'autre workspace (monorepo NestJS, `shared-types`, NATS, GitLab). Ici : mono-dépôt AdonisJS 6
> + Inertia + Vue 3 + PostgreSQL, branche principale `master`, GitHub, npm.

---

## 1. Récupérer le diff à relire

```bash
git diff --staged          # stagé en priorité
git diff                   # sinon, non stagé
git status --short          # fichiers non suivis : un module neuf n'apparaît pas dans le diff
git branch --show-current
```

⚠️ **`git diff` ne montre pas les fichiers non suivis.** Un nouveau service, un nouveau test ou
un dossier entier peuvent être le cœur du changement et rester invisibles. Toujours croiser avec
`git status --short`, et lire les fichiers `??` avec Read.

Si tout est vide, signale-le et arrête.

---

## 2. Charger le contexte de la task YouTrack

Le backlog vit dans `devben5.youtrack.cloud`, **projet CC**, via le MCP officiel. Les fichiers
`TICKET-*.md` du dépôt sont des archives déjà livrées : ne les prends pas pour la spec courante.

L'ID vient de l'argument (`/lead-review CC-57`) ou du nom de branche. **Les branches ici ne portent
pas toujours l'ID** (`refactor/feature-modules`) — si tu ne le déduis pas, demande-le, ne devine pas.

Récupérer via `mcp__youtrack__get_issue` : description complète **et** commentaires
(`recentCommentsCount` suffisamment haut). Lire :

- **Ce qui était demandé** — description, critères de succès, section « hors périmètre »
- **Ce qui a été décidé en route** — les commentaires portent les arbitrages, les amendements de
  plan et les écarts assumés ; un écart tracé en commentaire n'est pas une dérive
- ⚠️ **États en anglais à l'écriture, en français à la lecture** (`To Verify` ⇄ `À vérifier`)

Il n'y a pas de base de connaissances séparée sur ce projet : la doc vit dans les `CLAUDE.md`.

---

## 3. Charger le contexte du dépôt

Le `CLAUDE.md` racine est déjà en contexte. **Lis en plus le `CLAUDE.md` du ou des modules touchés**
(`app/modules/<module>/CLAUDE.md`, `app/core/<domaine>/CLAUDE.md`) : ils portent les invariants
précis, les pièges et la liste des tests qui tiennent chaque module. C'est là que se trouve la
plupart de ce contre quoi tu relis.

⚠️ **La doc peut mentir.** Elle décrit parfois un comportement que le code ne fait plus. Tout claim
sur lequel s'appuie un verdict se vérifie contre le code, en citant `fichier:ligne`.

Aucun sous-skill à déléguer : les checks ci-dessous sont à faire ici.

---

## 4. Grille de review

### Conformité à la spec
- [ ] L'implémentation couvre ce que la task décrivait — ni plus, ni moins
- [ ] Les décisions prises en commentaires YouTrack sont respectées
- [ ] Tout élargissement de périmètre est **tracé** (commentaire sur la task), pas glissé
- [ ] Aucune exigence partiellement implémentée sans justification

### Architecture feature-based
- [ ] Rien de créé dans les dossiers AdonisJS par défaut — `app/models/`, `app/controllers/`,
      `database/migrations/`, `inertia/pages/` **n'existent plus**
- [ ] Les imports n'utilisent que les alias réels : `#core/*`, `#modules/*`, `#providers/*`,
      `#tests/*`, `#start/*`, `#config/*`. Les douze alias du scaffold ont été retirés
- [ ] Contrôleurs fins : la logique est dans les `services/` du module
- [ ] Pas de `node ace make:*` (il recrée l'ancienne arborescence)

### Les trois pannes silencieuses du projet
- [ ] **Nouveau module ou nouvelle migration → enregistré dans `config/database.ts`**, dans
      `migrations.paths` *et* `seeders.paths`. Rien n'est auto-découvert : un path oublié = migration
      jamais jouée, **en silence**. L'ordre des tableaux est l'ordre d'exécution (contraintes FK)
- [ ] **Nom de page Inertia ⇄ chemin du fichier** — `inertia.render('modules/veille/index')` ⇄
      `app/modules/veille/pages/index.vue` (résolu à la main dans `inertia/app/app.ts`). Un écart
      échoue **au runtime**, pas au build
- [ ] **Couleurs : uniquement les tokens `@theme`** de `inertia/css/app.css` (`bg`, `panel`,
      `panel-2`, `line`, `txt`/`txt-2`/`txt-3`, `accent`, `aqua`, `ok`/`bad`/`warn`). Aucune couleur
      en dur, tout le style utility-first dans les `.vue`

### Sécurité — ne pas régresser
- [ ] **`agent.config.command` n'est exposé dans aucune UI d'édition** — c'est une commande shell
      exécutée telle quelle ; l'exposer serait une RCE
- [ ] **Docker : `execFile` + whitelist regex** sur le nom de conteneur. Jamais `exec()` avec
      interpolation de chaîne
- [ ] **`whereRaw` toujours paramétré** (bindings `?`), jamais concaténé
- [ ] Toute entrée utilisateur passe par un **validateur VineJS** ; les POST de test exigent
      `.withCsrfToken()` (Shield actif)
- [ ] **Gardes SSRF intactes** — `isPublicFeedUrl` (veille, refuse le local) et `isLocalLlmUrl`
      (Leitner, n'accepte que le local) sont des miroirs inverses : ne pas en assouplir une « par
      symétrie ». `assertReachableTarget` reste `protected` et n'est jamais relâché en production
- [ ] Un script/appel réseau ajouté ne contourne pas le point de sortie unique de son module
      (ex. `rss-parser.parseURL` est interdit — seul `parseString`, sur du XML déjà rapatrié par
      `feed_fetcher`)

### Données
- [ ] Aucune migration destructive sans le dire : **la base est la seule copie** du contenu, saisi
      à la main, sans seeder
- [ ] Une liste de valeurs dupliquée bouge partout à la fois (ex. les types `veille_items` vivent
      dans le modèle, la contrainte CHECK et le validateur — **les trois ensemble**)
- [ ] Les colonnes générées (`search_vector`) ne sont ni écrites par l'app ni ajoutées au modèle ;
      les recréer sans leur index GIN est une panne silencieuse (`seq scan`)

### Gates
- [ ] `npm test` vert, `npm run typecheck` et `npm run lint` propres
- [ ] ⚠️ **Si le diff touche un `.vue` : `npm run build` aussi.** `tsc` ne lit pas les `.vue` et il
      n'y a pas de `vue-tsc` dans ce dépôt — une résolution d'import cassée ou une prop mal câblée
      ne se voit qu'au build ou à l'écran. `typecheck` vert ne prouve **rien** sur une page
- [ ] Le diff est atomique — un seul axe de changement
- [ ] Pas de `console.log`, TODO/FIXME, `.only(` ou fichier de debug oublié (`git status --short`)

### Ce qu'il ne faut PAS « corriger »
- [ ] Les `catch {}` de `SystemStatsService` et `AgentRunnerService` avalent l'échec Docker/script
      et simulent le succès en base : **c'est volontaire** (poste de dev sans conteneurs réels)
- [ ] `@swc/core` reste en range `^1.15.43` — le pin exact hérité du scaffold fait sortir `npm test`
      en code 1 alors qu'il affiche `PASSED`
- [ ] Les ports Docker restent liés à `127.0.0.1`, jamais `0.0.0.0`
- [ ] Adminer reste derrière le profil `tools`
- [ ] `pgdata` reste un bind mount, pas un volume nommé

### Tests
- [ ] Un mode d'échec **silencieux** corrigé a un test qui tombe s'il revient — c'est le seul moyen
      de prouver qu'une garde n'est pas devenue inerte
- [ ] Aucun test ne touche le réseau (hors exceptions déjà documentées dans le `CLAUDE.md` du module)
- [ ] Les serveurs jetables sont fermés en teardown (`forceExit: false` fige `npm test` sinon)
- [ ] Ce qui n'est **pas** couvert est nommé, avec son risque résiduel — pas passé sous silence

### Jugement professionnel
- [ ] Toute erreur d'architecture, de stratégie ou mauvaise pratique non listée ci-dessus. Si
      quelque chose te choque en tant que lead dev, dis-le.

---

## 5. Vérifier avant d'affirmer

Un soupçon n'est pas un constat. Avant de le porter au rapport :

- **Lis le code** à l'endroit exact, et cite `fichier:ligne`
- **Teste-le** quand c'est possible — une probe jetable de dix lignes tranche mieux qu'un
  raisonnement sur le comportement d'une lib. Range les fichiers temporaires dans le scratchpad
  et supprime-les
- **Rapporte aussi les soupçons levés**, avec ce qui les a levés : ça vaut autant que les
  problèmes trouvés, et ça évite qu'ils soient re-soulevés à la review suivante

Un bloquant faux coûte plus cher qu'un bloquant manqué : il fait perdre la confiance dans la review.

---

## 6. Format du rapport

```
## Review — CC-XX · <scope principal>

### Spec
<Résumé en 1-2 phrases de ce qui était attendu — pour ancrer la review.>

### 🔴 Bloquants
<Problèmes à corriger avant de committer. Fichier:ligne, pourquoi, et ce qui casse.>

### 🟡 À discuter
<Points corrects mais discutables, optimisables, ou qui méritent une décision consciente.>

### 🟢 OK
<Ce qui est bien fait — une ligne suffit, pas de liste exhaustive.>

### Verdict
PRÊT À COMMITTER / À CORRIGER AVANT COMMIT / DÉCISION REQUISE
```

Règles du rapport :
- Si tout est OK : une phrase, pas une liste de félicitations.
- Si quelque chose est bloquant : sois direct. Pas de « peut-être », pas de « on pourrait ».
- Distingue ce qui « fonctionne » de ce qui est « optimal » — les deux peuvent coexister.
- Si un point de la grille est hors scope du diff : `N/A`, pas « semble OK ».
- Terminer par la question ouverte : corriger les 🟡 maintenant, ou enchaîner sur `/git-commit`.
