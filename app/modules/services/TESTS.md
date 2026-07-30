# Services — ce que couvre la suite

Sorti de `CLAUDE.md` pour ne pas être chargé à chaque fois qu'on touche au module. À lire **avant
de modifier un test**, pas avant de modifier le module. Les règles qui, elles, doivent rester
présentes en permanence sont dans `CLAUDE.md`.

## La disponibilité Docker (CC-116)

- `tests/unit/services_docker_config.spec.ts` — le défaut de `config/docker.ts`, et le cas qui
  compte est **`('production', undefined)`** : l'oubli de la variable sur le NAS doit aller vers
  la bannière « hors service », jamais vers des conteneurs imaginaires. Plus le comportement de
  dev/test inchangé, et l'override gagnant dans les deux sens.
- `tests/functional/modules/services_offline.spec.ts` — l'écran et les actions sous
  « indisponible » : GET `/services` rend le flag faux et **aucun service** (une ligne existe en
  base, elle ne descend pas), un POST d'action laisse le statut **inchangé** — la garde serveur,
  pas le masquage Vue. Le chemin se force en **mutant `dockerConfig.disponible`** (restauré en
  teardown) : c'est aussi le test qui rougit si le contrôleur destructure le flag à l'import.
  Le second groupe prouve le pendant — sous le défaut de test, flag vrai et services présents.

## La page

- `app/modules/services/pages/__tests__/index.spec.ts` — les deux logiques de `pages/index.vue` :
  la **pluralisation** du compteur d'arrêtés (CC-90 — le cas témoin est `down = 0`, qui doit
  rester au singulier), et le **masquage hors service** (CC-116) — bannière rendue, et surtout
  l'absence des cartes, de la bande d'indicateurs et de la barre d'outils, montées avec un
  service en props pour que l'assertion négative morde.
