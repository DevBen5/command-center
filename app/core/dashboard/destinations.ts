import type { Destination } from '#core/shared/navigation/registry'

/**
 * La destination du tableau de bord.
 *
 * ⚠️ **Elle est déclarée en premier dans `start/navigation.ts`, et c'est ce qui en fait la page
 * d'accueil** de quiconque porte `dashboard.view` — l'ordre du registre est l'ordre de
 * l'atterrissage. Ce n'est plus un `/` écrit en dur dans trois contrôleurs : un compte qui n'a
 * pas cette capacité passe simplement à la destination suivante.
 */
export const DASHBOARD_DESTINATIONS: readonly Destination[] = [
  { key: 'accueil', href: '/', access: { capability: 'dashboard.view' } },
]
