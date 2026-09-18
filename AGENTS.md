# Command Center

Application auto-hébergée : AdonisJS 6 (ESM, TypeScript strict), Inertia 2, Vue 3, Tailwind v4 et PostgreSQL.

## Contrat universel

- Code et commentaires en français. Contrôleurs fins : la logique métier vit dans les services.
- Préserver les modifications existantes et ne jamais les annuler sans instruction explicite.
- Ne jamais écrire de secret, domaine réel, chemin NAS ou valeur d'environnement dans le dépôt public.
- Toute entrée utilisateur passe par un validateur VineJS. `whereRaw` reste paramétré. Une route neuve déclare exactement une condition d'accès (`can`, `admin` ou `openRoute`).
- Ne pas créer de code qui importe directement un service d'un module détachable : extraire le transport générique vers `app/core/shared/`.
- Un module neuf ou modifié suit `config/modules.ts`, `start/capabilities.ts`, `start/navigation.ts`, `start/routes.ts` et la documentation de son module. Une migration neuve doit être jouée sur la base de développement.
- Ne pas utiliser `node ace make:*` : créer les fichiers dans la tranche verticale concernée. Les commandes Ace vivent dans `commands/`.
- Le contenu réel vit en base. Avant une migration risquée ou un geste destructif, lire le guide d'exploitation et faire une sauvegarde.

## Architecture

```
app/core/     domaines transverses                         → #core/*
app/modules/  services · agents · veille · leitner · corpus · coffre → #modules/*
app/bridges/  intégrations entre modules                   → #bridges/*
providers/    providers Adonis                             → #providers/*
commands/     commandes Ace                                → #commands/*
```

Les alias valides sont `#core/*`, `#modules/*`, `#bridges/*`, `#providers/*`, `#commands/*`, `#tests/*`, `#start/*` et `#config/*`.

## Vérification

```bash
npm run lint
npm run typecheck
npm test
```

Exécuter aussi `npm run build` lorsqu'un fichier Vue est touché. Les tests ne prouvent ni l'apparence, ni la CSP dans un navigateur, ni les gestes d'exploitation manuels.

## Chargement ciblé

- Toute modification dans un module : lire `app/modules/<module>/AGENTS.md` avant de modifier son code ou ses tests.
- Sauvegardes, restauration, déploiement, comptes, sécurité, modales, i18n, navigation ou CI : rechercher la section concernée dans `docs/agent-reference.md`, puis lire les fichiers cités.
- Commits, branches, PR et publication : charger `/git-commit`, puis `/lead-review` si le diff est substantiel.
- Backlog, KB YouTrack, arbitrage entre tickets et coordination : charger `/orchestrator`.

`docs/agent-reference.md` conserve les décisions détaillées et leur historique. Il ne se charge jamais par défaut : le lire uniquement pour le sujet concerné.
