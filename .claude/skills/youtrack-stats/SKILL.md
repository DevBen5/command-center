---
name: youtrack-stats
description: |
  Agrège le journal d'usage des skills YouTrack (`.claude/youtrack-usage.log`) et rapporte le
  volume traité, la part déléguée à un sous-agent, et la réduction de contexte estimée.
  Trigger : `/youtrack-stats`.
---

# /youtrack-stats — Suivi des skills YouTrack

## Format du journal

Chaque skill YouTrack du dépôt (`kb-sync`, `triage-youtrack`, `create-issue-from-code`,
`summarize-sprint`, `link-commit-to-issue`) ajoute une ligne à
`.claude/youtrack-usage.log` (JSONL, un objet par ligne, fichier **non versionné** — voir
`.gitignore`) après chaque invocation :

```json
{"date":"2026-08-04","skill":"kb-sync","delegated":true,"items":13,"summary_chars":842,"source_chars_est":32480,"notes":"2 articles mis à jour"}
```

- `date` : `YYYY-MM-DD`, résolu via `date +%F` avant d'écrire la ligne — jamais deviné, jamais
  `$(...)` dans le JSON (le heredoc `'JSONLINE'` utilisé pour écrire ne l'interpole pas).
- `delegated` : le skill a-t-il tourné dans un sous-agent (`Agent`, `subagent_type:
  general-purpose`) pour cette invocation précise.
- `items` : nombre d'éléments traités (articles, issues) — `1` pour les skills à item unique
  (`create-issue-from-code`, `link-commit-to-issue`).
- `summary_chars` : taille en caractères de ce qui est **réellement revenu** dans la conversation
  principale — la synthèse quand `delegated` est `true`, la réponse complète sinon.
- `source_chars_est` : volume brut lu. Égal à `summary_chars` quand `delegated` est `false` (rien
  n'a été évité, pas de gain à mesurer). Quand `delegated` est `true`, c'est le **sous-agent** qui
  le rapporte : il compte la longueur de ce qu'il reçoit à chaque appel MCP et donne un total sur
  une ligne dédiée en fin de réponse — `[stats] items=<N> source_chars=<M>` — séparée de la
  synthèse qu'il produit pour l'orchestrateur.
- `notes` : libre, une phrase.

⚠️ **`source_chars_est` est une estimation par caractères, pas un compte de tokens exact.** Le
ratio ~4 caractères/token est une approximation grossière — assez pour voir une tendance, pas pour
un budget précis.

⚠️ **Ce journal ne mesure rien pour les skills sans sous-agent** (`create-issue-from-code`,
`link-commit-to-issue`) au-delà de la fréquence d'usage. Ils logguent
`delegated: false`, `source_chars_est == summary_chars` : aucune réduction à en attendre, ce n'est
pas leur rôle — ils étaient déjà légers par construction (un seul item, champs minimaux).

## Invocation

```
/youtrack-stats
```

## Étapes

1. Lire `.claude/youtrack-usage.log`. **Absent ou vide → le dire explicitement** (« aucune
   invocation enregistrée pour l'instant ») plutôt que d'inventer une tendance sur zéro donnée.
2. Agréger par skill : nombre d'invocations, part déléguée (`delegated: true` / total), somme de
   `summary_chars` (ce qui a atteint le contexte principal), somme de `source_chars_est` (ce qui
   aurait pu l'atteindre sans délégation).
3. Réduction = `1 - Σ summary_chars / Σ source_chars_est`, affichée **seulement** quand
   `source_chars_est` dépasse `summary_chars` sur au moins une ligne déléguée. Sinon `N/A`, jamais
   `0 %` — `N/A` veut dire « pas encore de délégation mesurée », `0 %` voudrait dire « délégué mais
   sans le moindre gain », ce n'est pas la même affirmation.
4. Rapport en table compacte, une ligne par skill :

   | Skill | Invocations | % délégué | Caractères entrés dans le contexte | Caractères évités (est.) | Réduction |
   |---|---|---|---|---|---|

5. **Ne pas extrapoler au-delà des données.** Un skill jamais invoqué reste listé avec
   `0 invocation`, pas absent de la table — ça montre ce qui reste à valider en usage réel autant
   que ce qui l'a déjà été.
6. Termine par une phrase de lecture honnête : ce que ces chiffres prouvent (le volume qui n'a pas
   atteint le contexte principal) et ce qu'ils ne prouvent pas (le coût total réellement dépensé
   par les sous-agents, qui n'est pas réduit — seulement déplacé hors de la conversation longue).
