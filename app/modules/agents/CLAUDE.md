# Module Agents — lanceurs d'agents IA

Route `/agents` · page Inertia `modules/agents/index` · table `agents`.

## ⚠️ Frontière de confiance — à lire avant toute modification

`AgentRunnerService.run()` exécute **`exec(agent.config.command)`**, une commande shell complète,
sans échappement. C'est un choix assumé (modèle « entrée cron »), qui ne tient que sur **une seule
garantie** : `config.command` n'est écrivable par **aucun formulaire de l'application** — seuls le
fichier de déclaration (ci-dessous, CC-141) et un accès direct à la base l'alimentent.

Conséquence directe : **n'ajoute jamais d'écran d'édition de la config d'un agent qui exposerait
`command`**, et n'introduis aucune route qui écrit dans `config` depuis une entrée utilisateur.
Ce serait une exécution de code à distance. Si une UI d'édition devient nécessaire, elle doit
travailler sur une liste blanche de clés (`trigger`, `model`…) qui exclut `command`.
`tests/functional/modules/agents_config_immutable.spec.ts` le prouve : POST sur les trois routes
du module avec un payload qui tente d'écrire `config`, base inchangée après coup.

Le module n'a volontairement **pas de dossier `validators/`** : aucune entrée utilisateur n'est
écrite aujourd'hui. En créer un est le signal que cette frontière est en train de bouger.

## Les agents se déclarent par fichier, pas par psql (CC-141)

Avant ce lot, `config.command` n'était alimentable que par un seeder ou un accès direct à la
base. CC-138 a supprimé les seeders (voir le `CLAUDE.md` racine, « Le premier compte ») : sur une
installation neuve, le module s'affichait donc sans **aucun** moyen d'y créer un agent. La
solution retenue préserve la frontière de confiance ci-dessus mot pour mot — elle ne l'ouvre pas,
elle change seulement qui peut l'alimenter :

- **Un fichier JSON** (`agents.json.example` à la racine du dépôt, versionné ; `agents.json`,
  l'instance réelle, ignorée par git — même traitement que `.env`/`.env.example`), lu **au
  démarrage**, jamais par une route. Écrire ce fichier suppose déjà un accès à la machine, donc le
  pouvoir qu'il confère, on l'avait déjà.
- ⚠️ **JSON, pas YAML.** Le dépôt n'a aucun parseur YAML installé ; en ajouter un pour ce seul
  usage aurait mérité un commit `chore(tooling)` séparé, pour un gain nul. JSON est un « fichier
  équivalent » au sens du ticket.
- **`AGENTS_CONFIG_PATH`** (optionnelle, défaut `agents.json` relatif à la racine du dépôt) est
  lue **par l'application elle-même**, en dev comme en prod — contrairement à `BACKUP_DIR_PATH`,
  qui n'est jamais lue que par `docker-compose.prod.yml` : la sauvegarde a un code totalement
  différent selon dev/prod, ce module a le même code des deux côtés, il lui faut donc une variable
  applicative. En prod, `.env.production` la fixe à `/data/agents.json` (chemin fixe du
  conteneur) ; c'est `AGENTS_CONFIG_PATH_HOST` (compose-only, jamais lue par l'app) qui règle le
  côté hôte du montage — voir `docker-compose.prod.yml` et `docs/deploiement-nas.md` §11.

### Le format

```json
{
  "agents": [
    { "name": "Veille quotidienne", "framework": "Hermes",
      "config": { "command": "…", "trigger": "cron: 0 7 * * *" } }
  ]
}
```

`config` reste l'objet JSONB libre déjà porté par la colonne — **aucun changement de schéma**,
aucune migration. `trigger` est une clé conventionnelle **dans** `config`, pas une colonne : le
ticket parlait de « synchroniser command/déclencheur », les deux vivent au même endroit qu'avant.
La validation (`config/agents.ts`, `parseAgentsDeclarations`) exige `name`/`framework` non vides,
des noms uniques dans le fichier, et `config` objet si présent — rien de plus.

### La synchronisation au boot — déclarative, pas un delta

`AgentsProvider` (`environment: ['web']`, comme `LeitnerProvider`/`VeilleProvider`) lit le fichier
à chaque démarrage et **remplace l'ensemble des agents** par celui du fichier :

- un agent déclaré et absent de la base → **créé** (`status: idle`, `logs: []`) ;
- un agent déclaré et déjà présent (apparié par `name`) → `framework`/`config` **mis à jour**,
  **`status`/`logs` préservés** — le fichier pilote la configuration, jamais l'état d'exécution ;
- ⚠️ **un agent en base dont le nom n'est plus dans le fichier → SUPPRIMÉ, logs compris.** Le
  fichier décrit l'ensemble voulu des agents, pas une liste d'ajouts : retirer une entrée du
  fichier est un geste définitif, pas une mise en pause. C'est le prix de la simplicité — pas de
  colonne « déclaré/orphelin » à tenir en plus du schéma existant.

⚠️ **Trois issues au boot, jamais deux.** Fichier absent → module vide, **pas une erreur** (c'est
l'état d'une installation qui n'a encore rien monté). Fichier illisible ou malformé (JSON
invalide, `name` manquant, doublon…) → `logger.error` **bruyant**, synchronisation **abandonnée**,
la base garde son état précédent. Ces deux issues ne se confondent jamais : un fichier malformé
ne doit jamais dégénérer en « zéro agent » silencieux, ce qui laisserait croire à une installation
neuve plutôt qu'à une faute de frappe à corriger. `syncAgentsFromDeclarations` tourne sous
`db.transaction()` : un échec en cours de synchronisation ne laisse jamais un état à moitié
appliqué, le prochain redémarrage rejoue tout.

⚠️ **Piège Docker à connaître avant de monter le fichier en conteneur** : un bind-mount dont la
source est absente sur l'hôte fait créer par Docker un **dossier vide** à cet emplacement, jamais
une absence de fichier. La ligne de montage dans `docker-compose.prod.yml` reste donc commentée
par défaut, sans valeur de repli inline (même parade que `BACKUP_MIRROR_DIR_PATH`) : décommenter
avant que le fichier hôte existe transformerait « module vide » en « fichier malformé ».

## Les logs sont désormais réellement écrits (CC-141)

Avant ce lot, `agent.logs` n'était jamais alimenté — `run()` ne poussait rien, l'écran affichait
toujours « Aucun log récent. ». `AgentRunnerService.run()`/`stop()` écrivent maintenant une ligne
horodatée (commande lancée, sortie standard/erreur si non vide, ou message de repli en cas
d'échec) ; `logs` est plafonné à 200 entrées pour ne pas grossir sans fin sur un agent relancé
souvent. **Le comportement de `status` n'a pas changé** — voir plus bas.

## Fonctionnement

```
controllers/agents_controller.ts      index (?id= sélectionne l'agent affiché) · run · stop
services/agent_runner_service.ts      run · stop · recentLogs(limit = 100)
services/agents_file_service.ts       lecture + validation du fichier de déclaration (CC-141)
services/agents_sync_service.ts       la synchro déclarative en base, sous transaction (CC-141)
models/agent.ts                       config + logs en jsonb
destinations.ts                       l'entrée `/agents` de la barre latérale — accès `admin`
```

⚠️ **Cinq fichiers hors du module** : `start/routes.ts`, `start/navigation.ts` et `config/modules.ts`
(depuis CC-137, il décide si `agents` existe du tout sur l'installation), plus depuis CC-141
`config/agents.ts` (le chemin du fichier + la validation pure, sur le modèle de `config/llm.ts`)
et `providers/agents_provider.ts` (déclaré dans `adonisrc.ts`, `environment: ['web']`).

⚠️ **`destinations.ts` déclare `admin`, jamais une capacité**, et le module n'a toujours pas de
`capabilities.ts` : c'est la même frontière que ci-dessus, vue depuis la navigation. Une capacité
pourrait être accordée par un rôle, donc depuis un écran — sur un module qui exécute des commandes
shell.

- Statuts : `active` · `idle` · `running` · `failed`.
- `run()` met `active` si la commande réussit, et **`running` si elle échoue** — le `catch {}` simule
  un lancement en cours faute de script réel sur le poste de dev. Contre-intuitif mais **volontaire**.
  Ce comportement n'a pas changé avec CC-141 : seule l'écriture dans `logs` s'y est ajoutée.
- `config` et `logs` sont des colonnes `jsonb` : leurs `@column()` portent
  `prepare: JSON.stringify`. (Ne pas confondre avec les `text[]` de veille/leitner, qui n'en veulent
  pas.)
