---
name: summarize-sprint
description: |
  Résume l'état du backlog CC (par état, type, priorité) sur un périmètre donné — projet entier,
  epic, ou filtre libre. Tourne systématiquement dans un sous-agent, seule la synthèse revient.
  Trigger : `/summarize-sprint [filtre YouTrack optionnel]`.
---

# /summarize-sprint — Résumé du backlog CC

## Invocation

```
/summarize-sprint
/summarize-sprint project: CC subtask of: CC-135
```

Sans argument : `project: CC`, tous états confondus.

## Étapes

1. **Toujours déléguer** — `Agent`, `subagent_type: general-purpose`, premier plan (le résultat est
   nécessaire avant de répondre). C'est le plus lourd des cinq skills YouTrack du dépôt :
   potentiellement plusieurs dizaines d'issues, jamais inline.
2. Prompt du sous-agent : `mcp__youtrack__search_issues` avec le filtre,
   `customFieldsToReturn: ["Type","State","Priority"]`, paginé par `offset` — le plafond de 20 par
   appel est une taille de page, pas une limite de couverture ; continuer jusqu'à épuisement.
3. Le sous-agent agrège et ne renvoie QUE :
   - Comptes par State, par Type, par Priority
   - Les issues `Show-stopper`/`Critical` nommément (jamais noyées dans un total)
   - Ce qui ressort de la liste sans appel supplémentaire (pas de `get_issue` par item)
   - Aucun brouillon issue-par-issue, aucune description, aucun commentaire
   - Une ligne finale `[stats] items=<N> source_chars=<M>` (`M` = somme des caractères reçus sur
     tous les `search_issues`) — sert au journal de l'étape 5.
4. Si le périmètre est vide (filtre trop restrictif), le sous-agent le dit directement — pas de
   relance automatique avec un filtre élargi sans le signaler.
5. **Journaliser** — format détaillé dans `/youtrack-stats`. Résous la date (`date +%F`) puis :
   ```bash
   cat >> .claude/youtrack-usage.log <<'JSONLINE'
   {"date":"2026-08-04","skill":"summarize-sprint","delegated":true,"items":34,"summary_chars":610,"source_chars_est":9200,"notes":"epic CC-135, 8 states"}
   JSONLINE
   ```
   `items`/`source_chars_est` viennent de la ligne `[stats]` du sous-agent, `summary_chars` de la
   longueur du texte réellement montré à l'utilisateur.
