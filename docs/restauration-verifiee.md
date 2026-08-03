# Prouver qu'un dump se recharge — procédure rejouable (CC-153)

`scripts/lib/dumps.js` vérifie qu'un dump n'est pas **tronqué** : en-tête `pg_dump`, au
moins un `CREATE TABLE`, marqueur de fin dans les derniers 8 Ko. C'est solide contre disque
plein, conteneur tué en plein dump, copie coupée — et c'est tout ce que ça prouve. Un dump
**complet mais logiquement inutilisable** (ordre de restauration impossible, contrainte
circulaire, extension absente, incompatibilité de version majeure) passerait cette
vérification sans broncher.

La seule preuve qui compte : restaurer pour de vrai, et comparer le contenu — pas un coup
d'œil, une empreinte. **Prouvé le 2026-08-03 par CC-153**, sur le poste de dev, avec la
procédure ci-dessous. Elle est écrite pour être rejouée sans avoir à la reconstruire.

⚠️ **Ceci ne couvre que la chaîne du poste de dev** (`npm run db:backup` /
`npm run db:restore`, qui parlent à `docker compose exec`). Le NAS sauvegarde et restaure
autrement — cron `pg_dump` direct sur le conteneur, décrit dans
`docs/deploiement-nas.md` §7 — et n'est **pas** prouvé par cet exercice. Voir la dernière
section.

## Le point dangereux : la manette est une variable d'environnement

`npm run db:restore` lit `DB_DATABASE` dans `.env`, et restaure avec `--clean --if-exists` :
ça **supprime** les tables avant de les recréer. La base `app` porte l'unique exemplaire du
contenu, saisi à la main, sans seeder. **Ne jamais restaurer contre `app`.**

`node --env-file-if-exists=.env` ne réécrit pas une variable déjà présente dans
`process.env` : une variable posée devant la commande, dans le même shell, **gagne** sur
`.env`. C'est ce qui permet de cibler une base jetable sans toucher au fichier `.env` — donc
sans risque d'oublier de le remettre en place ensuite. Vérifié :

```bash
DB_DATABASE=probe node --env-file-if-exists=.env -e "console.log(process.env.DB_DATABASE)"
# → probe
```

**Avant CHAQUE lancement de `db:restore`, vérifier la base ciblée** avec la même commande —
pas « je l'ai posée deux commandes plus haut ».

## Procédure

Remplacer `cc153_restore_test` par un nom qui ne collisionne pas si l'exercice est rejoué le
même jour ; le supprimer à la fin dans tous les cas, y compris en cas d'échec en cours de
route.

Les fichiers d'empreinte (`before.csv`/`after.csv`) sortent **hors du dépôt** — sinon un `git
add -A` distrait les committerait. Adapter le chemin à l'OS (`/tmp` ci-dessous, un dossier
temporaire Windows sinon).

```bash
# 0. Filet de sécurité — même si l'essai porte sur un dump déjà présent dans backups/. Refait
#    juste avant l'étape 1 : c'est aussi ce qui garantit que l'empreinte AVANT correspond
#    exactement au dump qu'on s'apprête à restaurer, sans dérive due à une écriture survenue
#    entre un ancien dump et maintenant.
npm run db:backup

# 1. Empreinte AVANT, sur app (jamais touchée par la suite).
docker compose exec -T postgres psql -U root -d app -A -F',' \
  < scripts/db-fingerprint.sql > /tmp/cc153-before.csv

# 2. Base jetable — jamais app.
docker compose exec postgres createdb -U root cc153_restore_test

# 3. Vérifier la base ciblée AVANT de lancer (voir section précédente).
DB_DATABASE=cc153_restore_test node --env-file-if-exists=.env \
  -e "console.log(process.env.DB_DATABASE)"

# 4. Restaurer le dump qu'on vient de prendre (celui de l'étape 0) dans la base jetable,
#    jamais dans app.
DB_DATABASE=cc153_restore_test npm run db:restore

# 5. Empreinte APRÈS, sur la base restaurée.
docker compose exec -T postgres psql -U root -d cc153_restore_test -A -F',' \
  < scripts/db-fingerprint.sql > /tmp/cc153-after.csv

# 6. La preuve : un diff vide veut dire un contenu identique, table par table.
diff /tmp/cc153-before.csv /tmp/cc153-after.csv && echo IDENTIQUE

# 7. Nettoyage — dans tous les cas, que le diff soit vide ou non.
docker compose exec postgres dropdb -U root cc153_restore_test
rm -f /tmp/cc153-before.csv /tmp/cc153-after.csv
```

Si le `diff` de l'étape 6 n'est pas vide, **c'est le résultat de l'exercice** : nommer la ou
les tables qui divergent, ne pas chercher à les faire disparaître en changeant la méthode de
comparaison.

## Résultat du 2026-08-03

22/22 tables identiques (nombre de lignes et empreinte), dump `command-center-2026-08-03_19h42.sql`
restauré dans `cc153_restore_test` puis comparé à `app`. Base jetable supprimée après
comparaison ; `.env` jamais modifié pendant l'exercice (la cible passait par la variable
d'environnement inline, voir ci-dessus).

## La seconde chaîne — NAS, restée ouverte

Le NAS ne sauvegarde pas avec `scripts/db-backup.js` (CC-74 l'écarte explicitement) : un cron
`pg_dump` direct sur le conteneur, écrit dans `docs/deploiement-nas.md` §7. **Prouver la
restauration sur le poste ne prouve pas celle du NAS** — deux scripts différents, deux
chemins différents. `docs/deploiement-nas.md` §7 décrit déjà un test de restauration (créer
une carte, sauvegarder, la supprimer, restaurer, vérifier qu'elle est revenue) ; il reste
un coup d'œil, pas une empreinte. Le même principe (`scripts/db-fingerprint.sql` copié sur le
NAS, ou son équivalent en `psql -c`) s'y appliquerait le jour où quelqu'un a la main sur le
NAS pour rejouer ce test — non fait par ce ticket, faute d'accès SSH depuis cet environnement.
