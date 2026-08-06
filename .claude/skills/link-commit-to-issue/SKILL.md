---
name: link-commit-to-issue
description: |
  Relie un commit déjà créé au ticket CC qu'il concerne, par un commentaire sur le ticket
  (hash + résumé + lien GitHub) — le footer `CC-XX` du commit ne se voit que depuis git.
  Trigger : `/link-commit-to-issue [sha]` — défaut `HEAD`.
disable-model-invocation: true
---

# /link-commit-to-issue — Relier un commit à son ticket

## Invocation

```
/link-commit-to-issue
/link-commit-to-issue 4bc2efc
```

Sans argument : `HEAD`.

## Étapes

1. `git log -1 --format=%H%n%s%n%b <sha>` — hash complet, sujet, footer.
2. Extrait le `CC-XX` du footer (footer nu, jamais `Refs: #CC-XX` dans ce dépôt — voir
   `CLAUDE.md`). **Pas de `CC-XX` trouvé → arrête-toi et demande-le**, ne devine jamais le ticket.
3. Construit l'URL : `https://github.com/DevBen5/command-center/commit/<hash complet>`.
4. **Affiche le commentaire qui serait posté et attends confirmation** — poster sur un ticket est
   une action visible, jamais silencieuse, même pour une simple traçabilité.
5. Une fois confirmé : `mcp__youtrack__add_issue_comment` sur `CC-XX`, texte bref (sujet du commit
   + lien). N'utilise `link_issues` que si le commit référence explicitement un autre ticket (ex.
   dépendance) — pas pour le lien commit→ticket lui-même, qui n'est pas une entité liable.
6. **Journaliser** — format détaillé dans `/youtrack-stats`. Pas de sous-agent ici : `delegated`
   reste `false`. Résous la date (`date +%F`) puis :
   ```bash
   cat >> .claude/youtrack-usage.log <<'JSONLINE'
   {"date":"2026-08-04","skill":"link-commit-to-issue","delegated":false,"items":1,"summary_chars":180,"source_chars_est":180,"notes":"CC-160, commit 4bc2efc"}
   JSONLINE
   ```
