# syntax=docker/dockerfile:1

# =============================================================================
# Command Center — image de PRODUCTION
#
# Multi-stage : un étage `build` qui compile back (TypeScript) ET front (Vite)
# avec TOUTES les dépendances, un étage `production` qui n'emporte que le dossier
# `build/` et les dépendances de production. L'image finale ne contient ni les
# sources, ni les devDependencies, ni le moindre secret (voir .dockerignore).
#
# Construire pour la machine courante (poste de dev, NAS DS918+ = amd64) :
#   docker build \
#     --build-arg APP_VERSION=$(node -p "require('./package.json').version") \
#     --build-arg APP_COMMIT=$(git rev-parse --short HEAD) \
#     -t command-center:prod .
#
# Construire les DEUX architectures publiées (CC-142) — c'est ce que fait
# .github/workflows/release.yml sur un tag, et la seule façon de le reproduire à la
# main. `buildx` refuse `--load` sur plusieurs plateformes à la fois : soit on pousse
# (`--push`), soit on ne construit qu'une plateforme.
#   docker buildx build --platform linux/amd64,linux/arm64 \
#     --build-arg APP_VERSION=$(node -p "require('./package.json').version") \
#     --build-arg APP_COMMIT=$(git rev-parse --short HEAD) \
#     -t ghcr.io/devben5/command-center:X.Y.Z --push .
#
# ⚠️ Rien dans ce fichier n'est spécifique à une architecture : `node:22-alpine` est
# un manifeste multi-arch, et `apk add postgresql16-client` résout par architecture.
# C'est ce qui rend le multi-arch possible sans variante de Dockerfile — mais la
# construction arm64 sur une machine amd64 passe par QEMU, donc `npm ci` et
# `node ace build` y sont NETTEMENT plus lents (émulation, pas compilation croisée).
#
# ⚠️ **Construire arm64 EN LOCAL exige que QEMU soit enregistré dans le noyau**, ce que
# la CI fait à chaque job (`docker/setup-qemu-action`) et qu'un poste ne fait pas :
#   docker run --privileged --rm tonistiigi/binfmt --install arm64
# Sans ça, le build échoue sur `exec /bin/sh: exec format error` au premier binaire
# arm64 — message qui n'accuse ni ce fichier ni le dépôt.
#
# ⚠️ Et sur Docker Desktop, **cet enregistrement ne tient pas** : constaté deux fois le
# 2026-08-05 (CC-142), il a disparu EN COURS de build — une fois en produisant un
# `npm error code ENOEXEC / spawn` dans l'étage `production`, c'est-à-dire un message qui
# ressemble à une incompatibilité arm64 alors que ce n'en est pas une, et une fois en
# `exec format error` après 100 s de `node ace build` arm64 réussies. **Le build arm64
# complet passe (EXIT=0)** en réinstallant le binfmt juste avant, cache chaud, donc
# fenêtre d'émulation courte. Si un build multi-arch local échoue bizarrement à
# mi-parcours : réinstaller et relancer AVANT de chercher la cause dans ce fichier ou
# dans une dépendance. La CI n'a pas ce problème — chaque job repart d'une VM neuve où
# `setup-qemu-action` enregistre l'émulation au début.
# =============================================================================

# -----------------------------------------------------------------------------
# Étage 1 — build : compile le back (`node ace build`) et le front. Les
# devDependencies sont nécessaires ICI : vite, le plugin Vue et Tailwind tournent
# pendant `node ace build` via le hook `onBuildStarting` d'adonisrc.ts.
# -----------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Couche de dépendances séparée : tant que package*.json ne bouge pas, ce `npm ci`
# reste en cache même quand le code applicatif change.
COPY package.json package-lock.json ./
RUN npm ci

# Le reste des sources (ce que .dockerignore laisse passer).
COPY . .

# Compile vers ./build : ace.js, bin/, code transpilé, package*.json, et les
# metaFiles (public/**, resources/views, resources/lang) déclarés dans adonisrc.ts.
RUN node ace build

# -----------------------------------------------------------------------------
# Étage 2 — production : n'emporte que build/ + les dépendances de production.
# -----------------------------------------------------------------------------
FROM node:22-alpine AS production
WORKDIR /app

# Métadonnées de l'image (CC-130 point 2, CC-151) — deux ARG, deux sources distinctes.
# APP_VERSION est lu par la commande de build depuis package.json : le LABEL reflète alors
# exactement ce que l'image DEVRAIT porter. APP_COMMIT vient de git, sur la machine qui
# construit — le `.git` du dépôt n'entre jamais dans le contexte de build (.dockerignore).
# Seul APP_COMMIT est promu en variable d'environnement : c'est la seule des deux valeurs que
# l'application relit elle-même (`/reglages`). La version qu'affiche cet écran vient
# directement de package.json une fois copié dans l'image plus bas, PAS de cet ARG — elle
# reste donc correcte même si l'opérateur se trompe en construisant.
ARG APP_VERSION
ARG APP_COMMIT

LABEL org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${APP_COMMIT}"

ENV APP_COMMIT=${APP_COMMIT}

# Valeurs par défaut de production. Toutes surchargeables par le `env_file` du
# compose ; APP_KEY et les identifiants DB, eux, DOIVENT venir de l'environnement
# (le démarrage échoue sinon — voir start/env.ts).
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=:: \
    LOG_LEVEL=info \
    SESSION_DRIVER=cookie

# `pg_dump`/`psql` pour `node ace db:backup`/`db:restore` (CC-140) : la sauvegarde tourne DANS ce
# conteneur, en connexion TCP directe vers Postgres — pas de démon Docker à sa disposition (voir
# docker-compose.prod.yml). Quelques Mo sur Alpine.
#
# ⚠️ **`postgresql-client` nu installe la dernière version packagée par Alpine (18 au moment
# d'écrire ceci), pas celle du serveur (`postgres:16-alpine`).** Constaté en vérification réelle
# (CC-140) : un dump produit par `pg_dump` 18 embarque `SET transaction_timeout = ...`, un réglage
# serveur qui n'existe qu'à partir de PG 17 — `psql` 16 le refuse à la restauration
# (`unrecognized configuration parameter`), la base à moitié restaurée. `postgresql16-client` fixe
# la version du CLIENT sur celle du serveur, explicitement, plutôt que de suivre le défaut Alpine
# au gré des mises à jour de l'image.
RUN apk add --no-cache postgresql16-client

# ImageMagick pour les vignettes serveur du catalogue NAS du coffre (CC-228). `sharp` a été écarté
# après mesure réelle : ses binaires précompilés n'embarquent pas le codec HEVC (raisons de brevet),
# donc ne lisent jamais un `.heic` réel. `imagemagick-heic`/`imagemagick-jpeg`/`imagemagick-webp`
# sont des paquets séparés du coder de base (résolus par architecture par `apk`, même mécanisme que
# `postgresql16-client` ci-dessus — aucun axe multi-arch nouveau). La policy copiée juste après
# ferme la famille de faille ImageTragick (voir son en-tête) ; le code applicatif force en plus
# toujours le coder par préfixe, jamais un chemin nu (`nas_thumbnail_generator.ts`).
RUN apk add --no-cache imagemagick imagemagick-heic imagemagick-jpeg imagemagick-webp
COPY docker/coffre-imagemagick-policy.xml /etc/ImageMagick-7/policy.xml

# ffmpeg pour la lecture vidéo du coffre (CC-241) — le SECOND binaire natif de l'image, après
# ImageMagick. Le mécanisme est le même que les deux `apk add` ci-dessus (résolution par
# architecture, aucun axe multi-arch nouveau), et il a été MESURÉ dans les deux, pas supposé :
#
#   docker run --rm --platform linux/amd64 node:22-alpine sh -c 'apk add --no-cache ffmpeg && ffmpeg -hwaccels'
#   docker run --rm --platform linux/arm64 node:22-alpine sh -c 'apk add --no-cache ffmpeg && ffmpeg -hwaccels'
#
# amd64 : ffmpeg 8.1.2, `-hwaccels` = vdpau/vaapi/**qsv**/drm/vulkan, encodeur `h264_vaapi` présent,
# décodeur `hevc` présent. arm64 (sous QEMU) : même version, même `h264_vaapi`, même décodeur `hevc`
# — mais **`qsv` est ABSENT**, Quick Sync étant une technologie x86. C'est sans conséquence : le code
# vise VAAPI (`nas_video_playback.ts`), présent sur les deux, et VAAPI est justement la couche par
# laquelle Quick Sync s'utilise sur le J3455 du DS918+.
#
# ⚠️ **Le paquet apporte ffmpeg ET ffprobe** — les deux sont nécessaires : la sonde décide s'il faut
# transcoder, et c'est elle qui garantit qu'un MP4/H.264 déjà lisible n'est PAS transcodé.
#
# ⚠️ **Contrepartie MESURÉE, pas estimée : l'image passe de 604 Mo à 758 Mo (+154 Mo, +25 %).**
# Les binaires eux-mêmes pèsent moins de 1 Mo ; tout le reste est la centaine de bibliothèques de
# codecs qu'`apk` tire avec (`OK: 135.5 MiB in 123 packages`). Mesure faite en construisant deux
# fois le MÊME Dockerfile, avec et sans cette ligne, sur ce poste. C'est le prix d'un `docker pull`
# et d'un disque de NAS, pas d'une exécution — à connaître avant de proposer un troisième binaire.
#
# ⚠️ **Sans `/dev/dri` passé au conteneur, le transcodage tombe en repli LOGICIEL** — le code le
# détecte et le JOURNALISE au premier usage (`video_transcoder.ts`), parce que sinon la panne de
# performance qui en résulte sur un Celeron est invisible et cherchée au mauvais endroit. Voir
# `docker-compose.install.yml` pour la ligne `devices:` à décommenter.
RUN apk add --no-cache ffmpeg

# Le résultat du build, puis SEULEMENT les dépendances de production (le build a
# recopié package.json + package-lock.json à la racine de build/).
COPY --from=build /app/build ./
RUN npm ci --omit=dev && npm cache clean --force

# Ne pas tourner en root : l'app n'écrit rien sur le disque (sessions cookie, logs
# sur stdout, contenu en base). L'image node fournit déjà l'utilisateur `node`.
USER node

EXPOSE 8080

# Joue les migrations en attente PUIS remplace le shell par le CMD.
#   - `&&` : si une migration échoue, le conteneur s'arrête au lieu de servir un
#     schéma incomplet.
#   - `exec "$@"` : le serveur devient PID 1 et reçoit SIGTERM/SIGINT — arrêt
#     propre, les boucles de fond Leitner/veille se terminent.
#   - `--force` : obligatoire en prod (ace refuse une confirmation interactive).
# ⚠️ Sûr UNIQUEMENT parce que le déploiement est mono-conteneur (pas de replicas :
#    deux processus joueraient les migrations en concurrence).
ENTRYPOINT ["/bin/sh", "-c", "node ace migration:run --force && exec \"$@\"", "--"]
CMD ["node", "bin/server.js"]
