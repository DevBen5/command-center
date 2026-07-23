import type { Destination } from '#core/shared/navigation/registry'

/**
 * La destination du module Services.
 *
 * ⚠️ **`admin`, et aucune capacité** — c'est le même invariant que dans `start/capabilities.ts` :
 * ce module pilote Docker (`SystemStatsService`), et une capacité pourrait être accordée par un
 * rôle. Le drapeau `is_admin` ne s'accorde pas, il se donne à une personne.
 *
 * Il n'existe donc pas de compte non-admin dont ce soit l'atterrissage : le registre saute cette
 * destination pour tout le monde sauf un administrateur.
 */
export const SERVICES_DESTINATIONS: readonly Destination[] = [
  { key: 'services', href: '/services', access: { admin: true } },
]
