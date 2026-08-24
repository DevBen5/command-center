import type { Destination } from '#core/shared/navigation/registry'

/**
 * La destination du module corpus (CC-275, extrait de Leitner — l'ancien onglet « Cours »
 * de `LeitnerTabs`). Route top-level, PAS nested sous `/revision` : le contrat du
 * détachement veut que le corpus fonctionne sans Leitner, son URL ne peut donc pas
 * dépendre du préfixe historique d'un module qui pourrait être absent.
 */
export const CORPUS_DESTINATIONS: readonly Destination[] = [
  { key: 'corpus', href: '/corpus', access: { capability: 'corpus.view' } },
]
