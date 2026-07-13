# Module Services — supervision Docker

Route `/services` · page Inertia `modules/services/index` · table `services`.

```
controllers/services_controller.ts     index · start · stop · restart
services/system_stats_service.ts       control(service, action) → docker
models/service.ts                      statuts up · down · unknown
```

## Sécurité — le pattern à ne pas casser

`SystemStatsService.control()` appelle **`execFile('docker', [action, containerName])`**, précédé
d'une validation du nom par liste blanche (`/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/`). `execFile` ne passe
pas par un shell : les arguments ne sont jamais interprétés.

Tout retour à `exec()` avec une chaîne interpolée est une régression de sécurité (commit `12fe483`).
Le nom du conteneur vient de `config.containerName`, à défaut de `name.toLowerCase()`.

Le `catch {}` avale l'échec Docker et applique quand même le nouveau statut en base : c'est
**volontaire** (pas de conteneurs réels sur le poste de dev), ne le « corrige » pas.

## Pièges techniques

- **`cpu_percent` et `ram_percent` sont des `decimal` Postgres**, que `node-postgres` renvoie en
  **chaînes**. Les colonnes portent donc `consume: (v) => Number(v)`. Toute nouvelle colonne
  numérique décimale a besoin du même `consume`, sinon les moyennes concatènent des chaînes.
- `config` est du `jsonb` → `prepare: JSON.stringify` sur la colonne.

## État de l'UI

Sur `pages/index.vue`, la barre de filtres (Catégorie, Statut, champ de recherche) et le bascule
Grille/Liste sont **du décor non branché**. « Tout redémarrer » est réel : il envoie N requêtes POST
depuis le client, une par service actif.
