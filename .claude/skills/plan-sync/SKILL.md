---
name: plan-sync
description: |
  Remet à jour le plan d'exécution du backlog — l'article `CC-A-14`, qui dit **quoi faire
  ensuite, dans quel ordre et pourquoi**, là où `CC-A-12` dit seulement ce qui existe.
  Deux phases : il rejoue d'abord `/kb-sync` (la KB doit être vraie avant qu'un plan puisse
  s'appuyer dessus), puis relit le backlog réel et réécrit le plan en place.
  Trigger : `/plan-sync` — déclenché **à la main**, jamais automatiquement, et depuis une
  conversation-orchestrateur : une conversation-ticket n'a pas vu le backlog.
---

# /plan-sync — Synchroniser le plan d'exécution

## Invocation

```
/plan-sync              # les deux phases : KB puis plan
/plan-sync --plan-seul  # saute la phase 1 si /kb-sync vient de tourner
```

⚠️ **Depuis une conversation-orchestrateur, jamais une conversation-ticket.** Le plan est un
document d'arbitrage : le rédiger depuis une conversation qui n'a vu qu'un ticket produirait un
ordre qui reflète ce ticket-là. C'est la même raison qui interdit à une conversation-ticket de
désigner le ticket suivant.

---

## Ce que ce skill met à jour, et ce qu'il ne touche pas

| article | ce qu'il porte | qui l'écrit |
| --- | --- | --- |
| `CC-A-12` | **Ce qui existe** — inventaire par famille, comptes mesurés | `/kb-sync` |
| `CC-A-14` | **Quoi faire ensuite, dans quel ordre, pourquoi** | **ce skill** |

⚠️ **Ne fusionne jamais les deux.** Un inventaire vieillit à chaque ticket créé ; un plan vieillit
à chaque arbitrage pris. Les mêmes 285 lignes ne peuvent pas porter les deux rythmes sans qu'on
cesse de savoir laquelle des deux moitiés est encore vraie.

⚠️ **`CC-A-14` se met à jour EN PLACE, jamais recréé.** Un article recréé perd son ID, donc tous
les liens qui le citent — à commencer par le sommaire `CC-A-1`.

---

## Phase 1 — la KB d'abord

Invoque **`/kb-sync`** par l'outil Skill et attends sa synthèse.

**Pourquoi cet ordre et pas l'inverse** : un plan s'appuie sur ce que la KB affirme. Écrire le
plan sur une KB périmée, c'est propager une erreur dans le document qui décide de ce qu'on fait
ensuite — le pire endroit où la mettre.

⚠️ **`/kb-sync` ne doit PAS porter `disable-model-invocation: true`.** Ce drapeau retire un skill
de la liste chargée à chaque session, et **empêche du même coup ce skill-ci de l'appeler** : la
phase 1 échouerait sans un mot. C'est exactement la raison pour laquelle CC-184 a laissé
`/git-commit` et `/lead-review` hors de son lot — `/task-flow` les atteint par l'outil Skill. Si
tu poses ce drapeau sur `/kb-sync`, tu dois d'abord retirer la phase 1 d'ici.

Passe cette phase avec `--plan-seul` **seulement** si `/kb-sync` vient de tourner dans la même
session. Dans le doute, la rejouer coûte moins cher qu'un plan bâti sur du faux.

---

## Phase 2 — relire le backlog réel

⚠️ **Le backlog se relit, il ne se déduit ni de la mémoire ni du plan précédent.** Il a bougé
trois fois dans la seule journée du 2026-08-06.

Passe par un **sous-agent** (`Agent`, `subagent_type: general-purpose`), même motif que
`/kb-sync` : le volume ne doit pas atteindre le contexte de l'orchestrateur, seule la synthèse y
entre.

Ce que le sous-agent rapporte, et rien de plus :

1. **Les items ouverts par priorité** — `Show-stopper`/`Critical`/`Major`, puis `Normal`, puis
   `Minor`. ⚠️ **Paginer jusqu'au bout** (`hasNextPage`), et écrire en anglais dans la requête
   (`Priority: Major`, `State: -Done`) même si YouTrack répond en français.
2. **Les items `En cours` et `À vérifier`** — ce sont les deux états qui mentent le plus : un
   `En cours` peut être bloqué depuis des semaines, un `À vérifier` peut avoir sa PR déjà mergée.
3. **Les parapluies** (Epics) et leurs enfants, pour établir les **ordres imposés**.
4. **Les liens `depends on` / `is required for`** — c'est la seule source des dépendances dures,
   et elle ne se devine pas depuis les titres.
5. **Les PR ouvertes** (`gh pr list`), avec leur ticket. Une PR ouverte n'est pas un ticket fini.

---

## Phase 3 — réécrire le plan

Relis `CC-A-14` en entier, puis réécris-le. Ce qu'il doit contenir, et dans cet ordre :

1. **L'en-tête d'instantané** — la date et le `master` du jour, plus le rappel que la vue *Issues*
   fait foi contre l'article.
2. **La file recommandée** — les 4 ou 5 prochains items, avec **une raison par ligne**. Une file
   sans raisons est un ordre qu'on ne peut ni contester ni périmer.
3. **Les chantiers**, un par parapluie, avec leur ordre interne et ce qui le rend obligatoire.
4. **Ce qui n'attend pas du code** — matériel, passage navigateur, merge, tag, `Done`. Les mettre
   dans la file les y bloquerait indéfiniment.
5. **Les candidats sans ordre imposé**, présentés comme des directions, jamais comme un
   classement.
6. **Ce que le plan ne couvre pas volontairement.**

### Les règles d'écriture, et elles ne sont pas décoratives

- ⚠️ **Le plan propose, il n'arbitre pas.** Il consigne ce qui a été tranché *jusqu'ici* et
  pourquoi ; il ne décide pas à la place de la conversation qui le lira. Un fait neuf le périme,
  et c'est normal.
- ⚠️ **Aucune estimation, aucune date, aucune vélocité.** Le dépôt est solo : un chiffre y serait
  décoratif et vieillirait plus vite que le reste.
- ⚠️ **Ne compte pas les parapluies comme du travail.** Ils se ferment quand leurs enfants le
  sont ; les lister dans une file produit un double comptage.
- ⚠️ **Une dépendance s'écrit avec sa cause.** « CC-181 après CC-180 » n'apprend rien ; « le lot 3
  débloque le lot 4, qui est le seul Majeur de l'épique » se conteste et se vérifie.
- ⚠️ **Ce qui a été délibérément écarté reste écrit**, avec sa raison. Sans ça, la prochaine
  session le repropose, et l'arbitrage se rejoue à vide.

---

## Ce que ce skill ne fait pas

- ⚠️ **Il ne crée, ne modifie et ne ferme aucun ticket.** Il lit le backlog et écrit un article.
  Un manque repéré en chemin se **signale** dans la synthèse ; sa création passe par le cursus
  normal, avec confirmation explicite.
- **Il ne lance ni `/task-flow`, ni aucun travail.** Il rend l'état du plan, l'orchestrateur
  décide de la suite.
- **Il ne touche pas `CC-A-12`** — c'est `/kb-sync` qui en a la charge.

---

## Rendre compte

En fin de passage, en quelques lignes :

- **Ce qui a changé dans le plan** depuis la version précédente — un item entré dans la file, une
  dépendance découverte, un blocage levé ou apparu.
- **Ce que la phase 1 a corrigé** dans la KB, repris de la synthèse de `/kb-sync`.
- **Les écarts trouvés** entre le plan précédent et le backlog réel : ce sont eux qui justifient
  l'existence du skill, et les taire reviendrait à prétendre que le plan ne dérive jamais.

Puis journalise l'invocation, comme les autres skills YouTrack du dépôt. Résous la date du jour
(`date +%F`), puis écris la ligne avec les valeurs déjà résolues — le heredoc `'JSONLINE'`
n'interpole rien :

```bash
cat >> .claude/youtrack-usage.log <<'JSONLINE'
{"date":"2026-08-06","skill":"plan-sync","delegated":true,"items":54,"summary_chars":900,"source_chars_est":28000,"notes":"file réécrite, 1 blocage levé"}
JSONLINE
```

---

## Quand le lancer

Après un **lot de merges**, après la **création d'une épique**, ou quand une conversation
d'arbitrage constate que le plan ne correspond plus au backlog. Pas à chaque PR : le plan bouge à
l'échelle du chantier, pas du commit — c'est la même raison qui a détaché `/kb-sync` de
`/review-mr` le 2026-08-03.
