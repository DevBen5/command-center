/**
 * L'extraction des clés i18n **écrites en clair** dans un source `.vue` (CC-113).
 *
 * Outillage de test, pas du code applicatif : rien dans l'application ne lit un template pour y
 * chercher des clés. D'où sa place sous `__tests__/` plutôt qu'à côté de `messages.ts`.
 *
 * En revanche il est **séparé du spec**, et pour la raison qui vaut déjà pour `messages.ts` et
 * `inertia/layouts/breadcrumb.ts` : ce qui reste mêlé au glob n'est atteignable par aucun
 * exécuteur. Ici le mode d'échec est précis — un jour quelqu'un « simplifie » la regex, elle
 * cesse de reconnaître les guillemets doubles, le nombre de clés trouvées passe de 475 à 460, le
 * plancher du spec reste satisfait, tout reste vert, et les sites devenus invisibles ne sont plus
 * gardés par rien. Séparé, chaque forme reconnue a son assertion, et l'échec **nomme** la forme
 * perdue.
 */

/**
 * Un appel `t(…)` dont la clé est une chaîne littérale, quelle que soit la forme du guillemet.
 *
 * ⚠️ **La classe `[A-Za-z0-9_.]` est ce qui écarte les clés calculées, sans un seul cas
 * particulier.** Une chaîne gabarit interpolée (`` t(`nav.${item.key}`) ``) porte `$`, `{` et `}` :
 * elle ne correspond simplement pas. Un gabarit *sans* interpolation, lui, est aussi statique
 * qu'une chaîne quotée et doit être trouvé — d'où le backtick dans les guillemets acceptés.
 *
 * ⚠️ **Le `[,)]` final n'est pas cosmétique** : sans lui, une clé qui contiendrait un caractère
 * hors classe correspondrait sur son *préfixe* jusqu'au premier caractère refusé, et on assertirait
 * une clé tronquée — donc une clé absente, donc un rouge qui accuse le mauvais coupable. Avec lui,
 * le site bascule proprement du côté « calculé », c'est-à-dire non couvert et annoncé comme tel.
 *
 * ⚠️ **Le lookbehind exclut `it(`, `at(`, `format(`, `print(`** — tout ce qui finit par un `t` collé
 * à sa parenthèse. `$t(` est accepté (le `$` n'est pas un caractère de mot). `te(` est exclu
 * *structurellement*, la parenthèse devant suivre le `t` immédiatement : c'est heureux, `te()` est
 * précisément le test « cette clé existe-t-elle ? », dont l'absence est la réponse normale
 * (`AppLayout.vue:144`).
 */
const CLE_LITTERALE = /(?<![A-Za-z0-9_$])\$?t\(\s*(['"`])([A-Za-z0-9_.]+)\1\s*[,)]/g

/**
 * Tout site d'appel `t(…)`, clé calculée comprise.
 *
 * Sert au plancher du spec : c'est en comparant ce compte à celui des clés littérales qu'on sait
 * combien de sites échappent à l'extraction, plutôt que de le supposer.
 */
const APPEL = /(?<![A-Za-z0-9_$])\$?t\(/g

/** Les clés écrites en clair dans ce source, dans l'ordre du fichier, doublons compris. */
export function extractKeys(source: string): string[] {
  return [...source.matchAll(CLE_LITTERALE)].map((occurrence) => occurrence[2])
}

/** Le nombre de sites `t(…)`, qu'ils portent une clé littérale ou calculée. */
export function countCalls(source: string): number {
  return [...source.matchAll(APPEL)].length
}
