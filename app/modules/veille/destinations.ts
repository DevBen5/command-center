import type { Destination } from '#core/shared/navigation/registry'

/**
 * La destination du module Veille.
 *
 * ⚠️ **La capacité citée ici doit être celle que porte réellement `GET /veille`** dans
 * `start/routes.ts`. Les faire diverger enverrait à l'atterrissage un compte droit sur un refus.
 * `tests/functional/core/navigation_registry.spec.ts` croise les deux.
 */
export const VEILLE_DESTINATIONS: readonly Destination[] = [
  { key: 'veille', href: '/veille', access: { capability: 'veille.view' } },
]
