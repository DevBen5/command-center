# Déploiement sur le NAS — DSM, reverse proxy, Let's Encrypt, sauvegarde, recette

Guide de mise en ligne de Command Center sur un Synology (DS918+, DSM 7, Container Manager),
derrière un sous-domaine à soi. Il s'appuie sur le paquet de production livré par CC-73 —
`Dockerfile`, `docker-compose.prod.yml`, `.env.production.example` — et ne demande **aucun
changement de code** : tout ce qui suit se fait dans DSM, en SSH, ou chez le registrar.

Ces étapes sont **manuelles et dans cet ordre**. L'ordre n'est pas décoratif : les bloquants
du §1 se vérifient avant d'ouvrir quoi que ce soit, et le port ne s'ouvre qu'en dernier.

⚠️ **Les valeurs de l'installation réelle ne sont pas dans ce fichier — le dépôt est public.**
Nom d'hôte, DDNS, adresse de contact et numéro de volume vivent dans la base de connaissance
YouTrack, qui est privée. Ce guide écrit des **repères** à remplacer, et ils sont choisis pour
qu'un copier-coller distrait échoue bruyamment plutôt que de fabriquer quelque chose ailleurs :

| Repère | Ce qu'il désigne |
|---|---|
| `app.exemple.fr` | le nom public de l'application |
| `exemple.fr` | la zone DNS, chez le registrar |
| `<ddns>.freeboxos.fr` | le nom DDNS qui suit l'IP publique de la box |
| `vous@exemple.fr` | l'adresse de contact du certificat |
| `/volumeX` | le volume du NAS — **`X` est un numéro à remplacer**, ce n'est pas toujours 1 |

## Vue d'ensemble

```
app.exemple.fr  ──CNAME──▶  <ddns>.freeboxos.fr  (DDNS Freebox → IP publique)
        │
   Internet ──443──▶ Freebox ──443──▶ DSM reverse proxy (TLS, HSTS, HTTP/2)
                                             │  trie par nom d'hôte
                                        localhost:8080  (lié à 127.0.0.1 — invisible du LAN)
                                             │
                                        conteneur app ──réseau compose──▶ conteneur postgres
                                                                          (aucun port publié)
```

| Port | État | Pourquoi |
|---|---|---|
| 443 | **ouvert** (routeur → NAS) | l'unique entrée de l'application |
| 80 | **ouvert** (routeur → NAS) | challenges Let's Encrypt, renouvellement compris (§6) |
| 8080 | loopback du NAS seulement | le reverse proxy l'atteint par `localhost` ; le LAN, non |
| 5432 | réseau du compose seulement | Postgres ne publie **aucun** port en prod |
| 5433 / 8081 | n'existent pas en prod | liaisons de dev ; Adminer n'est pas dans le compose de prod |
| 5000 / 5001 | **jamais redirigés** | c'est DSM lui-même — l'exposer n'a rien à voir avec ce projet |

## 1. Bloquants — avant d'ouvrir le port 443

⚠️ **Ces trois points ne sont pas de la checklist, ils sont bloquants.** Une application
exposée qui rate l'un des trois n'est pas « presque prête », elle est ouverte ou condamnée à
perdre son contenu.

1. **Le compte propriétaire se crée depuis l'écran d'installation, jeton en main** (CC-138,
   §4). Plus d'`ADMIN_PASSWORD`, plus de seed : sur une base vide l'application redirige vers
   `/installation`, qui exige le **jeton imprimé dans les journaux** du conteneur — c'est lui
   qui empêche « le premier qui se connecte » d'être un scanner plutôt que vous. Mot de passe
   fort exigé (12 caractères minimum). L'écran se ferme définitivement dès que le compte
   existe. Pour une **rotation** ultérieure : `/reglages` (connecté) ou `auth:reset-account`
   (§4 bis) — aucun secret dans un fichier.
2. **L'image embarque CC-71 et CC-72** (capacités, refus par défaut, Leitner en lecture seule).
   Sans eux, tout compte authentifié peut tout faire — `POST /revision/ingest` et l'écran de
   configuration LLM compris. Concrètement : l'image se construit depuis un `master` à jour,
   et ces deux tickets y sont mergés depuis juillet 2026. Ne déployez jamais une image
   construite sur une branche antérieure.
3. **Un dump a été restauré une fois pour de vrai** (§7, dernier paragraphe). Une sauvegarde
   jamais restaurée n'est pas une sauvegarde, et la base du NAS portera l'unique exemplaire du
   contenu. Le premier déploiement est le seul moment où ce test ne coûte rien : il n'y a
   encore rien à perdre.

## 2. Préparer le NAS

**Activer SSH** : Panneau de configuration → Terminal & SNMP → Activer le service SSH. Il
sert au chargement de l'image (§3), au lancement de la pile (§4) et au test de restauration
(§7). Les commandes `docker` s'exécutent en `sudo` depuis un compte administrateur DSM.

**Créer les dossiers** (File Station ou SSH) :

```
/volumeX/docker/command-center/          ← docker-compose.prod.yml + .env.production
/volumeX/docker/command-center/pgdata/   ← les données Postgres (PGDATA_PATH)
/volumeX/docker/backups/command-center/  ← les dumps quotidiens (§7)
```

**Remplir `.env.production`** : copier `docker-compose.prod.yml` et `.env.production.example`
du dépôt dans `/volumeX/docker/command-center/`, renommer l'exemple en `.env.production`, et
remplir chaque variable en suivant ses commentaires. Points qui changent sur le NAS :

- `PGDATA_PATH=/volumeX/docker/command-center/pgdata` — chemin **absolu**, jamais le `./pgdata`
  par défaut. ⚠️ Ce dossier appartient à Postgres, binaire, lié à PG 16 : ce n'est **pas** une
  sauvegarde, et il ne se copie pas à chaud.
- `TRUST_PROXY=uniquelocal` — le reverse proxy DSM joint le conteneur via le bridge Docker
  (une adresse `172.x`), pas via loopback. Sans cette valeur, le throttle de connexion (CC-78)
  compterait tous les visiteurs comme une seule IP : un seul attaquant verrouillerait le login
  de tout le monde. Sûr **uniquement** parce que 8080 est lié à `127.0.0.1` (personne d'autre
  que le NAS ne joint l'application en direct, donc personne ne forge son `X-Forwarded-For`).
- `LIMITER_STORE=database` — **requise au boot**, le conteneur ne démarre pas sans elle.
- `APP_URL=https://app.exemple.fr` — **requise au boot** (CC-136), le nom public derrière le
  reverse proxy, pas une adresse interne. En dérive le `secure` des cookies de session et CSRF ;
  laissée en HTTP sur un hôte non local, elle ne bloque rien mais l'avertit dans les logs.
- `LLM_BASE_URL` / `IMMICH_*` — depuis le NAS, ce sont des adresses du **réseau local**
  (LM Studio sur le PC, la stack Immich). ⚠️ PC éteint = juge en repli **silencieux** : un
  invité qui révise ne verra aucune erreur, c'est le comportement voulu. À savoir avant de
  conclure que « le juge ne marche pas en prod ».
- `APP_KEY` — la générer une fois (commande dans le fichier), puis ne plus y toucher : la
  changer invalide toutes les sessions.

## 3. Transférer l'image — il n'y a pas de registry

> ⚠️ **2026-08-05 (CC-142) — le titre de cette section a cessé d'être vrai, et il est laissé tel
> quel plutôt que récrit en silence.** Il y a désormais un registry : une image multi-arch
> (`linux/amd64` + `linux/arm64`) est publiée sur `ghcr.io/devben5/command-center` par
> `.github/workflows/release.yml` à chaque tag `vX.Y.Z`.
>
> La procédure ci-dessous — construire sur le PC, `docker save`, `docker load` — **marche toujours
> telle quelle** et reste celle de ce NAS aujourd'hui : rien n'a été retiré. Ce qui a changé, c'est
> qu'elle n'est plus le seul chemin ni le plus court. Faire passer ce NAS du `.tar` au `docker pull`
> est **CC-150**, pas ce ticket : celui-ci produit une image, il ne la déploie pas.
>
> Deux détails si vous reprenez la procédure aujourd'hui : `--platform linux/amd64` a disparu du
> compose (il rendait le fichier inutilisable sur un hôte ARM) et n'est plus nécessaire dans le
> `docker build` ci-dessous non plus, le démon construisant pour son architecture ; et une
> installation **neuve**, elle, n'a rien à voir avec cette section — elle part de
> `docker-compose.install.yml` et du README.

L'image se construit sur le PC et voyage en fichier :

```bash
# Sur le PC, dépôt à jour sur master :
docker build --platform linux/amd64 \
  --build-arg APP_VERSION=$(node -p "require('./package.json').version") \
  --build-arg APP_COMMIT=$(git rev-parse --short HEAD) \
  -t command-center:prod .
docker save command-center:prod -o command-center-prod.tar
```

⚠️ **Les deux `--build-arg` ne sont pas optionnels** (CC-151) : ils alimentent le `LABEL`
OCI que lit `docker inspect` (CC-130 point 2) et, pour le commit, l'écran `/reglages` de
l'application elle-même. Les oublier ne fait pas échouer le build — l'image se construit
normalement, mais `/reglages` affiche alors le repli « développement » sur une image de
production, sans qu'aucune erreur ne le signale.

Copier le `.tar` sur le NAS (File Station, ou `scp` vers `/volumeX/docker/command-center/`),
puis en SSH :

```bash
sudo docker load -i /volumeX/docker/command-center/command-center-prod.tar
```

⚠️ **Ne laissez jamais le NAS construire l'image.** Le compose garde un bloc `build:` pour le
poste de dev, mais `docker compose up` n'y recourt pas tant que le tag `command-center:prod`
existe — c'est le cas après le `docker load`. Un build sur le Celeron J3455 (4 Go partagés
avec DSM) est précisément ce que l'image pré-construite évite. Le `.tar` peut être supprimé
une fois chargé.

## 4. Démarrer la pile — en SSH, pas par l'import Container Manager

⚠️ **Écart assumé avec le ticket CC-74**, qui prévoyait d'importer le projet compose dans
Container Manager. Son UI ne sait pas passer `--env-file`, attend un fichier nommé
`docker-compose.yml`, et lirait un `.env` — il faudrait renommer les deux fichiers et
entretenir une copie d'environnement qui divergerait de `.env.production`. La commande
documentée dans l'en-tête du compose marche telle quelle en SSH :

```bash
cd /volumeX/docker/command-center
sudo docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

Le drapeau `--env-file` est **nécessaire** : il alimente l'interpolation `${...}` du bloc
postgres. Sans lui, Postgres refuse de démarrer — échec bruyant, pas silencieux. Les
migrations se jouent automatiquement au démarrage du conteneur app (`ENTRYPOINT`), le
healthcheck interroge `/login`. Les conteneurs restent visibles dans Container Manager
(onglet **Conteneur**) pour la surveillance CPU/RAM — seul l'onglet « Projet » est ignoré.
`restart: unless-stopped` fait revenir la pile après un redémarrage du NAS.

**Créer le compte propriétaire** — depuis l'écran d'installation (CC-138). Tant que la base
ne porte aucun compte, l'application redirige vers `/installation` et le conteneur imprime le
**jeton d'installation** dans ses journaux au démarrage :

```bash
sudo docker compose --env-file .env.production -f docker-compose.prod.yml logs app | grep -i jeton
```

Ouvrir l'application, recopier le jeton dans le formulaire, saisir nom / email / mot de passe
(12 caractères minimum) : le compte créé est administrateur, et l'écran se ferme
définitivement. ⚠️ **Le jeton change à chaque redémarrage du conteneur** — s'il est refusé,
relire les journaux, pas ses notes. Il n'y a plus de `db:seed` à lancer : la commande existe
toujours mais ne fait plus rien (aucun seeder enregistré).

## 4 bis. Le jour où vous ne pouvez plus entrer

`node ace auth:reset-account <email>` repose un mot de passe sur un compte **et** désarme son
second facteur — secret TOTP, codes de secours, anti-rejeu (CC-129). C'est la seule issue quand
le téléphone *et* les codes de secours sont perdus sur une installation à un seul
administrateur : la sortie prévue par CC-114 est « un **autre** administrateur », qui n'existe
pas dans ce cas.

```bash
cd /volumeX/docker/command-center
sudo docker compose --env-file .env.production -f docker-compose.prod.yml \
  run --rm app node ace auth:reset-account vous@exemple.fr
```

Elle affiche le compte trouvé, demande confirmation, puis fait taper le mot de passe **deux
fois, masqué**. Rien n'est écrit avant la seconde saisie.

⚠️ **`run`, pas `exec -T`.** La commande **refuse** de tourner sans terminal, et ne lit ni
option ni variable d'environnement : c'est ce qui garantit que le mot de passe ne reste nulle
part après coup. `docker compose run` alloue un terminal par défaut ; `-T` le retire, et la
commande s'arrête alors en expliquant pourquoi.

⚠️ **Elle doit être déjà déployée le jour où elle sert.** Une image construite avant CC-129 ne
la contient pas — et c'est précisément le jour où vous êtes dehors qu'il faudrait reconstruire
et recharger. Vérifiez-la **maintenant**, une fois, sur un compte de test :
`… run --rm app node ace list` doit afficher `auth:reset-account`.

⚠️ **Chaque passage laisse une ligne** dans `account_reset_events` — le journal, lui, meurt
avec le conteneur jetable de `run --rm`. C'est cette table qui permet, des mois plus tard, de
distinguer un geste que vous avez fait d'un geste que vous n'avez pas fait :

```bash
sudo docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec postgres psql -U root -d app \
  -c 'select user_email, created_at from account_reset_events order by id desc limit 20'
```

⚠️ **Elle ne ferme pas les sessions déjà ouvertes** : le store est `cookie`, il n'existe aucune
liste côté serveur. Un cookie volé reste valable jusqu'à sa borne de 7 jours (CC-78).

## 5. DNS — le CNAME chez le registrar

C'est la chaîne déjà en place pour les autres applications du NAS, et elle ne change pas
ici : la zone est gérée chez le registrar (**Hostinger**), et l'adresse publique de la box
est suivie par le **DDNS Freebox**, `<ddns>.freeboxos.fr`.

Chez le registrar → zone DNS de `exemple.fr` → ajouter :

| Type | Nom | Contenu | TTL |
|---|---|---|---|
| `CNAME` | `app` | `<ddns>.freeboxos.fr` | par défaut (14400) suffit |

⚠️ **Un `CNAME` vers le DDNS, jamais un `A` vers l'IP publique.** L'IP de la box change ;
c'est Free qui met à jour le `A` du nom DDNS, et le CNAME suit sans qu'on ait rien à faire.
Un `A` figé rendrait le site injoignable au prochain changement d'IP, sans prévenir.

⚠️ **Le TTL du CNAME ne gouverne PAS la réactivité au changement d'IP.** Un résolveur met en
cache le CNAME (TTL du registrar) *et* le `A` du nom DDNS (TTL Free) séparément : c'est le
second qui décide de la vitesse de bascule. Descendre le TTL du registrar à 60 ne gagne
rien — inutile de s'en préoccuper.

**Attendre que ça résolve avant de continuer.** Le §6 fait venir Let's Encrypt frapper à ce
nom : sans propagation, la demande de certificat échoue avec une erreur qui accuse le DNS.

```bash
nslookup app.exemple.fr
# doit rendre l'IP publique de la box (via le nom DDNS)
```

**Redirection de ports sur la Freebox** — **443 → NAS:443** et **80 → NAS:80**. C'est un
geste qui se fait **une seule fois pour le NAS**, pas une fois par application : toutes
entrent par le même 443 et sont triées par nom d'hôte au niveau du reverse proxy DSM. Si
d'autres applications sont déjà exposées, il n'y a rien à toucher ici.

⚠️ **Le port 80 reste ouvert en permanence** — il ne sert à aucun contenu (DSM n'y répond
qu'une redirection nginx), uniquement aux challenges Let's Encrypt, **renouvellement
automatique compris** (§6). Le fermer « pour faire propre » ne casse rien tout de suite : le
certificat expire trois mois plus tard, en silence.

⚠️ **Rien d'autre.** Ni 5433 ni 8081 — ils n'existent pas en prod. Ni 8080 — lié à
`127.0.0.1` sur le NAS, il ne répondrait de toute façon pas, et c'est voulu : en direct, les
cookies `secure` rendraient le login impossible en HTTP, et un client qui joint le port
contournerait le throttle en forgeant son `X-Forwarded-For`. Ni 5000/5001 — DSM ne s'expose
pas parce qu'un tableau de bord s'expose.

⚠️ **Cette application ne s'atteint pas en `http://<IP du NAS>:8080`, contrairement aux
autres.** C'est le seul écart avec l'habitude, et il est délibéré : le compose publie
`127.0.0.1:8080:8080`. Le reverse proxy la joint quand même — il tourne *sur* le NAS, donc
`localhost` le mène à destination. Ne « corrigez » pas le compose en `8080:8080` parce que
l'adresse LAN ne répond pas : ça ouvrirait le login en HTTP nu (où les cookies `secure`
l'empêchent de fonctionner de toute façon) et ça retirerait la seule chose qui rend
`TRUST_PROXY=uniquelocal` sûr — n'importe quelle machine du réseau pourrait alors forger son
`X-Forwarded-For` et faire verrouiller le login de n'importe qui. Pour vérifier que
l'application répond avant d'avoir un certificat, en SSH sur le NAS :
`curl -I http://127.0.0.1:8080/login` → `200`.

## 6. Reverse proxy DSM et Let's Encrypt

**L'ordre des trois étapes est imposé, pas préféré** : le DNS (§5) doit résoudre pour que
Let's Encrypt puisse valider, et la règle de reverse proxy doit exister pour apparaître dans
la liste des services à certifier. DNS → proxy → certificat → association.

### 6.1 La règle de proxy inversé

Panneau de configuration → **Portail de connexion** → **Avancé** → **Proxy inversé** →
**Créer**.

| Champ | Valeur |
|---|---|
| Nom du proxy inversé | `command-center` |
| **Source** — Protocole | `HTTPS` |
| **Source** — Nom d'hôte | `app.exemple.fr` |
| **Source** — Port | `443` |
| Activer HSTS | ☑ **coché** |
| Profil de contrôle d'accès | Non configuré |
| **Destination** — Protocole | `HTTP` |
| **Destination** — Nom d'hôte | `localhost` |
| **Destination** — Port | **`8080`** |

Dans l'onglet **Paramètres personnalisés** de la règle, activer **HTTP/2**.

⚠️ **Le port de destination est `8080`, pas `3333`.** 3333 est le port du serveur de
développement (`npm run dev`) ; l'image de production écoute sur 8080, et c'est ce que le
compose publie.

⚠️ **Destination en `HTTP`, et c'est correct.** Le TLS s'arrête au reverse proxy ; entre lui
et le conteneur, tout reste sur le NAS, sur la boucle locale. Mettre `HTTPS` ici ferait
échouer la connexion — le conteneur ne sert pas de TLS.

⚠️ **HSTS est collant.** Une fois l'en-tête servi, le navigateur refusera tout `http://` sur
ce nom pendant la durée du `max-age`, même si la règle est supprimée. C'est voulu ici, mais
c'est un aller simple : il faut vider l'état HSTS du navigateur pour revenir en arrière.

**Profil de contrôle d'accès : Non configuré** — l'application a son propre login, son
throttle (CC-78) et son second facteur optionnel (CC-114). Un profil DSM (filtrage par IP)
n'aurait de sens que devant une application qui n'authentifie pas elle-même.

**Pas d'en-têtes WebSocket ici.** Le bouton « Créer → WebSocket » de l'onglet En-tête
personnalisé (qui pose `Upgrade: $http_upgrade` et `Connection: $connection_upgrade`) est
nécessaire aux applications qui tiennent une connexion permanente — Command Center n'en
ouvre aucune : ni WebSocket, ni SSE, ni Transmit. Les poser ne casserait rien, mais ce
serait du décor.

### 6.2 En-têtes personnalisés — la ceinture, pas la bretelle

Onglet **En-tête personnalisé** de la règle → **Créer** → **Proxy** :

```
X-Real-IP           $remote_addr
X-Forwarded-For     $proxy_add_x_forwarded_for
X-Forwarded-Proto   $scheme
```

**Honnêteté sur ce point** : DSM 7 écrit déjà ces trois `proxy_set_header` dans la
configuration nginx qu'il génère — c'est pour cette raison que les autres applications du
NAS fonctionnent sans que personne n'ait rien ajouté. Les réécrire explicitement coûte trois
lignes et les rend indépendants d'un changement de comportement à une mise à jour de DSM.
Ce n'est **pas** ce qui prouve qu'ils arrivent : la vérification n°7 de la recette (§8) le
prouve, en lisant l'IP réellement vue par le throttle.

⚠️ **Le sélecteur Requête / Réponse compte.** Ces trois en-têtes vont vers le **backend** :
posés côté « Réponse », ils partiraient au navigateur et ne serviraient à rien — sans erreur,
sans avertissement.

Pourquoi ça compte : `TRUST_PROXY=uniquelocal` revient à croire ce que le proxy écrit dans
`X-Forwarded-For`, et le throttle par IP comme les cookies `secure` en dépendent.

### 6.3 Le certificat Let's Encrypt

Panneau de configuration → **Sécurité** → **Certificat** → **Ajouter** → « Ajouter un
nouveau certificat » → « Procurez-vous un certificat auprès de Let's Encrypt » :

| Champ | Valeur |
|---|---|
| Description | `command-center` |
| Nom de domaine | `app.exemple.fr` |
| Courrier électronique | `vous@exemple.fr` |

⚠️ **Obtenir le certificat ne le branche pas** — et c'est l'étape qu'on oublie. Il faut
ensuite **Certificat → Paramètres**, trouver la ligne `app.exemple.fr:443` (elle n'existe
que parce que la règle du §6.1 a été créée avant) et y choisir le certificat
`command-center`. Sans ce geste, le navigateur reçoit le certificat auto-signé de DSM
et affiche un avertissement : on croit alors que Let's Encrypt a échoué, alors qu'il a
réussi.

Entre la création de la règle et l'association, l'hôte répond avec ce certificat par défaut.
C'est transitoire et sans gravité.

DSM renouvelle **automatiquement**, environ 30 jours avant l'expiration, par le port 80
(§5). L'association survit au renouvellement ; elle ne survit pas à un certificat
**recréé** à la main — dans ce cas, repasser par Certificat → Paramètres.

## 7. Sauvegarde — le cron `pg_dump` quotidien

⚠️ **`npm run db:backup` ne convient pas ici** : le script du dépôt appelle
`docker compose exec` depuis le poste de dev. Sur le NAS, la même logique — dump, vérification,
rétention en dernier — vit dans un script du Planificateur de tâches, qui parle directement au
conteneur (`container_name: command-center-postgres`, fixé dans le compose pour ça).

⚠️ **Depuis CC-140, il existe une alternative *dans l'application* — elle ne remplace pas ce
cron, elle le complète.** `node ace db:backup` tourne à l'intérieur du conteneur applicatif
(`docker compose exec app node ace db:backup`), sans script séparé à maintenir sur le NAS, avec
une sauvegarde automatique quotidienne intégrée (réglable depuis `/admin/sauvegarde`) et sans
dépendre du Planificateur de tâches DSM. Deux chemins vers le même filet ne se nuisent pas — le
cron ci-dessous reste valide et **déjà prouvé** ; garder les deux actifs, ou n'en garder qu'un,
est un choix d'exploitation, pas une obligation technique. Voir `BACKUP_DIR_PATH` /
`BACKUP_MIRROR_DIR_PATH` dans `.env.production.example` pour monter les volumes que la commande
in-app utilise.

**Créer la tâche** : Panneau de configuration → Planificateur de tâches → Créer → Tâche
planifiée → Script défini par l'utilisateur. Utilisateur **root**, quotidien (ex. 03h30) :

```sh
#!/bin/sh
# Sauvegarde quotidienne Command Center — même logique que scripts/lib/dumps.js :
# dump → écriture close → vérification → rétention EN DERNIER. Toute sortie en
# erreur déclenche l'e-mail du Planificateur (voir réglages de la tâche).
set -eu

DEST=/volumeX/docker/backups/command-center
KEEP=30
DB_USER=changez_moi        # le DB_USER de .env.production
FICHIER="$DEST/dump-$(date +%Y-%m-%dT%H-%M-%S).sql"

# Jamais de mkdir : un dossier absent est une erreur à voir, pas à masquer.
[ -d "$DEST" ] || { echo "Destination absente : $DEST" >&2; exit 1; }

# Écrit sous .part : un dump interrompu ne peut pas passer pour une sauvegarde.
# L'échec est traité explicitement : le .part est retiré (même geste que
# scripts/db-backup.js) et le message part dans l'e-mail du Planificateur —
# `set -e` seul sortirait sans un mot. (Pas de sudo : la tâche tourne en root.)
docker exec command-center-postgres \
  pg_dump -U "$DB_USER" -d app --clean --if-exists > "$FICHIER.part" \
  || { rm -f "$FICHIER.part"; echo "pg_dump a échoué — le conteneur tourne-t-il ?" >&2; exit 1; }

# Les trois marqueurs de scripts/lib/dumps.js. Le marqueur de fin se cherche dans
# les DERNIERS 8 Ko, pas en dernière ligne : pg_dump écrit un \unrestrict après lui.
head -c 8192 "$FICHIER.part" | grep -q -- '-- PostgreSQL database dump' \
  || { rm -f "$FICHIER.part"; echo "Dump invalide : en-tête pg_dump absent." >&2; exit 1; }
grep -q 'CREATE TABLE' "$FICHIER.part" \
  || { rm -f "$FICHIER.part"; echo "Dump invalide : aucun CREATE TABLE — base vide ?" >&2; exit 1; }
tail -c 8192 "$FICHIER.part" | grep -q -- '-- PostgreSQL database dump complete' \
  || { rm -f "$FICHIER.part"; echo "Dump invalide : marqueur de fin absent — tronqué ?" >&2; exit 1; }

mv "$FICHIER.part" "$FICHIER"

# Rétention : APRÈS un dump vérifié, jamais avant. Ne touche que ce dossier-ci.
ls -1t "$DEST"/dump-*.sql | tail -n +$((KEEP + 1)) | while read -r vieux; do
  rm -f "$vieux"
done

echo "Sauvegarde OK : $FICHIER"
```

Dans les **Paramètres** de la tâche : cocher « Envoyer les détails d'exécution par e-mail »
**et** « … uniquement lorsque l'exécution de la tâche se termine anormalement ». Chaque échec
du script sort en code non nul → e-mail. ⚠️ C'est le seul témoin : un cron qui échoue en
silence — disque plein, conteneur arrêté — vaut zéro sauvegarde, précisément le jour où on en
aurait besoin.

⚠️ **`/volumeX` est probablement le même volume que `pgdata`** : un disque qui lâche emporte
la base **et** ses dumps. Ce dossier doit donc partir ailleurs — second volume si le NAS en a
un, sinon **Hyper Backup** (ou rsync vers une autre machine) planifié **après** l'heure du
dump, couvrant `/volumeX/docker/backups/`. La rétention du script (`KEEP=30`) ne purge que le
dossier local ; la destination Hyper Backup est l'archive et a sa propre rétention — même
règle que `BACKUP_KEEP` face à `BACKUP_MIRROR_DIR` sur le poste de dev.

**Restaurer sur le NAS** — relire les marqueurs d'abord (les trois `grep` ci-dessus, à la
main), puis :

```bash
sudo docker exec -i command-center-postgres \
  psql -U <DB_USER> -d app -v ON_ERROR_STOP=1 --quiet < dump-....sql
```

⚠️ Le dump est fait avec `--clean` : il **supprime** les tables avant de les recréer. Sur un
fichier tronqué, `ON_ERROR_STOP=1` s'arrêterait au milieu — base à moitié détruite, dump
incapable de la reconstruire. Un dump qui échoue aux marqueurs ne se restaure pas, et ne se
supprime **jamais** : il est peut-être le seul qui reste.

**Le test de restauration réel** (bloquant n°3 du §1) se fait au premier déploiement, tant
qu'il n'y a rien à perdre : seed, saisir deux ou trois cartes, lancer la tâche de sauvegarde à
la main, supprimer une carte dans l'application, restaurer le dump, vérifier que la carte est
revenue. Dix minutes, une seule fois — et la chaîne entière est prouvée, pas supposée.

## 8. Recette — une fois en ligne

1. **Depuis l'extérieur du réseau** (partage de connexion mobile) :
   `https://app.exemple.fr` répond, certificat valide (émis par Let's Encrypt).
   Contre-épreuve depuis le LAN : `http://<IP du NAS>:8080` ne répond **pas** — le port est
   lié à loopback.
2. **Un compte invité réel** — créé dans l'écran d'administration, lien d'invitation (⚠️
   valable **48 h**) : il voit la révision Leitner ; il ne voit **ni** Services, **ni**
   Agents, **ni** Ingestion, **ni** Configuration LLM.
3. **Le même invité, en `curl`** — la seule vérification qui prouve quelque chose : une route
   est un contrat public, le masquage des boutons n'est que du confort. Récupérer dans les
   outils de développement du navigateur (session invité ouverte) les cookies
   `adonis-session` et `XSRF-TOKEN`, puis :

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' \
     -X POST https://app.exemple.fr/revision/cards \
     -H 'Content-Type: application/json' \
     -H 'Accept: application/json' \
     -H 'Cookie: adonis-session=<valeur>; XSRF-TOKEN=<valeur brute>' \
     -H 'X-XSRF-TOKEN: <valeur du cookie XSRF-TOKEN, décodée (%3A → :, etc.)>' \
     -d '{}'
   ```

   (`Accept: application/json` rend la contre-épreuve admin ci-dessous déterministe : sans
   lui, la négociation de contenu répondrait une redirection 302 au lieu du 422.)

   Attendu : **403**. Même appel sur `POST /revision/<id>/review` : **403** aussi.

   ⚠️ **L'en-tête `X-XSRF-TOKEN` n'est pas optionnel.** Sans lui, le 403 observé serait celui
   de Shield (CSRF), qui tomberait même si les capacités avaient disparu — le test
   « passerait » sans rien prouver. Pour lever le doute, rejouer la même commande avec les
   cookies d'une session **admin** : `422` (corps vide rejeté par la validation) — la
   mécanique passe, seule la capacité bloque l'invité. Et vérifier que la base n'a pas bougé :

   ```bash
   sudo docker exec command-center-postgres \
     psql -U <DB_USER> -d app -c "select count(*) from leitner_cards;"
   ```

   Même valeur avant et après.
4. **Les logs au démarrage** —

   ```bash
   cd /volumeX/docker/command-center
   sudo docker compose --env-file .env.production -f docker-compose.prod.yml logs -f app
   ```

   les migrations jouées, puis
   `started HTTP server`, et aucune ligne d'erreur. ⚠️ Le balayage des ingestions orphelines
   tourne bien au boot, mais il n'écrit **que** s'il a trouvé des travaux interrompus
   (`warn`) ou s'il a échoué (`error`) — sur un démarrage sain, **aucune ligne, et c'est
   l'état normal**. Ne cherchez pas un message qui n'existe pas.
5. **Module Services** — ouvrir `/services` avec le compte propriétaire : l'écran affiche la
   bannière **« Module hors service »** et **rien d'autre** — ni barre d'outils, ni
   indicateurs, ni cartes de conteneurs (CC-116). Sans socket Docker (jamais monté, décision
   CC-73), c'est le défaut en production : rien à configurer. Si des conteneurs s'affichent,
   `DOCKER_AVAILABLE=true` traîne dans `.env.production` — la retirer. Les invités, eux, ne
   voient pas cet écran (point 2).
6. **CPU et RAM** dans Container Manager après quelques minutes de navigation. Le J3455 est
   un Celeron de 2016 et les 4 Go se partagent avec DSM : le build Vite n'a pas lieu sur le
   NAS (image pré-construite), mais surveiller que l'ensemble reste raisonnable.
7. **Le throttle voit les vraies IP** — depuis le partage de connexion mobile, se tromper
   volontairement de mot de passe une fois, puis :

   ```bash
   sudo docker exec command-center-postgres \
     psql -U <DB_USER> -d app -c "select key from rate_limits;"
   ```

   Une clé contenant `login_ip_<IP publique du téléphone>` apparaît (préfixée par le store,
   ex. `rlflx:login_ip_…`). Si l'IP est en `172.x` : les en-têtes du §6 manquent, et le
   throttle compte tous les visiteurs comme une seule IP — un attaquant verrouillerait le
   login de tout le monde. (Une connexion réussie efface la clé : faire la lecture avant de
   se connecter pour de bon.)
8. **L'IP publique nue ne sert pas le portail DSM** — toujours depuis l'extérieur, ouvrir
   `https://<IP publique de la box>`. Rediriger 443 vers le NAS a un effet de bord qui n'a
   rien à voir avec les ports 5000/5001 : **nginx sert son hôte par défaut** à toute requête
   HTTPS dont le nom d'hôte ne correspond à aucune règle de proxy inversé, et sur DSM cet
   hôte par défaut est le **portail DSM**. Si l'écran de connexion apparaît, l'administration
   du NAS est offerte à Internet — ce qui pèse plus lourd que tout ce que ce document
   protège. Parades : profil de contrôle d'accès sur DSM (Portail de connexion → DSM),
   blocage automatique, 2FA sur les comptes administrateurs, aucun compte nommé `admin`.
   ⚠️ À vérifier **une fois pour le NAS**, pas par application — mais c'est ce déploiement
   qui a ouvert le 443, donc c'est ici que ça se contrôle.
9. **La porte de service répond** (§4 bis) — c'est la vérification à faire **maintenant**,
   parce que le jour où elle sert, vous ne pourrez plus entrer pour la réparer :

   ```bash
   cd /volumeX/docker/command-center
   # a) elle existe dans l'image déployée
   sudo docker compose --env-file .env.production -f docker-compose.prod.yml \
     run --rm app node ace list | grep auth:reset-account
   # b) elle refuse quand il n'y a pas de terminal — c'est le -T qui le retire
   sudo docker compose --env-file .env.production -f docker-compose.prod.yml \
     run --rm -T app node ace auth:reset-account vous@exemple.fr
   ```

   Attendu : (a) la ligne s'affiche ; (b) la commande s'arrête en disant qu'elle exige un
   terminal, **sans rien modifier**. Puis, sur un **compte de test** (jamais le vôtre du
   premier coup), la même invocation **sans** `-T` : elle doit afficher le compte, demander
   confirmation, et faire taper le mot de passe deux fois.

   ⚠️ **C'est le seul endroit où la garde se vérifie pour de vrai.** Aucun test du dépôt ne
   voit ce qu'il advient d'un TTY à travers `docker compose run` et une session SSH.

## 9. Mettre à jour l'application

Reconstruire sur le PC (master à jour), refaire le transfert du §3, puis :

```bash
cd /volumeX/docker/command-center
sudo docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

Compose recrée le conteneur app (l'image a changé), laisse Postgres et `pgdata` en place, et
les migrations éventuelles se jouent au démarrage.

⚠️ **Cette commande est la fin de la procédure, pas la procédure.** Ce qui la précède —
sauvegarde, échelon de retour arrière, variables neuves — est en **§9 bis**, et chacun de ces
trois points a déjà mordu au moins une fois.

## 9 bis. La chaîne complète d'une mise à jour, et comment revenir

Écrit d'après la mise en ligne de la `1.2.0` (2026-08-04), pas d'après ce qu'on imagine qu'elle
devrait être. Chaque avertissement ci-dessous correspond à quelque chose qui s'est réellement
produit ou qui a été vérifié à cette occasion.

L'ordre n'est pas décoratif : **la seule étape irréversible est le `docker load`**, et tout ce qui
la précède existe pour qu'elle le soit sans conséquence.

> ⚠️ **2026-08-05 (CC-142) — cette chaîne décrit le transport par `.tar`, et elle reste exacte.**
> Depuis ce jour, une image est publiée sur `ghcr.io/devben5/command-center` à chaque tag : un
> `docker pull` remplacerait alors les étapes 2 et 4 (construire, transférer, charger), **mais pas
> les étapes 1 et 3** — savoir ce qui part avec la version, et poser l'échelon de retour arrière
> avant de toucher à ce qui tourne. Ce sont précisément celles que « il suffit de tirer la nouvelle
> image » fait sauter sans le dire. Réécrire cette section pour le registry est **CC-150** ; elle
> n'est pas amendée à l'aveugle ici, parce que la version registry n'a jamais été exercée sur ce NAS
> et qu'une procédure non exercée écrite comme acquise est exactement ce que ce document refuse.

### 1. Ce qui part avec cette version

Avant de construire, répondre à deux questions sur le dépôt, pas de mémoire :

```bash
# Des migrations ? La réponse change ce que « revenir en arrière » veut dire.
git diff --name-only v<installée>..master -- '*/migrations/*'

# Des variables d'environnement neuves ?
git diff v<installée>..master -- start/env.ts | grep -E '^\+\s+[A-Z_]+:'
```

⚠️ **C'est « qu'est-ce qui est apparu **depuis la version installée** », jamais « quelles
variables existent ».** La liste générale est en §2, et elle n'a empêché aucun des deux oublis
ci-dessous : personne ne relit §2 pour mettre à jour une installation qui tourne.

**Le journal des variables, par palier.** À compléter à chaque mise en ligne :

| Depuis | Variable | Oubliée |
|---|---|---|
| `1.2.0` | `APP_URL` | **refus bruyant** — le conteneur ne démarre pas, dix secondes pour le voir |
| `1.2.0` | `MODULES` | ⚠️ **démarre sans aucun module**, sans un message |
| `1.2.0` | `APP_COMMIT` | posée par le build, pas par le `.env` — voir l'étape 2 |

⚠️ **`MODULES` est le cas à connaître.** Elle est `optional()` et son absence vaut « noyau seul » —
défaut retenu par CC-137, juste pour une installation **neuve** : l'oubli va vers le refus. Sur une
installation **existante**, le même défaut se retourne : la pile redémarre sans Leitner, sans
veille, sans agents. Routes en 404, barre latérale vide. **Ce n'est pas une perte de données** —
les migrations non jouées ne suppriment rien, remettre la variable rend tout — mais quelqu'un qui
découvre l'écran vide sans connaître ce mécanisme conclura que la mise à jour a vidé la base, et
c'est dans cet état-là qu'on prend les décisions qu'on regrette.

### 2. Construire — la commande se copie en entier

Celle du §3, sans en retirer un morceau. Les deux `--build-arg` ne sont pas décoratifs : les
oublier **ne fait pas échouer le build**. L'image se construit, se charge, démarre — et `/reglages`
affiche « Environnement de développement » sur une image de production, phrase que rien dans
l'application ne contredit. Le seul recours serait `docker inspect`, c'est-à-dire exactement le
shell que cet écran existe pour ne plus exiger.

Vérifier **avant** d'envoyer quoi que ce soit sur le NAS — c'est ici que l'oubli se voit, pas
là-bas :

```bash
docker inspect command-center:prod --format '{{json .Config.Labels}}'
docker inspect command-center:prod --format '{{.Os}}/{{.Architecture}}'
```

Attendu : les deux `org.opencontainers.image.{version,revision}` renseignés, et `linux/amd64`.

Nommer l'archive d'après la version (`command-center-<version>.tar`), jamais `prod` : un `.tar`
nommé `prod` devient ambigu à la seconde archive.

### 3. L'échelon de retour arrière — AVANT le `load`, jamais après

```bash
# Sur le NAS. <installée> = la version qui tourne en ce moment.
sudo docker images command-center --format '{{.Tag}}  {{.ID}}'
sudo docker tag command-center:prod command-center:<installée>
```

⚠️ **Regarder les ID avant de taguer.** Si un tag `<installée>` existe déjà et pointe **ailleurs**
que `prod`, cette commande l'écrase — elle détruirait l'échelon qu'elle est censée créer. Deux tags
qui portent le **même ID** désignent la même image : il n'y a alors rien à faire.

Pourquoi c'est indispensable, dit par Docker lui-même au `load` suivant :

```
The image command-center:prod already exists, renaming the old one with ID sha256:… to empty string
```

L'image précédente **perd son nom**. Sans le tag de version, elle est anonyme à cet instant —
récupérable par son ID quelques jours, puis ramassée par le garbage collector. L'échelon
n'existerait plus.

### 4. Sauvegarde, puis charger

Lancer la tâche de sauvegarde du §7 depuis le Planificateur, et **vérifier qu'un fichier neuf est
apparu** — pas seulement que la tâche s'est lancée.

```bash
ls -lh /volumeX/docker/command-center/command-center-<version>.tar   # la taille attendue, entière
sudo docker load -i /volumeX/docker/command-center/command-center-<version>.tar
sudo docker images command-center --format '{{.Tag}}  {{.ID}}'
```

⚠️ **S'arrêter ici et lire la sortie.** `prod` doit porter un **ID neuf**, et le tag de la version
précédente **son ID d'origine, inchangé**. S'il a bougé, ne pas redémarrer : l'échelon est perdu et
il ne reste que la sauvegarde de base.

Puis la commande du §9, et lire les journaux plutôt que les supposer :

```bash
sudo docker compose --env-file .env.production -f docker-compose.prod.yml ps
sudo docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=40 app
```

Trois choses s'y lisent, dans cet ordre : ce que l'`ENTRYPOINT` a fait des migrations
(`Already up to date` quand il n'y en a aucune), le démarrage du serveur HTTP, et l'absence
d'erreur SQL répétée — un provider de module qui tournerait contre une table absente en
enverrait une **à chaque tick** (CC-137). Attendre que `ps` affiche `(healthy)`, pas
`health: starting`.

### 5. La preuve, et elle n'est pas dans un terminal

Ouvrir `/reglages` : la version et le commit court doivent être ceux qu'on vient de construire.
C'est la seule vérification qui prouve que **ce qui tourne** est **ce qu'on croit avoir déployé** —
et depuis CC-151 elle ne demande plus de shell.

Vérifier aussi la **barre latérale** : Leitner, veille et agents doivent y être. Leur absence est
le symptôme de `MODULES`, et c'est le seul échec de cette liste que rien n'annonce.

### Revenir en arrière

```bash
sudo docker tag command-center:<installée> command-center:prod
sudo docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

⚠️ **Revenir à l'image ne fait pas revenir la base.** Ces deux lignes suffisent tant que la mise à
jour n'embarquait **aucune migration** — c'était le cas de la `1.2.0`, vérifié avant de partir et
confirmé par `Already up to date` au démarrage. Une migration **additive** (une table en plus,
`account_reset_events`) passe encore : l'image précédente ignore ce qu'elle ne connaît pas. Une
migration qui **déplace** des colonnes — CC-119 — rend l'image précédente **incapable de lire sa
propre base**, et le retour arrière devient une restauration de dump, pas un re-tag.

C'est la seule raison pour laquelle l'étape 1 commence par chercher les migrations : elle ne décide
pas si on peut mettre à jour, elle décide de ce que « revenir » coûtera.

## 10. Ce que ce déploiement ne fait pas

- **Aucune surveillance, aucune alerte.** Si le conteneur tombe à 3 h du matin, personne ne le
  sait. `restart: unless-stopped` couvre le crash, pas la panne silencieuse. Acceptable pour
  un tableau de bord personnel montré à des collègues — **à condition de le savoir**, et de ne
  pas y mettre plus tard quelque chose dont on dépendrait. Seul l'e-mail du cron de sauvegarde
  (§7) est surveillé, et il ne couvre que la sauvegarde.
- **Pas de mise en production au sens propre** : rien ne construit ni ne publie l'image
  automatiquement, et le déploiement n'est pas reproductible — il dépend d'un PC et de gestes
  faits à la main. Une CI **de garde** existe depuis CC-149 (elle rejoue typecheck, lint et les
  deux suites à chaque PR) mais elle ne construit aucune image : c'est le point 5 de CC-142.
  Le retour arrière, lui, existe désormais — **écrit, pas outillé** : c'est la chaîne de tags du
  §9 bis, et elle demande de s'en souvenir au bon moment.
- **Le module Services est hors service** (pas de socket Docker — l'écran l'annonce et ses
  actions sont neutralisées, CC-116) et **Agents** reste réservé à l'admin : leur usage réel
  se fait sur le poste de dev.
- **Le juge LLM et Immich dépendent de machines du LAN** : PC éteint, le juge se replie en
  silence — c'est voulu, la révision ne tombe jamais.
- **Les sessions expirent 7 jours après la connexion**, quelle que soit l'activité, et les
  liens d'invitation valent **48 h** : inviter un collègue, c'est aussi lui dire d'accepter
  vite.

## 11. Étendre au-delà du défaut — déclarer des agents, activer le module Services

Les deux ci-dessous restent **désactivés par défaut** sur ce déploiement (`MODULES=agents,veille,leitner`
ne cite pas `services` en §2, et le fichier d'agents n'est monté par aucune ligne active du
compose). Cette section documente comment les activer, et pour Services, **ce que ça coûte** —
en toutes lettres, pas dans un commentaire de compose que personne ne lit.

### 11.1 Déclarer des agents (CC-141)

Depuis CC-138, plus aucun seeder n'existe : sur une base neuve, le module Agents n'a **aucun**
moyen de créer un agent sans passer par `psql`. CC-141 remplace ça par un fichier JSON, lu au
démarrage du conteneur — jamais par une route, jamais modifiable depuis l'écran.

1. Créer le fichier sur le NAS, à partir du modèle du dépôt :
   ```bash
   cp agents.json.example /volumeX/docker/command-center/agents.json
   ```
   Éditer `command` pour chaque agent — c'est une commande shell exécutée **telle quelle**
   (`AgentRunnerService`, voir `app/modules/agents/CLAUDE.md`) : quiconque peut écrire ce fichier
   a déjà accès à la machine, donc au pouvoir que la commande confère.
2. Renseigner `AGENTS_CONFIG_PATH_HOST=/volumeX/docker/command-center/agents.json` dans
   `.env.production`.
3. Décommenter la ligne de volume correspondante dans `docker-compose.prod.yml` (celle qui monte
   `${AGENTS_CONFIG_PATH_HOST}` sur `/data/agents.json`). ⚠️ **Dans cet ordre** : décommenter la
   ligne avant que le fichier hôte existe fait monter un DOSSIER vide à la place (comportement
   Docker sur un bind-mount dont la source est absente) — l'application lirait alors un dossier
   là où elle attend un fichier, ce qui compte comme un fichier **malformé** (synchronisation
   abandonnée, log d'erreur), pas comme une absence.
4. Relancer la pile (§9). Les journaux annoncent la synchronisation :
   ```bash
   sudo docker compose --env-file .env.production -f docker-compose.prod.yml logs app | grep -i agents
   ```
   `created`/`updated`/`deleted` y apparaissent ; `deleted` compte les agents retirés du fichier
   depuis le dernier démarrage — **la synchronisation est déclarative** : un agent qui n'est plus
   dans le fichier est supprimé de la base, logs compris. Retirer un agent du fichier est donc un
   geste définitif, pas une mise en pause.

### 11.2 Activer le module Services — le socket Docker, et ce qu'il donne

Monter `/var/run/docker.sock` dans le conteneur applicatif revient à donner **un accès root à
cette machine** au processus qui sert aussi les requêtes HTTP de l'application — le même
conteneur qui exécute déjà `agent.config.command` telle quelle pour le module Agents. Les deux
pouvoirs s'additionnent : quiconque compromettrait l'un obtiendrait l'autre gratuitement.

C'est cette accumulation, précisément, que la décision CC-73 a refusée pour le NAS du
propriétaire — le module Services y reste hors service en permanence (§10). Rien n'empêche
techniquement un autre déploiement de l'activer :

1. Ajouter `services` à `MODULES` dans `.env.production`.
2. Décommenter la ligne `/var/run/docker.sock:/var/run/docker.sock` dans
   `docker-compose.prod.yml`.
3. Poser `DOCKER_AVAILABLE=true` dans `.env.production` (sans elle, le module reste « hors
   service » même socket monté — §10, `config/docker.ts`).
4. Relancer la pile (§9).

⚠️ **Ce document ne couvre pas les permissions Unix du socket** (utilisateur/groupe du process
dans le conteneur face au propriétaire de `/var/run/docker.sock` sur l'hôte) — spécifique à
chaque NAS, à régler au cas par cas si `docker ps` échoue depuis l'écran `/services` une fois
monté.
