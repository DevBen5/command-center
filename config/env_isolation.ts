/**
 * En test, l'environnement ne fournit **rien** aux clients externes (CC-101).
 *
 * ⚠️ **Ce n'est pas `.env.test` qui neutralise, et ça ne l'a jamais fait.** Le chargeur
 * d'`@adonisjs/env` fusionne les fichiers en testant la **truthiness**, jamais la présence
 * (`node_modules/@adonisjs/env/build/index.js:226-235`) : une chaîne vide y est indiscernable de
 * « non défini ». `.env.test` pose `""`, `.env` passe derrière, trouve une valeur falsy, et
 * **écrase**. `DB_DATABASE=app_test` gagne pour la seule raison qu'il est non vide — c'est ce qui
 * rendait le défaut si convaincant : le fichier *paraît* fonctionner.
 *
 * Conséquence mesurée en CC-88 : un test fonctionnel a réellement reçu un `200 image/webp` de
 * l'instance Immich du poste. La garantie « aucun test ne touche une vraie instance » ne reposait
 * en fait que sur les `app.container.swap` — un seul oubli suffisait à envoyer de vraies requêtes,
 * avec la clé d'API, vers une bibliothèque de photos personnelles.
 *
 * ⚠️ **Ne « rétablis » pas des valeurs vides dans `.env.test` en croyant refermer le trou** : elles
 * ne font rien. Une sentinelle non vide serait pire encore — `IMMICH_BASE_URL=disabled-in-tests`
 * gagnerait bien la fusion, **et rendrait `enabled` vrai**, puisque `enabled` teste la
 * non-vacuité. Le contournement aggraverait le défaut qu'il prétend corriger.
 *
 * ⚠️ **Cette garde ne va jamais dans les fonctions `normalize*`.** Les tests construisent
 * délibérément des configurations **activées** pour couvrir le chemin « configuré »
 * (`tests/unit/veille_youtube_config.spec.ts`) : l'y placer les rendrait intestables. Elle agit au
 * seul endroit où l'environnement est lu — la composition `*ConfigFrom` de chaque `config/*.ts`.
 *
 * ⚠️ **`process.env` reste pollué** par les vraies valeurs : le chargeur les y écrit
 * (`index.js:230`) et `env.get()` continuera de les rendre. Sans effet tant que rien ne lit ces
 * variables hors des `config/*.ts`, ce qui est vrai aujourd'hui — mais une lecture directe ajoutée
 * ailleurs passerait au travers de cette garde sans que rien ne le signale.
 *
 * `NODE_ENV` est posé à `'test'` par `bin/test.ts:13`, avant tout import, donc avant que le moindre
 * `config/*.ts` ne soit évalué.
 */
export function externalServicesIsolated(nodeEnv: string | undefined): boolean {
  return nodeEnv === 'test'
}
