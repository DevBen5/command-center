# Module Services — supervision Docker

Route `/services` · page Inertia `modules/services/index` · table `services`.

```
controllers/services_controller.ts     index · start · stop · restart
services/system_stats_service.ts       control(service, action) → docker
models/service.ts                      statuts up · down · unknown
destinations.ts                        l'entrée `/services` de la barre latérale — accès `admin`
```

⚠️ **`destinations.ts` déclare `admin`, jamais une capacité**, et le module n'a toujours pas de
`capabilities.ts` : une capacité pourrait être accordée par un rôle, donc depuis un écran — sur un
module qui pilote Docker. Cinq fichiers hors du module : `start/routes.ts`, `start/navigation.ts`,
et depuis CC-116 `config/docker.ts` et `start/env.ts` (`DOCKER_AVAILABLE`, reflétée dans
`.env.example` et `.env.production.example`). Depuis CC-137, `config/modules.ts` : c'est lui qui
décide si `services` existe du tout sur l'installation (indépendamment de `DOCKER_AVAILABLE`, qui ne
gouverne que l'écran quand le module EST activé).

## Hors service sans Docker (CC-116)

En production sur le NAS, le socket Docker n'est **jamais** monté (décision CC-73) : sans garde, le
`catch {}` ci-dessous simule le succès et l'écran affiche des conteneurs imaginaires. La vérité se
dit **au-dessus** du `catch {}`, qui n'a pas bougé :

- **`config/docker.ts` décide de la disponibilité** — `DOCKER_AVAILABLE` optionnelle, défaut
  dérivé de `NODE_ENV` : disponible en `development`/`test`, indisponible en `production`.
  **L'oubli va vers la vérité** (bannière), jamais vers le mensonge ; le NAS n'a rien à
  configurer. Ce n'est pas une sonde : « docker échoue » est identique en dev et sur le NAS,
  seule une déclaration du déploiement distingue les deux.
- **Indisponible, `index` ne charge RIEN** (`services: []`, flag `dockerDisponible: false`) et la
  page n'affiche que la bannière `services.offline.*` — ni barre d'outils, ni indicateurs, ni
  cartes. Des stats à zéro descendent pour la forme des props, elles ne sont jamais rendues.
- **Les trois actions redirigent sans toucher la base.** « Masquer un bouton n'est pas un
  droit » : sans cette garde, un POST direct (curl + cookie) continuerait de fabriquer des
  statuts inventés.
- ⚠️ **Le flag se lit à chaque requête** (`dockerConfig.disponible`), jamais destructuré à
  l'import : `services_offline.spec.ts` mute cette propriété pour forcer le chemin — le
  destructurer ferait rougir ces tests.

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

## Tests

Le détail par fichier est dans [TESTS.md](./TESTS.md) — à lire avant de **modifier un test**, pas
avant de modifier le module. ⚠️ **Un fichier de test du module absent de cet index fait rougir
`tests/unit/tests_index.spec.ts`** (CC-112), qui le nomme : l'oubli ne passe plus en silence.
