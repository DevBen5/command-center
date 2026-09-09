# CC-256 — mesure anonymisée de l’upsert catalogue

Date : 2026-09-09

## Périmètre livré

La source est énumérée une seule fois, puis appliquée une fois par coffre dans une
transaction propre à chaque compte. Pour chaque lot, le service précharge les
références existantes avec un paramètre tableau PostgreSQL casté en text[], calcule
les compteurs en mémoire, puis exécute un INSERT ... ON CONFLICT sur la contrainte
unique owner_id, source, reference.

La taille maximale est calculée à partir de la limite PostgreSQL de 65 535
paramètres : 10 paramètres par ligne, soit 6 553 lignes par lot. Aucun whereIn ou
whereNotIn n’est utilisé pour les lots.

La reprise incrémentale du parcours NAS n’est pas implémentée dans CC-256.

## Preuves reproductibles sur base jetable

- Synchronisation catalogue : 12 tests passés.
- Parcours NAS sur fixtures : 7 tests passés.
- Création : discovered = 2 et updated = 0.
- Mise à jour : discovered = 0 et updated = 2.
- L’empreinte MD5 du catalogue est comparée à une empreinte attendue calculée à
  partir du catalogue canonique attendu, avant et après la mise à jour ; la
  comparaison prouve donc l’équivalence du contenu, et pas seulement qu’une
  modification voulue change l’empreinte.
- Les doublons dans une même énumération conservent la sémantique historique :
  la première occurrence est découverte, la seconde est une mise à jour, et la
  dernière métadonnée est persistée.
- Absence, réapparition, troncature, plusieurs comptes et échec transactionnel par
  compte restent couverts.
- Le cas de 65 600 références passe sur une base jetable.

Sur trois références, l’écoute des requêtes SQL montre trois requêtes catalogue
avec l’upsert : préchargement du lot, upsert du lot et lecture de contrôle de
l’absence. L’ancienne boucle exécutait sept requêtes catalogue : un SELECT et une
écriture par référence, puis la lecture de contrôle de l’absence.

Le scénario de 65 600 références a été exécuté en environ 5 secondes avec la
version par lots. L’exécution comparable de l’ancienne boucle a saturé la base
jetable pendant la tentative de mesure ; cette valeur n’est donc pas utilisée
comme comparaison de durée fiable.

## Mesure du parcours NAS réel

Une tentative a été lancée sur la racine NAS configurée, en lecture seule, sans
connexion à la base et sans écriture. Le parcours n’a pas produit de résultat
après plus de cinq minutes et a été arrêté. Aucun chemin, hôte, partage, nom de
fichier ou contenu réel n’est conservé dans ce rapport.

La mesure NAS réelle est donc bloquée par la durée du parcours dans cet
environnement. Les chiffres SQL ci-dessus proviennent uniquement de fixtures et
d’une base jetable.

## Analyse de la reprise incrémentale

markAbsent compare les références vues par l’énumération avec celles déjà
présentes. Un parcours qui ne visite qu’une partie des répertoires fournit une
liste incomplète ; lui laisser appeler markAbsent marquerait alors absents les
éléments non parcourus.

Une future reprise incrémentale devra donc soit fournir l’énumération complète
des références malgré le parcours partiel, soit porter un état explicite de
parcours tronqué qui désactive le marquage des absents. Tant que ce contrat n’est
pas établi et testé, l’énumération complète reste le seul chemin autorisé.
