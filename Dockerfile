# syntax=docker/dockerfile:1

# =============================================================================
# Command Center — image de PRODUCTION
#
# Multi-stage : un étage `build` qui compile back (TypeScript) ET front (Vite)
# avec TOUTES les dépendances, un étage `production` qui n'emporte que le dossier
# `build/` et les dépendances de production. L'image finale ne contient ni les
# sources, ni les devDependencies, ni le moindre secret (voir .dockerignore).
#
# Construire pour le NAS (DS918+, Celeron J3455 = amd64) :
#   docker build --platform linux/amd64 -t command-center:prod .
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

# Valeurs par défaut de production. Toutes surchargeables par le `env_file` du
# compose ; APP_KEY et les identifiants DB, eux, DOIVENT venir de l'environnement
# (le démarrage échoue sinon — voir start/env.ts).
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=:: \
    LOG_LEVEL=info \
    SESSION_DRIVER=cookie

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
