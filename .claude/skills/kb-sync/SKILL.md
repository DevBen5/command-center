---
name: kb-sync
description: |
  Passe en revue la base de connaissances YouTrack du projet Command Center (articles `CC-A-1`
  à `CC-A-13`) et corrige ce qui a cessé d'être vrai depuis le dernier passage. Balaie la KB en
  entier depuis le sommaire `CC-A-1`, compare chaque article aux `CLAUDE.md`/code qu'il
  synthétise, met à jour en place (jamais recréé) et signale ce qui reste sans article.
  Trigger : `/kb-sync` — déclenché **à la main**, jamais automatiquement. Extrait de l'étape 7
  de `/review-mr` (2026-08-03) pour ne plus peser sur chaque PR mergée.
---

# /kb-sync — Synchroniser la base de connaissances YouTrack

## Invocation

```
/kb-sync
```

Déclenché **à la main**, quand tu juges que la KB a pris du retard — après une ou plusieurs PR,
en fin de session, périodiquement. Rien ne l'appelle automatiquement : ni `/review-mr`, ni un
merge, ni un `git push`.

> Ce skill existait comme étape 7 de `/review-mr`, systématique après chaque merge. Détaché le
> 2026-08-03 : relire les 13 articles à chaque PR pesait en tokens sur un geste qui doit rester
> léger. La logique n'a pas changé, seul le déclenchement est devenu volontaire.

---

## Pourquoi cette étape existe

La base de connaissances (`CC-A-1` racine + ses enfants) **synthétise** les `CLAUDE.md`, la
mémoire de travail et le backlog — avec des pointeurs, jamais une copie. Rien ne la synchronise
automatiquement avec le dépôt : un changement qui touche ce qu'elle décrit la fait **dériver en
silence**, et elle continue de décrire un dépôt qui n'existe plus.

⚠️ **Le dépôt fait autorité contre la KB.** Quand les deux divergent, c'est l'article qu'on
corrige, jamais le code.

---

## Étapes

1. **Balayer la KB en entier, pas seulement les articles « du sujet ».** Énumérer depuis le
   sommaire — `CC-A-1` liste tous les autres ; la liste grandit, ne pas la figer ici — puis
   `get_article` sur **chacun**. Un changement déborde souvent de son module : CC-78 (auth) avait
   périmé l'article Sécurité **et** l'article Backlog. Un `search_articles` par mots-clés ne
   trouve que ce qu'on a pensé à chercher — il sert à naviguer, pas à garantir la couverture.
2. Pour chaque article, une seule question : **ce qu'il affirme est-il encore vrai ?** Un état de
   ticket, un « reste ouvert », un compte, une garantie décrite. Ce qui est devenu faux se
   **corrige en place** (`update_article`) ; ce qui reste vrai ne se touche pas.
3. **Adapter n'est pas grossir.** Mettre à jour, jamais recréer : la KB pointe vers les
   `CLAUDE.md` et les tickets, elle ne les recopie pas — si un `CLAUDE.md` a gagné une section,
   l'article la résume en une phrase et pointe vers elle. Un passage ordinaire se solde par
   **zéro ou quelques retouches** : n'ajouter du contenu que si quelque chose de nouveau doit
   être dit — une garantie nouvelle, une frontière déplacée, une décision actée. Jamais de
   section nouvelle « parce qu'il y a eu des commits ».
4. **Si un sujet pertinent n'est couvert par aucun article** : ne pas en créer d'office — le
   signaler et laisser le mainteneur décider. La granularité de la KB est un choix éditorial, pas
   un automatisme.
5. Terminer par un résumé court : **quels articles ont été relus, lesquels mis à jour, et
   pourquoi.**

---

## Coût en tokens — pourquoi ce skill reste manuel

13 articles × `get_article` (jusqu'à 500 lignes chacun par défaut) est le geste le plus coûteux
du dépôt sur ce MCP. Deux leviers à appliquer systématiquement ici :
- Sur les gros articles, cibler avec `linesOffset`/`linesCount` quand la section pertinente est
  connue plutôt que tirer l'article en entier.
- Ne pas répéter ce balayage dans la même session si rien n'a changé entre deux passages.
