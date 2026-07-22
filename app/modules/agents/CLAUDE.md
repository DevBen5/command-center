# Module Agents — lanceurs d'agents IA

Route `/agents` · page Inertia `modules/agents/index` · table `agents`.

## ⚠️ Frontière de confiance — à lire avant toute modification

`AgentRunnerService.run()` exécute **`exec(agent.config.command)`**, une commande shell complète,
sans échappement. C'est un choix assumé (modèle « entrée cron »), qui ne tient que sur **une seule
garantie** : `config.command` n'est écrivable par **aucun formulaire de l'application** — seuls les
seeders et un accès direct à la base l'alimentent.

Conséquence directe : **n'ajoute jamais d'écran d'édition de la config d'un agent qui exposerait
`command`**, et n'introduis aucune route qui écrit dans `config` depuis une entrée utilisateur.
Ce serait une exécution de code à distance. Si une UI d'édition devient nécessaire, elle doit
travailler sur une liste blanche de clés (`trigger`, `model`…) qui exclut `command`.

Le module n'a volontairement **pas de dossier `validators/`** : aucune entrée utilisateur n'est
écrite aujourd'hui. En créer un est le signal que cette frontière est en train de bouger.

## Fonctionnement

```
controllers/agents_controller.ts    index (?id= sélectionne l'agent affiché) · run · stop
services/agent_runner_service.ts    run · stop · recentLogs(limit = 100)
models/agent.ts                     config + logs en jsonb
```

- Statuts : `active` · `idle` · `running` · `failed`.
- `run()` met `active` si la commande réussit, et **`running` si elle échoue** — le `catch {}` simule
  un lancement en cours faute de script réel sur le poste de dev. Contre-intuitif mais **volontaire**.
- `config` et `logs` sont des colonnes `jsonb` : leurs `@column()` portent
  `prepare: JSON.stringify`. (Ne pas confondre avec les `text[]` de veille/leitner, qui n'en veulent
  pas.)
