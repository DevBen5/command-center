/*
| Le jeton CSRF des routes d'écriture NAS (CC-240), appelées en `fetch` — pas de copie partagée
| avec le module Leitner (`components/leitner_csrf.ts`) : « un module n'importe pas chez un
| voisin » (voir le `CLAUDE.md` racine). Même contenu, même raison d'être, copie locale.
|
| ⚠️ Un `.ts` de `app/` est compilé par le tsconfig SERVEUR, sans la lib `dom` — d'où le `declare`
| plutôt qu'un `/// <reference lib="dom" />`, qui la chargerait pour tout le programme serveur.
*/

declare const document: { cookie: string }

/**
 * ⚠️ Sans `x-xsrf-token`, un POST/PUT/DELETE est rejeté par un flash + `redirect().back()`, même
 * sur `accept: application/json` — le `fetch` suivrait la redirection et lirait de l'HTML.
 */
export function xsrfToken(): string {
  const cookie = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/)
  return cookie ? decodeURIComponent(cookie[1]) : ''
}
