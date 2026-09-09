# Retour de la conversation CC-277

## Décisions fermées

- `> notion:` ne déclare plus de terme ; le texte source est conservé.
- Termes privés par défaut, partage explicite.
- Définition Markdown libre, section de cours facultative.
- Promotion depuis une carte incluse, ainsi que depuis une section.
- Pont explicite global `app/bridges/leitner_corpus`, sans registre générique anticipé.
- Corpus et Leitner restent indépendamment désactivables.

## Livré dans le worktree

- Table et modèle `GlossaryTerm`, migration des anciens alias avant suppression de la colonne des sections ; migrations historiques inchangées.
- CRUD Corpus avec recherche, édition du terme, alias, définition, partage et section visible, suppression rapide, libellés français et onglet Glossaire.
- Bouton de promotion depuis une carte : formulaire modifiable, création privée dans le pont, contrôles de capacité et propriété, retour de succès ou erreur.
- Recto conservé en arbre Vue sécurisé ; contrats `termId`, modale partagée affichant la définition libre et le lien de section uniquement si visible. La suppression recharge les cartes et retire le surlignage.
- Export/import v6 : termes visibles, alias, définition, partage, dates et lien facultatif ; un lien introuvable devient nul sans perdre le terme. Sans Corpus, absence de requête vers ses tables et indication explicite du contenu non pris en charge.
- Ancien service de glossaire supprimé, parser pur partagé hors modules, imports conditionnels et documentation actualisée.

Les seuls anciens alias de section encore acceptés par le contrat d'import sont ceux des fichiers v1–v5 : ils sont convertis en termes. Ils ne sont jamais émis en v6. Cette compatibilité évite de perdre le contenu des sauvegardes historiques. Le refus de v6 par l'ancien code a été vérifié dans sa garde de versions ; aucun ancien binaire n'a été démarré.

## Vérifications effectuées

- `npm run typecheck` : réussi.
- `npm run lint` : réussi.
- `npm test` : **1 646 tests serveur et 234 tests Vue/unitaires réussis**, 31 fichiers Vitest.
- `npm run build` : réussi.
- Tests ciblés : CRUD et visibilité, promotion privée/refus de capacité/refus sur carte d'autrui/module désactivé, export/import et lien perdu, bouton Vue, modale chargement/erreur/suppression et rendu sécurisé.
- Navigateur réel : création, édition et partage d'un terme ; surlignage et modale ; suppression retirant le surlignage ; promotion corrigée depuis une carte ; promotion depuis une sélection de section avec définition et lien préremplis.
- Serveur Leitner seul, base sans tables Corpus : révision et réglages fonctionnels, aucun bouton Corpus, routes Corpus et promotion absentes, export et import v6 signalant les termes non pris en charge.
- Serveur Corpus seul, base sans cartes Leitner : création d'un terme fonctionnelle, route de révision absente.
- Migration éprouvée avec une ancienne section portant deux alias : terme principal, alias secondaire, définition et partage préservés. Le cas vide ne constitue donc pas l'unique preuve.

Les essais serveur/navigateur et la preuve de migration ont utilisé trois bases jetables distinctes des données réelles. Les serveurs ont été arrêtés et ces bases supprimées après validation. Aucune migration n'a été appliquée à la base réelle dans cette étape.

## Fichiers principaux

- `app/modules/corpus/{controllers/glossary_term_controller.ts,models/glossary_term.ts,migrations/1787100000000_create_glossary_terms_table.ts,pages/glossary.vue,pages/index.vue,pages/show.vue}`
- `app/bridges/leitner_corpus/{glossary_index.ts,promotion_controller.ts,glossary_backup.ts}`
- `app/modules/leitner/components/GlossaryPromotionButton.vue`, `pages/index.vue`, `pages/settings.vue`, services de sauvegarde et de provenance, contrôleurs et contrats partagés.
- `app/core/shared/services/course_sections.ts`, `app/core/shared/constants/course.ts`, routes, validators, traductions et documentation des modules.
- Nouvelles specs `corpus_glossary.spec.ts`, `leitner_glossary_promotion.spec.ts`, `leitner_glossary_backup.spec.ts`, `glossary_promotion_button.spec.ts` ; specs existantes adaptées au nouveau contrat.

## État de livraison

Travail sur `cc-277-glossaire-autonome` dans son worktree, sans modification ni fusion de `master`. Modifications non commitées : les validations ne constituent pas un commit, une PR ou un déploiement. Le ticket est prêt pour vérification ; l'orchestrateur conserve le choix de la suite.
