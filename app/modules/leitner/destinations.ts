import type { Destination } from '#core/shared/navigation/registry'

/**
 * La destination du module Leitner.
 *
 * ⚠️ **`/revision`, pas `/leitner`** — c'est la route du module, et une destination désigne une
 * route existante, pas le nom du dossier.
 *
 * `leitner.view` et non `leitner.stats.view` : c'est l'écran d'entrée du module. Un compte qui ne
 * porterait que les stats n'atterrit donc pas ici — il n'a pas de destination, et c'est correct :
 * `/revision/stats` est un onglet, pas une porte d'entrée.
 */
export const LEITNER_DESTINATIONS: readonly Destination[] = [
  { key: 'revision', href: '/revision', access: { capability: 'leitner.view' } },
]
