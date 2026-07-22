#!/usr/bin/env bash
# Nomme la session d'après l'ID de ticket porté par le nom de la branche git.
#
#   feat/CC-58-taxonomie-leitner  →  « Ticket CC-58 - taxonomie leitner »
#   refactor/feature-modules      →  rien : le harness garde son nom auto-dérivé
#
# Branché sur SessionStart, le seul événement qui expose `sessionTitle` (équivalent
# d'un `/rename`). Il n'existe donc aucun moyen de renommer en cours de session :
# la branche est la seule source d'information disponible au démarrage.

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

# Ce qui suit l'ID sert de libellé. `tr -d` retire les deux seuls caractères qui
# casseraient le JSON produit plus bas ; le reste est déjà interdit dans un refname.
slug=$(printf '%s' "${branch#*"$raw"}" | tr '_-' '  ' | tr -d '"\\' | sed -E 's/^ +| +$//g')

if [ -n "$slug" ]; then
  title="Ticket $ticket - $slug"
else
  title="Ticket $ticket"
fi

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","sessionTitle":"%s"}}\n' "$title"
