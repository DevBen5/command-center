---
name: triage-youtrack
description: |
  Passe en revue les issues du projet CC pour repérer ce qui manque de priorité, de type ou
  d'assigné, et produit une synthèse triée — aucune écriture sans confirmation explicite.
  Trigger : `/triage-youtrack [filtre YouTrack optionnel]` — défaut `project: CC State: Open`.
---

# /triage-youtrack — Triage rapide du backlog CC

## Invocation

```
/triage-youtrack
/triage-youtrack project: CC Type: Bug State: Open
```

Sans argument : `project: CC State: Open`. Un argument **remplace** le filtre par défaut, ne le
complète pas.

## Champs du projet CC

Mis en cache le 2026-08-04 via `get_issue_fields_schema` — revérifier si le projet a changé depuis.

- **Type** : Bug · Epic · User Story · Task
- **State** : Open · In Progress · To Verify · Done · Duplicate
- **Priority** : Show-stopper · Critical · Major · Normal · Minor

## Étapes

1. `mcp__youtrack__search_issues` avec le filtre, `customFieldsToReturn: ["Type","State","Priority","Assignee"]`
   — rien de plus, la description et les commentaires ne servent pas au triage.
2. Si le résultat touche le plafond de 20, repaginer avec `offset` jusqu'à épuisement plutôt que
   de s'arrêter aux 20 premiers.
3. **Au-delà d'une quinzaine d'issues à trier**, délègue à un sous-agent (`Agent`,
   `subagent_type: general-purpose`, premier plan) qui fait la recherche paginée et ne renvoie que
   la synthèse (étape 4) suivie d'une ligne `[stats] items=<N> source_chars=<M>` (`M` = somme des
   caractères reçus sur les `search_issues`) — sert au journal de l'étape 6. En dessous de ce
   volume, fais-le inline.
4. Synthèse groupée par ce qui manque, pas par issue :
   - Sans Priority
   - Sans Assignee (hors Epic)
   - Type manquant ou incohérent avec le Summary
   - Doublons probables (summaries très proches)
5. **Ne modifie rien de toi-même.** Propose des valeurs (« CC-88 : pas de Priority, ressemble à un
   Bug Major ») et attends une confirmation explicite avant tout `update_issue` — un appel par item
   confirmé, jamais un lot silencieux.
6. **Journaliser** — format détaillé dans `/youtrack-stats`. Résous la date (`date +%F`) puis :
   ```bash
   cat >> .claude/youtrack-usage.log <<'JSONLINE'
   {"date":"2026-08-04","skill":"triage-youtrack","delegated":false,"items":8,"summary_chars":410,"source_chars_est":410,"notes":"5 sans Priority, 1 doublon probable"}
   JSONLINE
   ```
   `delegated`/`items`/`source_chars_est` reflètent l'étape 3 réelle (sous-agent ou inline) ;
   `summary_chars` = longueur du texte montré à l'utilisateur.
