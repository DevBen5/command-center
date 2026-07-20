---
name: git-commit
description: |
  Commits et workflow Git du projet Command Center (AdonisJS 6 + Inertia + Vue 3, dépôt
  mono-repo, branche principale `master`, GitHub, npm, tickets `CC-XX`).
  À appliquer pour toute création, découpe, réécriture ou push de commit dans ce dépôt.
  Se déclenche aussi sur : ouverture de PR, amend, rebase, création de branche, staging,
  ou mention de « message de commit », « stratégie de commit », « nom de branche ».
  Conventional Commits en anglais, découpe atomique, footer `CC-XX` nu.
---

# Git Commit & Workflow — Command Center

> **Ce skill est la version projet.** Il prend le pas sur le `git-commit` global, qui vise
> l'autre workspace : monorepo NestJS, `shared-types`, GitLab, branche `develop`, `pnpm`,
> footer `Refs: #SAAS-XX`, MR assignée au lead.
>
> ⚠️ **Les deux portent le même nom et restent tous les deux visibles.** Si tu lis une grille
> qui parle de GitLab, de `develop`, de `pnpm` ou de `Refs: #SAAS-XX`, tu as ouvert la
> mauvaise : arrête et charge celle-ci. Ici c'est **GitHub, `master`, `npm`, footer `CC-XX`
> nu**, et il n'y a **personne à qui assigner** — le dépôt est solo.

---

## 0. Gate `/lead-review`

Avant tout, vérifier si `/lead-review` a déjà tourné sur les changements en cours dans cette
session.

**Comment l'évaluer :**
- Chercher dans l'historique de conversation une invocation de `/lead-review` ou un rapport
  (sections 🔴 / 🟡 / 🟢) couvrant le diff sur le point d'être commité.
- Lancer `git diff --staged` (ou `git diff` si rien n'est stagé) **et** `git status --short`
  pour jauger l'ampleur réelle — voir §1, les fichiers non suivis n'apparaissent pas au diff.

**Décision :**

| Situation | Action |
|---|---|
| `/lead-review` lancé, verdict PRÊT À COMMITTER | Continuer sans rien dire |
| `/lead-review` lancé, verdict À CORRIGER / DÉCISION REQUISE | Bloquer — rappeler que la review a laissé des points ouverts |
| Non lancé, diff trivial (docs seuls, config < 5 LOC, correction d'une ligne) | Continuer — mentionner brièvement que le changement est jugé trivial |
| Non lancé, diff non trivial | S'arrêter et afficher : |

```
⚠️  /lead-review n'a pas été lancé pour ces changements.

Diff détecté : <N fichiers, ~N lignes>

Options :
  [1] Lancer /lead-review maintenant (recommandé)
  [2] Continuer quand même — je sais ce que je fais
```

Attendre un choix explicite.

Il n'y a pas de second relecteur humain sur ce dépôt : `/lead-review` **est** le gate de revue,
pas une formalité en attendant quelqu'un.

---

## 1. Voir la totalité de ce qu'on commite

```bash
git diff --staged          # ce qui est stagé
git diff                   # sinon, non stagé
git status --short         # ⚠️ indispensable
git branch --show-current
```

⚠️ **`git diff` ne montre pas les fichiers non suivis.** Un service neuf, un test neuf, un
module entier peuvent être le cœur du changement et rester invisibles. Toujours croiser avec
`git status --short` et lire les `??` avant de décider de la découpe — sinon le commit part
amputé de sa propre substance, et le message décrit du code absent.

---

## 2. Langue

- Sujets, corps, noms de branche et titres de PR **en anglais**, sans exception.
- Le code, les commentaires et la documentation restent **en français** : c'est une question de
  contenu, pas d'historique Git.
- Raison : l'historique est un artefact technique durable, lu par des outils et d'éventuels
  contributeurs futurs.

---

## 3. Conventional Commits

Format : `<type>(<scope>): <sujet>`

```
<type>(<scope>): <sujet — impératif, sans point final, <= 72 caractères>

<corps — explique le POURQUOI et l'impact structurel>

<footer — BREAKING CHANGE:, puis CC-XX>
```

### Types autorisés

| Type | Quand |
|---|---|
| `feat` | Nouvelle fonctionnalité, nouvelle surface publique |
| `fix` | Correction de bug |
| `refactor` | Restructuration interne sans changement de comportement (ou cassante avec `!`) |
| `chore` | Outillage, dépendances, configs (tsconfig, eslint, docker, package.json sans code) |
| `docs` | Documentation seule (README, CLAUDE.md, SKILL.md, commentaires) |
| `test` | Tests seuls, non livrés avec la feature qu'ils couvrent |
| `build` | Chaîne de build |
| `ci` | Intégration continue — **rien ne l'utilise pour l'instant** (pas de `.github/` dans ce dépôt), conservé pour le jour où un workflow existera |
| `perf` | Performance |
| `style` | Formatage seul (Prettier/ESLint — éviter de le commiter seul) |

### Scopes

Un scope quand il désambiguïse. Court, un mot.

| Famille | Exemples |
|---|---|
| Module | `veille`, `leitner`, `agents`, `services` |
| Domaine `core` | `auth`, `dashboard`, `i18n`, `shared` |
| Couche | `db`, `ui`, `api` |
| Outillage | `tooling`, `docker` |

Omettre le scope quand il ne ferait que répéter le type.

### Changements cassants

`!` après le type/scope **et** footer `BREAKING CHANGE:` :

```
refactor(veille)!: rename the source cadence column

BREAKING CHANGE: fetch_interval_minutes becomes fetch_cadence. Any query
written against the old name stops working; the migration renames in place
and no compatibility view is provided.

CC-XX
```

Le `!` est obligatoire dès que la surface publique change de façon non additive : renommage,
suppression, champ requis ajouté, contrat resserré.

### Règles de sujet

- Impératif : `add`, `remove`, `fix`, `rename`, `record` — jamais `added`, `adding`.
- Minuscule initiale, pas de point final, 72 caractères maximum.

### Règles de corps — le style de ce dépôt

Le corps est requis dès qu'un changement dépasse quelques lignes, et il n'est **pas** une liste
de trois bullets. La convention établie sur ce dépôt est une **prose suivie qui explique le
piège** : pourquoi ce design plutôt qu'un autre, quel mode d'échec silencieux il évite, et ce
qu'un lecteur ultérieur risque de « corriger » de bonne foi.

Relire `git log` avant d'écrire : les commits `feat(veille)` et `docs(veille)` récents montrent
la mesure attendue.

Ce qu'un bon corps contient :
- **Pourquoi** le changement existe — le diff dit déjà le *quoi*.
- **Ce qui casserait sans bruit** si on le défaisait, nommé explicitement.
- Les **décisions laissées ouvertes par le ticket** et tranchées ici, avec leur raison.
- Ce que le test **prouve** — surtout quand il garde une régression silencieuse.

Ce qu'il ne contient pas : emoji, ton marketing, « this commit », ni « voir la description de
la PR ». Le corps se suffit à lui-même.

### Règles de footer

- **Footer nu : `CC-58`.** Pas `Refs: #CC-58`, pas `Closes:`. Juste l'identifiant, seul sur sa
  ligne, séparé du corps par une ligne vide. C'est la convention constante de l'historique.
- **Obligatoire** : chaque commit référence au moins un ticket YouTrack du projet CC. Si aucun
  ticket n'existe, en créer un avant de commiter.
- ❌ **Jamais de `Co-Authored-By` pour un assistant IA.** Le contributeur humain est l'unique
  auteur. Si un commit existant en porte un, le retirer.

---

## 4. Découpe atomique

Une branche est une histoire, un commit en est un chapitre — relisible, révocable, bissectable
seul.

Découper par **axe de changement**, pas par fichier :

1. `chore(tooling)` — configs et dépendances qu'exige le travail
2. `feat` / `fix` / `refactor` — le code, avec ses tests colocalisés
3. `docs` — `CLAUDE.md`, `README.md`, `SKILL.md`

Règles :
- L'outillage part seul, pour être relu sans bruit de code.
- Les tests qui couvrent le code livré partent **avec** ce code.
- Un test ajouté sur du code existant est un `test:`.
- La documentation qui décrit le nouveau code part dans son propre `docs:` — c'est le motif
  déjà suivi ici (`feat(veille)` puis `docs(veille)`).

### À refuser

- Commits « WIP », « fix typo », « address review » dans une branche — squasher avant push.
- Un commit unique mêlant outillage + code + docs pour un travail de plusieurs jours.
- Un corps qui renvoie à la PR au lieu de se suffire.

---

## 5. Branches

### Format

```
<type>/<description-kebab>
<type>/CC-XX-<description-kebab>   ← si la branche couvre un ticket identifiable
```

| Préfixe | Usage |
|---|---|
| `feat/` | Nouvelle fonctionnalité |
| `fix/` | Correction |
| `refactor/` | Restructuration |
| `chore/` | Outillage seul |
| `docs/` | Documentation seule |

L'identifiant `CC-XX` dans le nom de branche est **recommandé, pas obligatoire** : l'historique
de ce dépôt comporte des branches thématiques sans ID (`refactor/feature-modules`) qui couvrent
plusieurs tickets. Ce qui est obligatoire, c'est le **footer de chaque commit** — c'est lui qui
porte le lien vers YouTrack, et il est constant.

Créer une branche seulement quand le travail est nettement distinct d'une branche ouverte, ou
qu'il y a un risque de conflit.

### Branche de base

Tout part de **`master`** et y retourne. Il n'y a pas de `develop` sur ce dépôt.

---

## 6. Gates avant de stager

```bash
npm run lint
npm run typecheck
npm test
```

⚠️ **Si le diff touche un `.vue`, `npm run build` est obligatoire en plus.** `tsc` ne lit pas
les `.vue` et il n'y a pas de `vue-tsc` ici : un import cassé ou une prop mal câblée ne se voit
qu'au build ou à l'écran. Un `typecheck` vert ne prouve **rien** sur une page.

```bash
npm run build   # dès qu'un .vue est touché
```

Un run rouge en local est bloquant — ne jamais commiter au travers.

⚠️ **Lire la section `scripts` de `package.json` avant de conclure.** `npm test` peut chaîner
plusieurs exécuteurs (backend AdonisJS et, selon l'état du dépôt, un exécuteur front) : dans ce
cas **les deux moitiés** doivent passer, et un échec de la seconde ne se voit pas si on ne
regarde que le début de la sortie.

⚠️ Un `PASSED` affiché avec un **code de sortie 1** signale le problème `@swc/core` documenté
dans `CLAUDE.md` — ne pas ré-épingler la version exacte pour le faire taire.

---

## 7. Recettes

### Contribution standard

```bash
git checkout master
git pull
git checkout -b <type>/<description>

# … travail, puis gates du §6 …

git add <fichiers-du-commit-1>
git commit -m "<message conventionnel>

CC-XX"
git add <fichiers-du-commit-2>
git commit -m "<message conventionnel>

CC-XX"

git push -u origin <branche>
gh pr create --base master --title "<titre>" --body "<contexte, ce qui change, pourquoi>"
```

Le dépôt est solo : pas d'assignation, et c'est toi qui merges. La revue passe par
`/lead-review` avant le commit, et par `/review-mr` sur la PR si elle a de la substance.

### Réécrire des commits non poussés

```bash
git log --oneline -10
git reset --soft HEAD~N
git reset HEAD
# recréer les commits selon la découpe du §4
git push --force-with-lease origin <branche>
```

**Jamais** `--force` sans `--with-lease`. **Jamais** de réécriture sur `master`.

### Mettre de côté un travail en cours

```bash
git stash push --include-untracked -m "<description>"
git checkout master && git pull
git checkout -b <type>/<description>
git stash pop
```

`--include-untracked` n'est pas optionnel : sans lui, les fichiers neufs restent sur place et
se mélangent au travail suivant.

---

## 8. Ce qu'on refuse

- ❌ Sujet de commit en français.
- ❌ Emoji dans le commit (sujet, corps ou footer).
- ❌ Sujets « WIP », « tmp », « fix », « fix2 », « address review ».
- ❌ Commit multi-axes (outillage + code + docs) pour un travail non trivial.
- ❌ Corps absent sur un commit qui touche plus de quelques lignes ou plus de deux fichiers.
- ❌ `Co-Authored-By: Claude …` ou tout autre footer d'assistant IA.
- ❌ Changement cassant sans `!` ni footer `BREAKING CHANGE:`.
- ❌ Footer `Refs: #CC-XX` — l'identifiant se met **nu**.
- ❌ Footer de ticket absent.
- ❌ `git push --force` sans `--with-lease`.
- ❌ Réécriture d'historique sur `master`.
- ❌ Gates sautés — en particulier `npm run build` quand un `.vue` est touché.
- ❌ `git add -A` quand le staging sélectif compte — préférer les chemins explicites.
- ❌ PR ouverte sans avoir croisé `git status --short` : un module neuf peut manquer.

---

## 9. Modèles

### Feature ou fix

```
feat(<scope>): <sujet à l'impératif>

<Prose expliquant pourquoi le changement existe, ce qui casserait sans
bruit si on le défaisait, et ce que les tests prouvent.>

CC-XX
```

### Outillage

```
chore(tooling): <sujet à l'impératif>

<Ce que la configuration change, et le problème concret qu'elle résout.>

CC-XX
```

### Refactor cassant

```
refactor(<scope>)!: <sujet à l'impératif>

<Prose expliquant le pourquoi.>

BREAKING CHANGE: <note de migration>

CC-XX
```

### Documentation

```
docs(<scope>): <sujet à l'impératif>

<Ce que le code ne peut pas dire de lui-même, et ce qu'un lecteur ultérieur
déferait de bonne foi.>

CC-XX
```

---

## 10. En cas de doute

Si un commit n'entre pas proprement dans ces règles, poser la question avant de commiter : une
mauvaise découpe coûte moins cher à discuter qu'à réécrire.
