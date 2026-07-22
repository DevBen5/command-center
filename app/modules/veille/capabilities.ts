/**
 * Les capacités du module Veille.
 *
 * `veille.view` couvre la lecture, y compris le proxy de vignettes Immich : l'image d'un
 * item n'est pas moins du contenu que son titre.
 *
 * Le rafraîchissement d'une source tombe sous `veille.sources.write` et non sous une
 * capacité de lecture : il fait sortir des requêtes vers l'extérieur et écrit des items
 * en base. Ce n'est pas consulter, c'est déclencher.
 */
export const VEILLE_CAPABILITIES = [
  'veille.view',
  'veille.items.write',
  'veille.sources.write',
] as const
