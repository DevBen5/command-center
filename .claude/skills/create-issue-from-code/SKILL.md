---
name: create-issue-from-code
description: |
  Rédige un brouillon d'issue CC à partir du code/diff sous les yeux et le fait valider avant
  tout envoi — créer un ticket est une action visible, jamais silencieuse.
  Trigger : `/create-issue-from-code [contexte optionnel]`.
disable-model-invocation: true
---

# /create-issue-from-code — Ticket depuis le code

## Invocation

```
/create-issue-from-code
/create-issue-from-code le catch de AgentRunnerService avale une erreur Docker sans logguer
```

Sans argument : pars du diff courant (`git diff`, `git diff --staged`) ou de la sélection IDE.

## Champs du projet CC

Mis en cache le 2026-08-04 via `get_issue_fields_schema`.

- **Type** : Bug · Epic · User Story · Task
- **Priority** : Show-stopper · Critical · Major · Normal · Minor

## Étapes

1. Identifie le contexte : le diff/fichier en cause, ce qui cloche, `fichier:ligne` précis.
2. Rédige un brouillon complet en français :
   - **Summary** : une ligne, factuelle.
   - **Description** : le problème, où il est (`fichier:ligne`), pourquoi il compte. Pas de
     solution imposée sauf si évidente.
   - **Type** et **Priority** proposés, cohérents avec les valeurs ci-dessus.
3. **Affiche le brouillon complet et attends une confirmation explicite avant tout appel MCP.**
   Créer une issue est une action visible sur le tracker partagé — jamais d'envoi silencieux, même
   si le brouillon semble évident.
4. Une fois confirmé : `mcp__youtrack__create_issue` (`project: "CC"`, `summary`, `description`,
   `customFields: {"Type": ..., "Priority": ...}`). Donne l'ID et l'URL renvoyés.
5. Ne passe jamais l'issue à un état particulier et ne l'assigne à personne d'office — une
   nouvelle entrée arrive en `Open`, rien de plus.
6. **Journaliser** — format détaillé dans `/youtrack-stats`. Pas de sous-agent ici : `delegated`
   reste `false`. Si l'utilisateur décline la confirmation de l'étape 3, loggue quand même
   (`notes: "confirmation refusée"`) — savoir combien de brouillons n'aboutissent pas fait aussi
   partie du suivi. Résous la date (`date +%F`) puis :
   ```bash
   cat >> .claude/youtrack-usage.log <<'JSONLINE'
   {"date":"2026-08-04","skill":"create-issue-from-code","delegated":false,"items":1,"summary_chars":280,"source_chars_est":280,"notes":"CC-159 créée"}
   JSONLINE
   ```
