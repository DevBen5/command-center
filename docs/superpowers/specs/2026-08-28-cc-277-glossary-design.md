# CC-277 — Glossaire autonome

## Décisions

- `> notion:` est supprimé ; une migration transforme ses alias historiques.
- Les termes sont privés par défaut et partageables par leur propriétaire.
- Une définition Markdown est libre ; une section de cours est une référence facultative.
- La promotion depuis une carte est incluse.

## Frontière

Corpus possède les termes, leur visibilité et leur CRUD. Leitner possède la révision et le rendu du recto. `app/bridges/leitner_corpus/` ne se charge que si les deux modules sont présents et fournit l’index lisible par Leitner.

## Données et échange

Un terme porte son nom canonique, ses alias, sa définition, son propriétaire, son partage et éventuellement une section. La suppression de la section retire seulement la référence. L’export/import passe en v6 et préserve un terme même si la référence ne peut pas être résolue.

## Sûreté

La visibilité est appliquée à l’index, au détail, à l’export et à l’import. Le recto continue de rejouer des nœuds HTML sûrs avec Vue ; aucune promotion ne reconstruit de HTML.
