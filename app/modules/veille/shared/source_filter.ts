/**
 * Le filtre par source de `pages/index.vue` — **trois états, pas deux** (CC-105).
 *
 * **Pur, serveur ET page**, comme `shared/interval.ts` : le contrôleur parse ce qui arrive de
 * l'URL, la page pose la sentinelle. Une seconde définition de `'none'` côté navigateur ferait
 * diverger ce qui est cliqué de ce qui est filtré, et la divergence serait muette.
 *
 * ⚠️ **Aucun import par alias `#modules/*` dans ce fichier** : l'alias vise des `.js` qui
 * n'existent qu'après un build, Vite ne les résout pas et la page casse.
 */

/**
 * « Les items rattachés à aucune source ».
 *
 * ⚠️ **Une chaîne, et surtout pas `0`.** `applyFilters` retire de l'URL tout ce qui vaut `null`,
 * `false` ou `''` : une sentinelle `0` serait retirée de la query string **et** annulée par le
 * parse ci-dessous. Silencieuse deux fois, à deux endroits qui n'ont rien à voir l'un avec
 * l'autre — le genre de panne qu'on diagnostique en une demi-journée.
 */
export const NO_SOURCE = 'none'

/** `number` = une source précise · `'none'` = celles qui n'en ont plus · `null` = pas de filtre. */
export type SourceFilter = number | typeof NO_SOURCE | null

/**
 * Ce qui arrive de `?sourceId=` — **toujours une chaîne**, y compris pour un nombre.
 *
 * ⚠️ **Ce parse remplace `Number(request.input('sourceId')) || null`, et le remplace parce que
 * cette forme-là ne peut pas porter un troisième état.** `Number('none')` vaut `NaN`, donc
 * `NaN || null` vaut `null`, donc **aucun filtre n'est posé** : la liste ne change pas, rien
 * n'est levé, et l'écran est indiscernable d'un filtre qui ne trouverait rien. `'0'` subissait
 * exactement le même sort — `Number('0') || null` vaut `null` — ce qui était sans conséquence
 * tant qu'aucun id ne valait zéro, et l'aurait été le jour où on aurait choisi `0` comme
 * sentinelle.
 *
 * Tout ce qui n'est ni la sentinelle ni un identifiant plausible retombe sur « pas de filtre » :
 * une URL tapée à la main ne doit pas faire une erreur, seulement ne rien filtrer.
 */
export function parseSourceFilter(value: unknown): SourceFilter {
  if (value === NO_SOURCE) return NO_SOURCE

  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}
