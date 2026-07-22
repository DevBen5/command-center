/*
|------------------------------------------------------------------------------
| Le jeton CSRF des routes JSON du module — l'unique copie
|------------------------------------------------------------------------------
|
| Trois écrans du module appellent des routes qui rendent du **JSON nu**, hors
| Inertia : l'extraction d'un document (`ingest.vue`), le diagnostic du LLM
| (`llm.vue`) et le juge de la réponse écrite (`index.vue`). Tous les trois
| passent par `fetch`, donc tous les trois doivent porter ce jeton à la main —
| Inertia le pose seul, `fetch` non.
|
| Cette fonction vivait en trois exemplaires, dont un divergent. C'est le genre
| de duplication que ce module traque ailleurs (`applyScope`) : une copie qui
| dérive rend le bug impossible à voir, puisque les autres écrans continuent de
| marcher.
|
| Du code pur, sans dépendance Vue : il vit donc dans `components/` à côté de
| `leitner_scope_search.ts`, et pour la même raison.
|
| ⚠️ **Pourquoi ce `declare` plus bas, et pas la lib DOM.** Un `.ts` de `app/` est
| compilé par le tsconfig **serveur**, qui n'a pas la lib `dom` — le tsconfig client
| (`inertia/tsconfig.json`) ne ramasse que les `.vue` des dossiers `pages/`, jamais un
| `.ts` de module. C'est exactement ce qui avait poussé cette fonction à vivre en trois
| exemplaires dans des `.vue`.
|
| Un `/// <reference lib="dom" />` chargerait la lib DOM dans **tout** le programme
| serveur : un service backend qui utiliserait `document` par erreur cesserait d'être
| détecté. On déclare donc le seul contrat utilisé, et il reste **local à ce module**.
*/

/**
 * Le strict nécessaire de l'API navigateur. Ce module n'est consommé que par des `.vue`
 * — ne l'importe jamais depuis un service serveur : ça compilerait, et planterait à
 * l'exécution sur un `document is not defined`.
 */
declare const document: { cookie: string }

/**
 * Le jeton CSRF, repris du cookie `XSRF-TOKEN` que pose Shield (`enableXsrfCookie`).
 *
 * ⚠️ **Sans l'en-tête `x-xsrf-token`, le POST est rejeté** — et pas par un 403 lisible :
 * le gestionnaire d'exceptions traite `E_BAD_CSRF_TOKEN` par un flash et un
 * `redirect().back()`, **même sur un `accept: application/json`**. Le `fetch` suit la
 * redirection et lit de l'HTML : l'appelant croit à une panne du serveur au lieu de voir
 * un jeton manquant. Ce n'est pas un en-tête optionnel.
 *
 * ⚠️ `x-csrf-token` (sans le `x-` initial du cookie) **échoue en silence** : c'est
 * `x-xsrf-token` qu'attend Shield.
 *
 * La valeur du cookie est URL-encodée : elle se décode avant d'être envoyée.
 */
export function xsrfToken(): string {
  const cookie = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/)
  return cookie ? decodeURIComponent(cookie[1]) : ''
}
