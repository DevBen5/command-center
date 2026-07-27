/**
 * Le fil d'Ariane de la topbar — **du code pur**, sorti du `<script setup>` d'`AppLayout.vue`.
 *
 * Même raison que pour `inertia/i18n/messages.ts` et les `shared/*.ts` des modules (CC-60) : ce qui
 * vit dans un `<script setup>` n'est atteignable par aucun exécuteur. Ici la décision — quel libellé
 * afficher pour l'écran ouvert — se teste, le rendu non.
 *
 * ⚠️ **Le châssis ne connaît la liste d'aucun écran, et ne doit jamais la connaître** (CC-110). La
 * règle est celle de `start/navigation.ts` : « il connaît la liste des **modules**, jamais celle des
 * écrans ». Une table `chemin → libellé` ici obligerait à la tenir à jour à chaque page ajoutée, et
 * l'oubli ne lèverait rien — l'écran s'afficherait simplement sans son nom.
 *
 * Ce qui la remplace ne s'invente pas : **les clés i18n de premier niveau d'un module portent le nom
 * du fichier de page**. `modules/leitner/stats` → `leitner.stats.*`. C'est exactement l'invariant de
 * la panne silencieuse n° 3 du `CLAUDE.md` racine (« le nom de page Inertia dérive du chemin du
 * fichier »), lu dans l'autre sens.
 */

/**
 * `ingest_show` → `ingestShow`.
 *
 * ⚠️ **Une seule page du dépôt en a besoin, et c'est justement pour ça qu'il faut la convertir
 * explicitement.** Les fichiers de page sont en snake_case, les clés i18n en camelCase ; tant qu'un
 * nom tient en un mot les deux coïncident, et on peut croire qu'il n'y a pas de règle. `ingest_show`
 * est le premier à les séparer.
 */
function toCamelCase(value: string): string {
  return value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

/**
 * Les clés i18n candidates pour nommer l'écran ouvert, **dans l'ordre de préférence**.
 *
 * `crumb` d'abord, `title` en repli : ce sont deux besoins et non un seul libellé à faire tenir dans
 * les deux. `title` sert au `<title>` de l'onglet, où « Configuration du LLM » est juste ; un fil
 * d'Ariane veut « Configuration ». Un module qui n'a pas besoin de la nuance ne pose que `title`.
 *
 * Rend un tableau vide sur un nom de composant qui ne suit pas la forme `couche/module/page` — les
 * pages hors module, s'il en apparaît, n'auront simplement pas de segment.
 *
 * ⚠️ **Le paramètre est `string | undefined`, et ce n'est pas de la prudence gratuite.** Inertia
 * renseigne toujours `page.component` en production ; c'est le *mock* d'`usePage` des tests de
 * composant qui ne le faisait pas, et le layout entier levait — page blanche, pas segment manquant.
 * La disproportion entre la cause et l'effet est ce qui justifie la garde : le pire cas doit être
 * un fil d'Ariane plus court, jamais un écran vide.
 */
export function crumbKeys(component: string | undefined): string[] {
  if (!component) return []

  const parts = component.split('/')
  if (parts.length !== 3) return []

  const [, module, page] = parts
  if (!module || !page) return []

  const key = toCamelCase(page)
  return [`${module}.${key}.crumb`, `${module}.${key}.title`]
}

/**
 * Sommes-nous sur la **racine** du module, c'est-à-dire sur sa destination elle-même ?
 *
 * Auquel cas aucun troisième segment n'est rendu : le fil s'arrête au module, et le `<h1>` porte son
 * libellé. C'est le comportement d'avant CC-110, et il était déjà le bon à cet endroit-là.
 *
 * ⚠️ **La query string est retirée avant comparaison.** `/veille?page=2` et `/veille?tag=rust` sont
 * la racine du module autant que `/veille` : sans ça, la page d'accueil de la veille gagnerait un
 * troisième segment dès le premier filtre cliqué. Le slash final l'est aussi — `/veille/` et
 * `/veille` désignent le même écran.
 */
export function isDestinationRoot(url: string, destinationHref: string): boolean {
  return stripPath(url) === stripPath(destinationHref)
}

function stripPath(value: string): string {
  const path = value.split(/[?#]/)[0]
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}
