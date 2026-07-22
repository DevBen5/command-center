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

## Le format, en trois champs

Seuls `front` et `back` sont obligatoires ; le reste prend les valeurs d'une carte créée depuis l'UI
(boîte 1, due aujourd'hui). `category` et `theme` vont **ensemble ou pas du tout** — un thème
appartient toujours à une catégorie, et un fichier qui n'en déclare qu'un est refusé à l'import.

```json
{
  "version": 1,
  "categories": [{ "name": "Linux", "themes": ["Commandes — débutant"] }],
  "cards": [{ "category": "Linux", "theme": "Commandes — débutant", "front": "…", "back": "…" }]
}
```

La taxonomie est désignée **par son nom, jamais par un id** : le fichier est autoportant, et les
catégories/thèmes manquants sont créés à l'import. Le contrat complet vit dans
`app/modules/leitner/services/leitner_backup_service.ts` et son validateur.
