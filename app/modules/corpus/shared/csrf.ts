/*
| Le jeton CSRF des routes JSON du module (CC-275, extrait de Leitner avec le corpus de
| cours) — pas de copie partagée avec Leitner (`components/leitner_csrf.ts`) ni avec le
| coffre (`shared/csrf.ts`) : « un module n'importe pas chez un voisin » (AGENTS.md
| racine). Même contenu, même raison d'être, copie locale — patron déjà suivi par
| `app/modules/coffre/shared/csrf.ts`.
|
| ⚠️ Un `.ts` de `app/` est compilé par le tsconfig SERVEUR, sans la lib `dom` — d'où le
| `declare` plutôt qu'un `/// <reference lib="dom" />`, qui la chargerait pour tout le
| programme serveur.
*/

declare const document: { cookie: string }

/**
 * ⚠️ Sans `x-xsrf-token`, un POST/PUT/DELETE est rejeté par un flash + `redirect().back()`,
 * même sur `accept: application/json` — le `fetch` suivrait la redirection et lirait de
 * l'HTML.
 */
export function xsrfToken(): string {
  const cookie = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/)
  return cookie ? decodeURIComponent(cookie[1]) : ''
}
