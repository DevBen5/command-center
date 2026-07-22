---
name: review-mr
description: |
  Review complète d'une Pull Request GitHub du projet Command Center (AdonisJS 6 + Inertia
  + Vue 3 + PostgreSQL, base `master`, tickets `CC-XX`, CLI `gh`).
  Couvre : hygiène de la PR, workflow Git, architecture feature-based, qualité, conformité
  à la task YouTrack, politique de documentation.
  Enrichit le contexte via la task YouTrack (projet CC) et les `CLAUDE.md` des modules touchés.
  Produit un rapport soumis à validation AVANT tout post sur la PR.
  Trigger : `/review-mr <numéro>` ou `/review-mr` seul (review la PR de la branche courante).
---

# /review-mr — Review de Pull Request, Command Center

> **Ce skill est la version projet.** Il prend le pas sur le `review-mr` global, écrit pour
> **GitLab** : références `<project_path>!<iid>`, MCP GitLab, specs `control/specs/`, articles
> de KB, notification Discord, arbitrages NATS.
>
> ⚠️ **Les deux portent le même nom et restent tous les deux visibles.** Si tu lis une procédure
> qui parle de `browse_merge_requests`, de `control/specs/`, de `develop` ou d'un webhook
> Discord, tu as ouvert la mauvaise : arrête et charge celle-ci. Ici c'est **GitHub via `gh`**,
> base **`master`**, doc dans les **`CLAUDE.md`**, et **pas de Discord**.

---

## Invocation

```
/review-mr 12        # PR n° 12
/review-mr           # la PR de la branche courante
```

Si aucune PR ne correspond, le dire et s'arrêter — ne pas reviewer le diff local à la place
(c'est le rôle de `/lead-review`).

⚠️ **Aucune PR n'a encore été ouverte sur ce dépôt à ce jour.** Les commandes ci-dessous sont
vérifiées au niveau des flags et des champs JSON, mais la séquence n'a jamais été jouée de bout
en bout. Si une commande se comporte autrement qu'annoncé, le signaler plutôt que d'improviser
en silence.

---

## Étape 1 — Récupérer la PR

```bash
gh pr view <n> --json number,title,body,author,headRefName,baseRefName,state,isDraft,mergeable,files,additions,deletions,labels
gh pr diff <n>
gh pr view <n> --json commits
gh pr view <n> --json comments,reviews    # ne pas redoubler un commentaire déjà posté
```

Le dépôt n'a **pas de CI** (aucun `.github/workflows`). Il n'y a donc pas de pipeline à
inspecter : ne pas inventer ce critère. S'il apparaît un jour, `gh pr checks <n>` le lira.

---

## Étape 2 — Contexte YouTrack

### Extraire les identifiants

Chercher tout `CC-\d+` dans :
- le nom de la branche source (`feat/CC-42-...`),
- le titre et le corps de la PR,
- le **footer de chaque commit** — c'est là qu'il est ici, **nu** (`CC-42`), pas `Refs: #CC-42`.

Dédupliquer.

Si aucun identifiant nulle part : le signaler en Axe 2 (Git workflow). Le footer est obligatoire
sur ce projet.

### Lire chaque task

`mcp__youtrack__get_issue` avec un `recentCommentsCount` suffisamment haut. Retenir :
- **Ce qui était demandé** — description, critères, périmètre exclu ;
- **Ce qui a été décidé en route** — les commentaires portent les arbitrages et les écarts
  assumés ; un écart tracé en commentaire n'est **pas** une dérive ;
- le statut et le type.

⚠️ **États en anglais à l'écriture, en français à la lecture** (`To Verify` ⇄ `À vérifier`).

⚠️ Il n'y a **pas de base de connaissances** sur ce projet — ne pas appeler `search_articles`.
La documentation vit dans les `CLAUDE.md` : celui de la racine, et surtout **celui de chaque
module touché** (`app/modules/<module>/CLAUDE.md`), qui porte les invariants précis et les
pièges. Les fichiers `TICKET-*.md` du dépôt sont des archives déjà livrées, pas la spec courante.

### Synthétiser

Avant l'analyse, résumer en deux ou trois phrases ce que les tasks demandaient et si la PR
couvre bien ce périmètre — ni moins, ni davantage.

---

## Étape 3 — Analyser sur 6 axes

> Le contexte YouTrack alimente l'analyse : vérifier que l'implémentation correspond à ce qui
> était demandé, pas seulement qu'elle est propre.

### Axe 1 — Hygiène de la PR

| Critère | Attendu |
|---|---|
| Titre | Descriptif, pas « fix », pas « WIP » |
| Corps | Contexte, ce qui change, pourquoi |
| Branche source | `<type>/<slug>` ou `<type>/CC-XX-<slug>` — l'ID y est *recommandé*, pas requis |
| Branche cible | **`master`** |
| Mergeable | Pas de conflit |
| Draft | Non, sauf partiel assumé |

### Axe 2 — Workflow Git

- **Conventional Commits** en anglais : `<type>(<scope>): <sujet>`
- **Footer `CC-XX` nu** sur chaque commit — `Refs: #CC-XX` est une régression vers la convention
  de l'autre workspace
- **Corps de commit** : prose expliquant le pourquoi et le mode d'échec évité, pas trois bullets.
  Un commit non trivial sans corps est un point à lever
- **Atomicité** : un axe de changement par commit (outillage / code+tests / docs)
- ❌ **`Co-Authored-By` d'un assistant IA** — interdit, à signaler comme bloquant

### Axe 3 — Architecture feature-based

- **Rien dans les dossiers AdonisJS par défaut** : `app/models/`, `app/controllers/`,
  `database/migrations/`, `inertia/pages/` **n'existent plus**. Un fichier qui y réapparaît vient
  d'un `node ace make:*` lancé tel quel — bloquant
- **Alias réels uniquement** : `#core/*`, `#modules/*`, `#providers/*`, `#tests/*`, `#start/*`,
  `#config/*`. Les douze alias du scaffold ont été retirés
- **Contrôleurs fins** : la logique vit dans les `services/` du module
- **`providers/` à la racine** est la seule exception structurelle au découpage par feature

### Axe 4 — Les trois pannes silencieuses

Aucune ne lève d'erreur. Ce sont les premières à vérifier.

- **Nouveau module ou nouvelle migration → déclaré dans `config/database.ts`**, dans
  `migrations.paths` *et* `seeders.paths`. Rien n'est auto-découvert : un chemin oublié =
  migration jamais jouée, **en silence**. L'ordre des tableaux est l'ordre d'exécution (FK)
- **Nom de page Inertia ⇄ chemin du fichier** : `inertia.render('modules/veille/index')` ⇄
  `app/modules/veille/pages/index.vue`, résolu à la main dans `inertia/app/app.ts`. Un écart
  échoue **au runtime**, pas au build
- **Couleurs : uniquement les tokens `@theme`**, aucune couleur en dur. ⚠️ **La liste fait
  autorité dans `inertia/css/app.css`, pas dans une doc** — l'énumération de `CLAUDE.md` (`bg`,
  `panel`, `panel-2`, `line`, `txt`/`txt-2`/`txt-3`, `accent`, `aqua`, `ok`/`bad`/`warn`) est
  **incomplète** : `accent-soft`, `bg-2`, `line-2`, `raise` et `side` existent aussi. Lire le
  fichier (`grep -oE '\-\-color-[a-z0-9-]+' inertia/css/app.css`) avant de signaler un token
  comme invalide, sinon on produit un faux bloquant sur une couleur parfaitement légitime

### Axe 5 — Sécurité et qualité

**Sécurité — toute régression ici est bloquante :**
- **`agent.config.command` n'apparaît dans aucune UI d'édition** — c'est une commande shell
  exécutée telle quelle ; l'exposer serait une RCE
- **Docker : `execFile` + whitelist regex** sur le nom de conteneur, jamais `exec()` avec
  interpolation
- **`whereRaw` paramétré** (bindings `?`), jamais concaténé
- **Validateur VineJS** sur toute entrée utilisateur ; les POST de test exigent `.withCsrfToken()`
- **Gardes SSRF miroirs** : `isPublicFeedUrl` (veille, refuse le local) et `isLocalLlmUrl`
  (Leitner, n'accepte que le local) sont des inverses — ne pas en assouplir une « par symétrie ».
  `assertReachableTarget` reste `protected`
- Un appel réseau ajouté ne contourne pas le point de sortie unique de son module

**Qualité :**
- TypeScript strict : pas d'`any` ni de `as unknown as X` non justifiés
- **Commentaires en français** sur ce projet (l'anglais est la règle de l'autre workspace — ne
  pas la transposer ici)
- Tests : un mode d'échec silencieux corrigé doit avoir un test qui **retombe s'il revient**
- Pas de `console.log`, `TODO`/`FIXME`, `.only(` ou fichier de debug oublié
- Données : la base est **la seule copie** du contenu, saisi à la main sans seeder — toute
  migration destructive doit être annoncée

**Ce qu'il ne faut PAS demander de « corriger » :**
- Les `catch {}` de `SystemStatsService` et `AgentRunnerService` — volontaires (poste de dev sans
  conteneurs réels)
- `@swc/core` en range `^1.15.43` — le pin exact fait sortir `npm test` en code 1
- Les ports Docker liés à `127.0.0.1`, jamais `0.0.0.0`
- Adminer derrière le profil `tools`
- `pgdata` en bind mount

### Axe 6 — Documentation

- `CLAUDE.md` racine et par module : encouragés, c'est **là** que vit la doc de ce projet
- `README.md` à la racine : autorisé
- Les `TICKET-*.md` existants sont des archives — ne pas en créer de nouveaux
- Un changement non trivial qui laisse le `CLAUDE.md` du module muet sur un nouveau piège est un
  point à lever

---

## Étape 4 — Vérifier avant d'affirmer

Un soupçon n'est pas un constat. Avant de le porter au rapport :

- **Lire le code** à l'endroit exact et citer `fichier:ligne`
- **Le tester** quand c'est possible : une probe jetable de dix lignes tranche mieux qu'un
  raisonnement sur le comportement d'une lib. Ranger les fichiers temporaires dans le scratchpad
  et les supprimer
- ⚠️ **La doc peut mentir** — elle décrit parfois un comportement que le code ne fait plus. Tout
  claim tiré d'un `CLAUDE.md` sur lequel repose un verdict se revérifie contre le code
- **Rapporter aussi les soupçons levés**, avec ce qui les a levés

Un bloquant faux coûte plus cher qu'un bloquant manqué : il fait perdre confiance dans la review.

---

## Étape 5 — Rapport

```markdown
## Review PR #<n> — <titre>
Branche : `<source>` → `<target>` | <N> fichiers | Tasks : CC-XX

### Contexte
<Ce que les tasks demandaient, en 2-3 phrases.>

### Verdict : <emoji> <label>

### 🔴 Bloquants
**[TYPE] Titre**
Problème : <explication concise>
Fichier : `chemin/fichier.ts:42`
Suggestion : <action concrète>

### 🟡 Importants

### 🟢 Mineurs

### ✅ Points positifs
<Toujours présent.>

### Prochaines étapes
1. …
```

Verdicts : `✅ Approuvé` · `⚠️ Changements demandés` · `❌ Refusé`.

Règles :
- Un point hors périmètre du diff : `N/A`, pas « semble OK ».
- Ne pas être complaisant : un bloquant se dit clairement.
- Toujours inclure les points positifs — une review 100 % négative n'aide personne.
- Citer l'invariant ou la task derrière chaque critique.
- Suggérer, ne pas imposer, sur les mineurs et importants.
- Ne pas réécrire le code dans le commentaire : pointer le problème et la direction.

---

## Étape 6 — Action

Après le rapport, proposer :

```
Que faire ?
  [1] Poster le rapport en commentaire sur la PR
  [2] Poster + demander des changements
  [3] Poster + merger
  [4] Créer une task YouTrack pour un point architectural
  [5] Ne rien poster — review interne
```

```bash
gh pr comment <n> --body-file <fichier>              # [1]
gh pr review <n> --request-changes --body-file <f>   # [2]
gh pr merge <n> --squash                             # [3], après [1]
```

⚠️ **Pas de `gh pr review --approve` sur ce dépôt.** GitHub refuse d'approuver sa propre PR, et
le dépôt est solo : l'approbation échouerait à chaque fois. L'équivalent réel est **merger**,
d'où l'option [3]. *(Comportement documenté GitHub, non vérifié ici — aucune PR n'existe encore.)*

⚠️ **Ne jamais poster sans validation explicite.** Toujours soumettre le rapport d'abord.

⚠️ **Aucune mention d'outil IA** dans ce qui est posté : ni signature, ni `Co-Authored-By`, ni
« généré par ». Le commentaire doit se lire comme celui d'un relecteur humain.

Il n'y a **pas de notification Discord** sur ce projet (c'est une étape du skill global, liée à
une équipe et à un `discord.config.md` qui n'existe pas ici). Ne pas la reproduire.
