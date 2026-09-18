---
name: orchestrator
description: Orchestrer le backlog Command Center, la KB YouTrack et les conversations-ticket. Trigger : `/orchestrator`.
disable-model-invocation: true
---

# /orchestrator — Pilotage du projet

Utiliser ce skill uniquement dans une conversation d'orchestration, jamais pour exécuter un ticket isolé.

## Sources à charger

1. Lire `AGENTS.md`, puis les sections pertinentes de `docs/agent-reference.md`.
2. Lire le backlog via le MCP YouTrack et les articles KB concernés.
3. Considérer le dépôt comme source de vérité contre la KB.

## Coordination

- YouTrack porte les décisions, le plan validé, l'état et les résumés durables.
- Une conversation-ticket lit son issue, son guide de module et la documentation ciblée. Elle ne choisit pas seule le ticket suivant.
- Le board ne sert qu'à coordonner des agents actifs dans une même session ; il n'est jamais une mémoire durable.
- Utiliser `/plan-sync` quand il faut remettre à jour l'ordre du backlog. Utiliser `/kb-sync` quand la KB doit être vérifiée.

## Sortie

Produire une file de travail courte, justifiée par les dépendances et les risques. Les écritures YouTrack restent soumises à la confirmation explicite de l'utilisateur.
