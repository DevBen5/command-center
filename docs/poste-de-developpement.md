# Monter un poste de développement

Ce document s'adresse à qui veut **développer** Command Center : cloner, monter la base, jouer les
migrations, lancer les gates. Il ne s'adresse pas à qui veut seulement **installer** l'application —
c'est le `README.md`, qui tire l'image publiée sans jamais cloner.

⚠️ **Ce document décrit une procédure, jamais un état d'avancement.** Ce qui est fait, ce qui reste
et pourquoi vivent dans le projet **CC** de YouTrack ; les règles du code vivent dans les
`CLAUDE.md`. Un document qui recopierait l'un ou l'autre mentirait au premier merge suivant.

---

## 1. Prérequis

| | Version | Pourquoi |
|---|---|---|
| Node | 22 | Suit `node:22-alpine` du `Dockerfile` |
| Docker + Compose | récent | Postgres 16, et Adminer sous profil `tools` |
| Git | — | — |
| **ImageMagick 7** | 7.x | Les tests de vignettes NAS du coffre invoquent `magick` |

### ⚠️ Le piège ImageMagick, et il mord sur toute distribution Debian/Ubuntu

**Le paquet `imagemagick` de Debian et d'Ubuntu installe ImageMagick 6, dont la commande est
`convert` — il n'y a AUCUN binaire `magick`.** Alpine, lui, livre bien IM 7, ce qui est pourquoi
l'image de production fonctionne.

Sans `magick` sur le `PATH`, une douzaine de tests échouent en `spawn magick ENOENT`, et le message
n'accuse ni la distribution ni le paquet.

Deux issues :

- installer ImageMagick 7 par le moyen de la distribution (AppImage officielle, dépôt tiers, ou
  compilation) ;
- ou reproduire le contournement **déjà mesuré** par la CI :
  `.github/workflows/gates.yml` fait suivre `magick` vers `convert` par un lien symbolique. Il est
  légitime parce que la syntaxe **positionnelle** utilisée par le générateur (`FORMAT:chemin[0]
  -ops FORMAT:-`, sans sous-verbe) est identique entre les deux versions — lire le commentaire de
  ce fichier avant de le recopier, il porte la raison et la limite.

⚠️ **Un `PATH` périmé ressemble à une absence d'installation.** Après avoir installé ImageMagick,
ouvrir un terminal **neuf** : un shell démarré avant l'installation ne le verra pas, et on conclut
à tort à un échec pré-existant. Vérifier avec `magick -version` **dans le terminal qui lancera les
tests**, jamais dans un autre.

---

## 2. Démarrage

```bash
git clone https://github.com/DevBen5/command-center.git
cd command-center
npm ci
cp .env.example .env          # puis l'éditer — voir §3
docker compose up -d postgres # AVANT toute autre commande
node ace migration:run
npm run dev                   # http://localhost:3333
```

⚠️ **L'ordre n'est pas décoratif : Postgres d'abord.** Sans lui, `npm test` **ne sort jamais** —
mesuré à 1 h 11 sur un poste, sans un seul message d'erreur. Ce n'est pas une lenteur, c'est une
attente infinie, et c'est le premier réflexe à avoir quand une commande semble figée.

⚠️ **`node ace migration:run` sur la base de dev n'est pas optionnel après un clone ni après un
`git pull` qui ramène une migration.** Une suite de tests verte ne dit **rien** du schéma de la base
`app` : `npm test` déroule `app_test` à chaque exécution et ne touche jamais `app`. `node ace
migration:status` tranche en une seconde.

Sur une base sans aucun compte, l'application redirige vers `/installation`. Le **jeton
d'installation** est imprimé dans les journaux au démarrage — il n'apparaît nulle part ailleurs, et
un redémarrage en change la valeur.

---

## 3. Le `.env` — ce qui se recopie, et ce qui se transporte

`.env.example` porte 270 lignes de commentaires : le lire vaut mieux que le survoler. Les valeurs
sensibles ne sont **jamais** dans le dépôt, qui est public.

| Variable | Sur un poste neuf |
|---|---|
| `APP_KEY` | ⚠️ voir ci-dessous |
| `MODULES` | La liste des modules actifs. `coffre` en est **absent par défaut** — il faut l'ajouter pour travailler dessus |
| `COFFRE_NAS_ROOTS` | Format `nom=chemin` (un identifiant par racine). Le chemin est celui que **le processus** voit — sur Linux, le point de montage du partage, pas un chemin Windows |
| `BACKUP_MIRROR_DIR` | Doit **exister** — il n'est jamais créé. Un dossier fabriqué sur un support non monté ferait croire à une protection inexistante |
| `BACKUP_ENCRYPTION_RECIPIENT` | La clé **publique** `age`. La privée ne vit sur aucune machine |

### ⚠️ `APP_KEY` : identique, ou les comptes deviennent inaccessibles

Si le poste neuf part d'une **base vierge**, `APP_KEY` peut être neuve — elle ne protège rien
encore.

Si le poste neuf **restaure un dump**, elle doit être **exactement la même** que celle de la machine
d'origine. Les secrets TOTP sont chiffrés avec elle : une clé différente les rend illisibles, et un
compte enrôlé au second facteur ne peut plus se connecter du tout. Le filet existe
(`node ace auth:reset-account`), mais c'est un filet, pas un plan.

### Ce qui ne vit dans aucun fichier, et qu'aucune procédure ne peut restituer

- **La passphrase du coffre** — la clé de chiffrement en dérive et n'est stockée nulle part.
  Passphrase perdue = contenu du coffre perdu, sans équivalent de `auth:reset-account` : ce serait
  une porte dérobée.
- **La clé privée `age`** (`AGE-SECRET-KEY-1…`) — détenue par le propriétaire, hors des machines.
  Elle ne se passe qu'en ligne, à l'invocation de `db:restore`. Clé perdue = sauvegardes chiffrées
  perdues.

---

## 4. Reprendre les données d'un autre poste

Sur la machine d'origine :

```bash
npm run db:backup
```

Le dump est dans `backups/`, chiffré (`.sql.age`) si `BACKUP_ENCRYPTION_RECIPIENT` est renseignée.
Le transporter par un canal qu'on choisit — il porte tout : contenu, réglages, comptes.

Sur le poste neuf, une fois le fichier en place :

```bash
BACKUP_DECRYPTION_KEY=AGE-SECRET-KEY-1… npm run db:restore -- backups/<fichier>.sql.age
```

⚠️ **`db:restore` REMPLACE la base, il ne fusionne pas.** Le dump est fait avec `--clean
--if-exists` : il supprime les tables avant de les recréer. Sur une base qui porte déjà quelque
chose qu'on voulait garder, ce chemin le détruit. La procédure de vérification et ses preuves
datées vivent dans `docs/restauration-verifiee.md`.

### ⚠️ Le piège des deux bases — le seul qui fasse vraiment perdre du travail

Rien ne synchronise deux installations. Si deux postes saisissent chacun du contenu, on obtient
**deux historiques cohérents et incomplets**, sans le moindre avertissement : chaque machine affiche
un état crédible, simplement amputé de ce que l'autre a saisi.

Le contenu de ce projet est saisi à la main, sans seeder : **la base est la seule copie**. Décider
quelle installation fait autorité, et s'y tenir, n'est pas une précaution — c'est la seule chose qui
empêche la perte.

---

## 5. Les gates

```bash
npm run lint
npm run typecheck
npm test          # Japa puis Vitest, dans cet ordre
npm run build     # obligatoire dès qu'un .vue est touché
```

⚠️ `tsc` ne lit pas les `.vue` et il n'y a pas de `vue-tsc` ici : un import cassé ou une prop mal
câblée ne se voit qu'au build ou à l'écran. Un `typecheck` vert ne prouve **rien** sur une page.

⚠️ Un `PASSED` affiché avec un **code de sortie 1** signale le problème `@swc/core` documenté dans
le `CLAUDE.md` racine — ne pas ré-épingler la version exacte pour le faire taire.

Les cinq mêmes gates tournent en CI (`.github/workflows/gates.yml`), sur `push` vers `master` et sur
toute PR qui la vise.

---

## 6. Regarder la base

```bash
docker compose exec postgres psql -U root -d app
docker compose --profile tools up -d adminer     # puis http://127.0.0.1:8081
```

⚠️ Adminer est derrière le profil `tools` **et ne démarre donc pas** avec `docker compose up` : il
donne un accès complet en lecture et en écriture à la base. Dans son formulaire, le serveur est
`postgres` (le nom du service), pas `127.0.0.1` — qui désignerait le conteneur Adminer lui-même — et
la base est `app`, pas `app_test`, que `npm test` vide à chaque exécution.

---

## 7. Où vit la doc durable

Ce document ne recopie rien de ce qui suit — il y renvoie.

- **`CLAUDE.md`** à la racine : l'architecture par feature, les sept choses qui cassent sans lever
  d'erreur, la sécurité, les sauvegardes et leur chiffrement.
- **`app/<couche>/<module>/CLAUDE.md`** : les invariants de chaque module, ses pièges, ses
  frontières de confiance. Celui du coffre est le plus dense.
- **`app/<couche>/<module>/TESTS.md`** : ce que la suite d'un module couvre — à lire **avant** de
  modifier un test. Une garde vérifie dans les deux sens que l'index et les fichiers concordent.
- **`docs/restauration-verifiee.md`** : la procédure de restauration et ses preuves datées.
- **`docs/deploiement-nas.md`** : le déploiement sur NAS Synology.
- **Le projet CC de YouTrack** : le backlog **et** la base de connaissance. C'est là, et nulle part
  ici, que vit l'état d'avancement.

⚠️ **Le dépôt fait autorité contre la base de connaissance.** Elle est une synthèse tenue à jour
après chaque merge ; quand elle diverge du code, c'est elle qu'il faut corriger.
