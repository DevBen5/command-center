---
name: prepare-issue-context
description: |
  Aperçu rapide d'une issue CC avant de s'y mettre — résumé, état, description. Commentaires,
  historique et articles KB liés ne sont tirés que sur demande explicite, jamais par défaut.
  Trigger : `/prepare-issue-context CC-XX`. Complément léger de `/task-flow`, pas un remplacement.
---

# /prepare-issue-context — Aperçu léger d'une issue

## Invocation

```
/prepare-issue-context CC-88
```

## Étapes

1. `mcp__youtrack__get_issue` avec `recentCommentsCount: 0` — summary, description, State, Type,
   Priority, Assignee. Pas de commentaires à ce stade.
2. Restitue en 5-6 lignes : quoi, état actuel, qui, et si la description suffit pour démarrer ou
   s'il manque quelque chose d'évident.
3. **Ne va pas plus loin sans qu'on te le demande.** Pour l'historique de discussion :
   `mcp__youtrack__get_issue_comments` (déjà pagé, 10 par appel) en second appel explicite. Pour un
   lien KB : `search_articles query: "project: CC <mots-clés>"` d'abord — un `get_article` complet
   seulement si l'extrait ne suffit pas.
4. Si l'utilisateur veut réellement démarrer le ticket (pas juste le survoler), oriente vers
   `/task-flow CC-XX` plutôt que de dupliquer sa logique ici.
5. **Journaliser** — format détaillé dans `/youtrack-stats`. Pas de sous-agent ici : `delegated`
   reste `false`, `source_chars_est` égale `summary_chars` (rien à mesurer comme gain, seulement la
   fréquence d'usage). Résous la date (`date +%F`) puis :
   ```bash
   cat >> .claude/youtrack-usage.log <<'JSONLINE'
   {"date":"2026-08-04","skill":"prepare-issue-context","delegated":false,"items":1,"summary_chars":320,"source_chars_est":320,"notes":"CC-88, commentaires non tirés"}
   JSONLINE
   ```
