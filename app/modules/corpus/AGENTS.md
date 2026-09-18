# Corpus — cours et glossaire autonomes

Le module utilise `corpus.view` pour lire et `corpus.write` pour écrire.
`/corpus` liste les cours ; `/corpus/:id` les affiche ; `/corpus/glossaire`
est l'onglet des termes, avec recherche, création, édition et suppression rapide.

## Propriété et visibilité

Les cours et termes sont du contenu : `owner_id`, `is_shared`, privés par défaut.
La lecture applique la règle commune de `core/shared/services/visibility.ts`.
Le partage ouvre la lecture, jamais l'écriture. Les sections héritent de la visibilité
du cours. Le lien d'un terme partagé vers un cours privé n'est exposé qu'aux lecteurs
autorisés à voir ce cours. Les sélecteurs sont filtrés côté serveur.

Une suppression de compte ne supprime pas son contenu (FK SET NULL). Les termes
partagés bloquent la suppression du compte, comme les cours partagés.

## Sections et glossaire

`leitner_courses` conserve le Markdown source et son empreinte SHA-256.
`leitner_course_sections` conserve slug, chemin de titres, corps et date d'obsolescence.
Les slugs disparus deviennent des pierres tombales ; la purge est explicite.
La découpe sans chevauchement vit dans `core/shared/services/course_sections.ts`,
partagée avec l'ingestion Leitner, indépendamment de l'activation de ces modules.

`glossary_terms` porte terme, alias, définition Markdown libre, propriétaire/partage
et une section facultative (FK SET NULL). La syntaxe historique ne déclare plus de termes.
La migration CC-277 convertit les anciennes déclarations avant de retirer leur colonne ;
elle doit fonctionner aussi sur une installation qui en possède, malgré les zéro termes
constatés initialement sur le poste de développement.

La promotion depuis une section préremplit le formulaire avec le texte sélectionné
(ou son titre), le corps de section et son lien. L'utilisateur corrige avant d'enregistrer.
La promotion de carte est gérée par le pont global `app/bridges/leitner_corpus/`.
Corpus ne dépend pas de Leitner. Les définitions HTML passent par le rendu assaini commun.

## Échange et vérification

Le format Leitner v6 contient les termes visibles. Un lien introuvable ne fait jamais perdre
la définition. Le lecteur des anciens formats convertit les déclarations v5 en termes ;
ce contrat historique est le seul endroit, hors migrations, qui relit leurs anciens alias.

Voir `TESTS.md` pour les specs, et le compte rendu CC-277 pour les commandes réellement
exécutées, le parcours navigateur et les deux configurations de modules indépendants.
