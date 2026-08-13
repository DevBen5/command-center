# Paquets de cartes — contenu générique, versionné

Des fichiers d'import Leitner **au format d'export du module** (`app/modules/leitner/`), à charger
depuis `/revision/settings` → Importer.

⚠️ **Ce ne sont PAS des seeders, et il ne faut pas en faire.** Rien ne les exécute : ni
`node ace db:seed`, ni les migrations, ni les tests. Le module n'a délibérément aucun dossier
`seeders/` — voir `app/modules/leitner/CLAUDE.md`. L'import reste un **geste manuel**, et c'est ce
qui rend ces fichiers inoffensifs pour le contenu réel de la base.

L'import **n'ajoute que ce qui manque** : une carte dont le recto existe déjà sous le même thème est
ignorée. Rejouer un fichier ne duplique donc rien, et n'écrase jamais une carte modifiée à la main.

## Pourquoi ici, et pas dans `backups/`

`backups/` est **exclu de git** (`.gitignore`) : il porte les dumps `.sql` de `npm run db:backup`,
qui contiennent le contenu réel — donc une seule copie, sur ce disque. Un fichier de cartes posé là
n'aurait été sauvegardé nulle part, alors que le dossier s'appelle « backups ». Ces paquets-ci sont
du **contenu générique et reproductible** : ils ont leur place dans le dépôt, où ils sont diffables
et présents sur toute machine qui clone.

La distinction tient en une phrase : `backups/` protège la base contre sa propre perte, `decks/`
protège un contenu qui n'appartient à aucune base en particulier.

## Contenu

| fichier | catégorie · thème | cartes |
| --- | --- | --- |
| `leitner-linux-debutant.json` | Linux · Commandes — débutant | 43 |
| `leitner-linux-confirme.json` | Linux · Commandes — confirmé | 45 |
| `leitner-linux-expert.json` | Linux · Commandes — expert | 44 |
| `leitner-owasp-top10.json` | Sécurité · OWASP | 27 |
| `leitner-breadcrumb.json` | Web Development · UX | 1 |
| `leitner-command-center-socle-architecture.json` | Le socle technique · AdonisJS et la base / Inertia et Vue / Les deux runners de test / Les mots qui reviennent — et L'architecture de ce dépôt · La tranche verticale / Les registres / Ce qui casse sans lever d'erreur | 56 |

⚠️ **Ce tableau est tenu à la main, et rien ne le vérifie.** Aucun test ne balaie ce dossier : un
fichier ajouté sans sa ligne, ou une ligne dont le compte a cessé d'être juste, passe tous les
gates. C'est exactement le mode d'échec que `tests/unit/tests_index.spec.ts` a fermé pour les
`TESTS.md` des modules (CC-112) ; ici il reste ouvert, et il le restera tant que le dossier tient en
une poignée de fichiers.

### Le paquet « Command Center »

`leitner-command-center-socle-architecture.json` est le seul paquet qui parle **de ce dépôt
lui-même** : le vocabulaire et les pièges qu'on rencontre en y développant. Il est écrit pour être
révisé par quelqu'un qui travaille ici, pas comme une introduction générale — chaque carte de piège
renvoie à une décision réelle du projet.

⚠️ **Ses versos sont en prose, sans blocs de code — un reste d'avant CC-133, plus une
contrainte.** Ils avaient été écrits ainsi parce que le Markdown des cartes n'était pas rendu et
que des backticks s'affichaient tels quels. **Depuis CC-133, le recto et le verso sont rendus** :
gras, listes, titres courts et surtout blocs de code délimités par ```` ``` ````, qui gardent leur
indentation. Les versos de ce paquet peuvent donc être enrichis — l'import n'écrasant rien, une
version corrigée du fichier ne créera pas de doublons.

⚠️ **Deux limites à connaître avant d'enrichir un paquet** : une image Markdown (`![](…)`) est
**retirée au rendu** — les images arriveront avec CC-134, stockées en base ; et un verso enrichi
ne correspondra plus au court-circuit du juge, qui compare la réponse tapée au **texte source** du
verso. Sans conséquence de justesse (le juge LLM prend le relais), mais un appel réseau là où il
n'y en avait pas.

## Le format, en trois champs

Seuls `front` et `back` sont obligatoires ; le reste prend les valeurs d'une carte créée depuis l'UI
(boîte 1, due aujourd'hui). `category` et `theme` vont **ensemble ou pas du tout** — un thème
appartient toujours à une catégorie, et un fichier qui n'en déclare qu'un est refusé à l'import.

```json
{
  "version": 2,
  "categories": [{ "name": "Linux", "themes": ["Commandes — débutant"] }],
  "cards": [{ "category": "Linux", "theme": "Commandes — débutant", "front": "…", "back": "…" }]
}
```

⚠️ **`version` vaut `2` depuis CC-119 — les quatre premiers paquets déclarent encore `1`, et c'est
sans conséquence ici.** Ce champ ne décrit qu'une chose : le sens de `box`, `nextReview` et
`reviews`, qui sont devenus **la progression de celui qui exporte** plutôt que celle du paquet. Les
fichiers de ce dossier n'en portent aucune, donc les deux versions s'y valent. Un paquet écrit
aujourd'hui déclare néanmoins `2`, la version courante ; `1` reste accepté à l'import pour que les
sauvegardes antérieures restent lisibles.

La taxonomie est désignée **par son nom, jamais par un id** : le fichier est autoportant, et les
catégories/thèmes manquants sont créés à l'import. Le contrat complet vit dans
`app/modules/leitner/services/leitner_backup_service.ts` et son validateur.
