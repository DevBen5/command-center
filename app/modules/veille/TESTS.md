# Veille — ce que couvre la suite

Sorti de `CLAUDE.md` pour ne pas être chargé à chaque fois qu'on touche au module. À lire **avant
de modifier un test**, pas avant de modifier le module. Les règles qui, elles, doivent rester
présentes en permanence sont dans `CLAUDE.md`, section « Tests ».

## Le collecteur RSS

- `tests/unit/veille_feed_url.spec.ts` — **la garde SSRF**, le test qui compte du lot, pendant exact
  de `leitner_llm_url.spec.ts`. Loopback, plages privées, `169.254.169.254`, IP déguisées en décimal
  et hexadécimal, identifiants dans l'URL, protocoles non http(s), noms internes. Plus la frontière
  exacte de `172.16/12` : `172.15` et `172.32` sont **publiques**, les exclure interdirait des flux
  légitimes.
- `tests/unit/veille_feed_redirect.spec.ts` — ce qui la **complète**, et le seul test du module à
  émettre une vraie requête (deux serveurs jetables sur `127.0.0.1:0`, fermés en teardown — sans quoi
  `forceExit: false` fige `npm test`). L'assertion qui porte le test est `hits === 0`, pas
  l'exception : la cible rend un flux **valide**, donc un test qui n'asserterait que « ça lève »
  passerait à tort. Il couvre aussi le pendant : **une redirection légitime EST suivie**.
- `tests/unit/veille_feed_parser.spec.ts` — Atom ≡ RSS 2.0 champ par champ, l'**invariant sans `<` ni
  `>`**, le décodage d'entités en une passe (`&amp;lt;` reste `&lt;`), la canonicalisation d'URL, et
  la clé de dédup — dont **la même clé pour le même article vu par deux flux différents**, la
  propriété que le lot achète.
- `tests/functional/modules/veille_sources.spec.ts` — la collecte : **le même item deux fois n'en
  fait qu'un** (contre la base *et* dans une même passe), **un flux en erreur n'empêche pas les
  autres**, le flux à zéro entrée signalé, le 304 qui n'écrase pas le compteur, et surtout
  **l'etag non mémorisé quand l'insert a échoué**. Côté CC-59 : la création en mode horaire, les
  cinq dépareillages mode/heure refusés, la bascule aller-retour qui ne perd ni la cadence ni
  l'heure, et **la contrainte en base vérifiée pour elle-même** — un cas par test, une écriture
  refusée avortant la transaction du test.

## La cadence et l'horaire

- `tests/unit/veille_interval.spec.ts` — **CC-57** : les deux propriétés d'aller-retour (l'universelle
  et celle qui ne vaut que pour les couples canoniques), la table de lecture (30 · 60 · 90 · 1440 ·
  2880 · 10080), les bornes par unité, et le wording affiché — qui régresse en silence. Plus, pour
  **CC-59**, la lecture d'une heure du jour : la forme `'07:00:00'` du driver `pg`, le `null`
  rendu au lieu d'une exception, et « tous les jours à 7h00 » à côté de « tous les 2 jours ».
- `tests/unit/veille_schedule.spec.ts` — **CC-59**, et c'est le test qui porte le lot. Il rejoue la
  boucle du planificateur minute par minute et vérifie **la liste exacte des collectes** : une par
  jour, à l'heure dite. Dedans, deux choses qui ne se voient nulle part ailleurs :
  **la dérive**, montrée côte à côte — avec une heure de retard par collecte, l'horaire tient 7h
  pendant sept jours quand l'intervalle glisse jusqu'à 14h ; et **le fuseau**, où `06:30` UTC
  (= 7h30 à Paris) doit rendre la source due. Ce second test est celui qui tombe si le `setZone`
  disparaît — sans lui, la régression serait parfaitement silencieuse. Plus les changements
  d'heure (mars et octobre, dont une heure qui n'existe pas ce jour-là), le rattrapage d'une
  fenêtre manquée, la source neuve, et le repli d'un mode `daily` sans heure.
- `tests/unit/veille_schedule_draft.spec.ts` — **CC-60**, la logique de `pages/sources.vue` sortie du
  `.vue`. Le test qui porte le lot est **l'heure du driver `pg` face à celle du champ** : une source
  à `'07:00:00'` et un brouillon à `'07:00'` sont la **même** cadence, donc rien à enregistrer.
  Retire le `normalizeTimeOfDay` de `isScheduleDirty` et il rougit ; mets-le des deux côtés et c'est
  le test voisin (« une heure réellement changée est bien vue ») qui rougit. Les deux ensemble
  tiennent la fonction. Plus les bornes par unité, le payload qui ne poste que les champs de son
  mode, et la conversion d'unité sans arrondi. ⚠️ Ce qu'il ne voit **pas** : le template, et
  l'enveloppe `isScheduleDirty` de la page — la couture que l'extraction crée.

## La liste et la recherche

- `tests/functional/modules/veille_items.spec.ts` — **CC-20** : la recherche plein texte (dont
  l'apostrophe, l'injection SQL et les caractères spéciaux — avec une assertion sur le **résultat**,
  pas seulement sur l'absence de crash), le filtre par tag accentué, `store`, `toggleQueue`,
  `toggleRead`, la pagination sans chevauchement, et que **la capture manuelle survit à la
  migration**.

## Immich

- `tests/unit/veille_immich_asset.spec.ts` — **CC-55**, la lecture d'un asset : du code pur, donc le
  test qui compte du lot. Les **deux** formes de durée (une regex trop stricte ferait disparaître la
  durée sans erreur), le tag réseau **par jeton entier** (`retikTokage.mp4` ne donne rien — c'est
  aussi pourquoi `x` n'est pas dans la liste), l'aller-retour de la clé de dédup, et surtout ce qui
  **ne rend rien** : `AUDIO`/`OTHER`, un identifiant qui n'est pas un UUID, `immich:../../secret`.
- `tests/unit/veille_immich_client.spec.ts` — ce que le client fait **réellement** d'une réponse
  (`fetch` remplacé, aucun réseau). Le test qui porte le lot est **« un 200 en text/html est une
  erreur explicite, pas un album vide »** : vérifié mordant — désactive l'assertion de
  `content-type` et il rougit seul. Plus la pagination qui suit un `nextPage` **en chaîne**, le refus
  des 3xx, la clé en en-tête et jamais dans l'URL, `albumIds` toujours présent (sans lui, toute la
  bibliothèque personnelle entrerait dans la veille), et les messages distincts 401 / 400. Depuis
  **CC-63** : **`force: false` lu dans le corps réellement émis** — le seul endroit du dépôt où
  cette valeur se prouve —, le 204 sans corps traité comme un succès, `trashDays` où tout ce qui
  n'est pas un nombre vaut `0`, et le refus qui nomme `asset.delete` plutôt que de parler d'une
  instance injoignable.
- `tests/unit/veille_media_item.spec.ts` — **CC-55**, la logique média sortie de `index.vue` : le
  lien construit à l'affichage (jamais stocké), la vignette pointée sur **notre** proxy, et une
  durée qui ne s'affiche pas quand il n'y en a pas. Ce qu'il ne voit **pas** : le template et les
  enveloppes de la page.
- `tests/functional/modules/veille_immich.spec.ts` — la collecte. **« Une erreur d'API ne marque
  AUCUN asset disparu »** est le test qui porte le lot, et il est vérifié mordant : entoure
  `albumAssets()` d'un `try/catch` et lui plus « last_error » rougissent. Plus la deuxième collecte
  qui n'ajoute rien, le même asset deux fois dans une passe, l'asset sorti **puis remis**, l'album
  vidé qui se voit, l'aiguillage par `kind`, l'alignement de la source sur `.env` (dont **la source
  désactivée à la main qui n'est jamais réactivée**), et le proxy — item non-média, item inconnu,
  asset disparu, et la clé d'API absente de la réponse.

## La suppression (CC-63)

- `tests/functional/modules/veille_deletion.spec.ts` — le test qui porte le lot est **« un article
  supprimé ne revient pas à la collecte suivante »** : le faux flux republie les mêmes entrées, et
  sans pierre tombale la seconde passe les réinsère. Vérifié mordant — remplace le marquage par un
  vrai `delete()` et il rougit, avec quatre autres. Puis les deux garde-fous d'Immich : **un échec
  ne marque rien**, et **`trashDays: 0` n'émet même pas l'appel** — l'assertion qui porte ce dernier
  est `trashed` vide, pas `deletedAt` nul, parce que « rien en base » serait aussi vrai si l'appel
  partait et échouait. Plus **un test par lecture** (liste · compteurs · tags · recherche ·
  pagination · type/source · proxy de vignette), la réconciliation qui ignore les supprimés, l'asset
  revenu dans l'album qui ne ressuscite rien, la sélection mixte dont seuls les articles partent,
  l'idempotence du double-clic, Immich retiré de la configuration, **la page vidée qui recule sans
  perdre le filtre**, le clic sans effet qui le dit, et le plafond de 200 ids qui refuse **le lot
  entier**.
- `tests/unit/veille_item_selection.spec.ts` — la logique de sélection sortie d'`index.vue`. Le test
  qui compte est **la confirmation qui annonce le nombre d'assets partant à la corbeille** : sans ce
  nombre, le dialogue laisserait croire qu'on ne touche qu'à Command Center. Plus le résumé qui ne
  compte que les items **affichés** (une sélection survivant à un changement de page annoncerait un
  nombre invérifiable), et le silence sur Immich quand aucun média n'est concerné — un avertissement
  affiché à tort ne se lit plus quand il compte. ⚠️ Ce qu'il ne voit **pas** : le template, les
  cases, et le `confirm()` lui-même.
