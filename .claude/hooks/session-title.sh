#!/usr/bin/env bash
# Nomme la session d'après le ticket porté par le nom de la branche git, en allant
# chercher son vrai titre dans YouTrack.
#
#   feat/CC-33-tests-composants  →  « Ticket CC-33 - Aucun test de composant Vue… »
#   refactor/feature-modules     →  rien : le harness garde son nom auto-dérivé
#
# Branché sur SessionStart, le seul événement qui expose `sessionTitle` (équivalent d'un
# `/rename`). Il n'existe aucun outil permettant au modèle d'invoquer une commande slash :
# hors de ce hook, seul le dev peut renommer, à la main. La branche est donc la seule
# information disponible au moment où le titre peut encore être posé.

set -u

payload=$(cat)

branch=$(git -C "${CLAUDE_PROJECT_DIR:-.}" rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0
[ -n "$branch" ] || exit 0

# Un `/rename` manuel prime : on n'écrase un titre existant qu'au démarrage à froid,
# jamais sur un `resume` ou un `fork` — sinon reprendre une session perdrait son nom.
if ! printf '%s' "$payload" | grep -qE '"source"[[:space:]]*:[[:space:]]*"startup"'; then
  printf '%s' "$payload" | grep -qE '"session_title"[[:space:]]*:[[:space:]]*"[^"]+"' && exit 0
fi

raw=$(printf '%s' "$branch" | grep -oiE '[A-Za-z]{2,}-[0-9]+' | head -n 1)
[ -n "$raw" ] || exit 0
ticket=$(printf '%s' "$raw" | tr '[:lower:]' '[:upper:]')

# Jeton et instance sont lus dans la config du serveur MCP youtrack déjà en place, pour
# qu'aucun secret n'atterrisse dans ce fichier-ci, qui est versionné.
config="${HOME:-}/.claude.json"
[ -r "$config" ] || exit 0
entry=$(sed -n '/"youtrack"[[:space:]]*:/,/^  }/p' "$config")
auth=$(printf '%s' "$entry" | grep -oE '"Authorization"[[:space:]]*:[[:space:]]*"Bearer [^"]+"' |
  head -n 1 | sed -E 's/.*"(Bearer [^"]+)"/\1/')
base=$(printf '%s' "$entry" | grep -oE '"url"[[:space:]]*:[[:space:]]*"https://[^"]+"' |
  head -n 1 | sed -E 's|.*"(https://[^"]+)"|\1|; s|/mcp$||')
{ [ -n "$auth" ] && [ -n "$base" ]; } || exit 0

# `-m 3` : le hook n'a que 5 s. Une instance injoignable ne doit pas retarder le démarrage.
response=$(curl -s -m 3 -H "Authorization: $auth" -H 'Accept: application/json' \
  "$base/api/issues/$ticket?fields=summary" 2>/dev/null)
reachable=$?

summary=$(printf '%s' "$response" |
  grep -oE '"summary"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' |
  head -n 1 | sed -E 's/^"summary"[[:space:]]*:[[:space:]]*"//; s/"$//')

if [ -n "$summary" ]; then
  title="Ticket $ticket - $summary"
elif [ "$reachable" -ne 0 ]; then
  # YouTrack injoignable : l'ID seul, plutôt que rien.
  title="Ticket $ticket"
else
  # YouTrack a répondu et ne connaît pas cet ID : ce n'en était pas un (`module-2`,
  # `v2-3`…). Ne pas baptiser la session d'après un ticket qui n'existe pas.
  exit 0
fi

# `tr -d` retire les deux seuls caractères qui casseraient le JSON produit juste après.
title=$(printf '%s' "$title" | tr -d '"\\' | tr -d '\r\n')

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","sessionTitle":"%s"}}\n' "$title"
