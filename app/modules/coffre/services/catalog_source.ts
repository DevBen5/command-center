/**
 * L'abstraction de source du catalogue (CC-225, lot 1 de l'épique CC-224) — étroite par
 * construction : énumérer, et donner de quoi rendre une vignette. Elle ne connaît RIEN des règles
 * de sécurité propres à chaque source (confinement NAS, élévation Immich) : chaque implémentation
 * porte les siennes, comme `NasRootsService` ou la session élevée du dossier verrouillé.
 *
 * ⚠️ **`enumerate()` est tout-ou-rien : elle rend un résultat complet, ou elle LÈVE.** Elle ne rend
 * jamais un résultat partiel — une erreur en cours de parcours doit faire perdre tout ce qui avait
 * déjà été collecté, pas rendre ce qu'on a pu obtenir. C'est ce qui permet à
 * `catalog_sync_service.ts` de traiter « énumération levée » et « rien à faire » comme un seul et
 * même cas : ne RIEN écrire en base, jamais marquer quoi que ce soit absent. Un NAS démonté ou une
 * session Immich expirée doivent produire une exception, jamais une liste vide qui serait prise
 * pour un « plus rien dans la source ».
 *
 * ⚠️ **`truncated` n'est pas une erreur, mais elle interdit quand même de marquer une absence.**
 * Une énumération tronquée (plafond de pages atteint) a réussi, mais elle n'a pas VU tout le
 * contenu réel de la source : ce qu'elle n'a pas vu ne doit pas être pris pour « disparu ».
 */
export type CatalogSourceKey = 'immich_locked' | 'nas'

export type CatalogItemNature = 'photo' | 'video' | 'other'

/** Un élément tel qu'une source le rend, avant tout enregistrement en base. */
export interface CatalogSourceItem {
  /** La référence dans CETTE source — UUID Immich, ou chemin relatif à une racine pour le NAS. */
  reference: string
  nature: CatalogItemNature
  displayName: string | null
  /**
   * ⚠️ **Un epoch en millisecondes, JAMAIS un `DateTime` Luxon ni un `Date` (CC-244).** Une
   * énumération est tout-ou-rien (voir ci-dessus) : ses éléments s'accumulent TOUS en mémoire
   * avant la moindre écriture, donc chaque octet par élément est multiplié par le contenu entier
   * de la source. Mesuré le 2026-08-12 sur les **126 023 fichiers du NAS réel**, à travers son
   * partage SMB : **942 o/élément** avec un `DateTime` (113,2 Mo), **277 o/élément** avec un epoch
   * (33,3 Mo) — Luxon pesait à lui seul 80 Mo sur 113, pour porter une date qui ne sert qu'une
   * fois, à l'écriture Lucid. Une énumération SYNTHÉTIQUE aux chemins plus longs (le pire cas
   * retenu pour dimensionner `MAX_NAS_WALK_ITEMS`) donne 1 018 / 465 / 369 o par élément selon
   * qu'on porte un `DateTime`, un `Date` ou un epoch.
   *
   * ⚠️ **La conversion vit dans `catalog_sync_service.ts`, et NULLE PART ailleurs** : c'est le
   * seul consommateur de ce champ. Ne « simplifie » pas en refabriquant un `DateTime` dans une
   * source — ce serait rétablir exactement le coût que ce champ existe pour éviter.
   *
   * ⚠️ **`0` est une valeur LÉGITIME (1ᵉʳ janvier 1970), et elle est *falsy*.** Tout test de ce
   * champ s'écrit `=== null`, jamais une vérité au sens JavaScript : un `mtime` cassé à l'epoch 0
   * — ce qu'un NAS produit sans prévenir — deviendrait sinon `captured_at NULL` en base, sans
   * erreur, sans test rouge. Un `DateTime | null` ne pouvait pas produire ce mode d'échec, un
   * objet étant toujours *truthy* ; cette représentation, si.
   */
  capturedAt: number | null
  sizeBytes: number | null
}

export interface CatalogEnumeration {
  items: CatalogSourceItem[]
  truncated: boolean
}

/** Ce qu'il faut pour rendre une vignette — le second besoin de l'écran de consultation (lot 3). */
export interface CatalogThumbnail {
  bytes: Buffer
  contentType: string
}

export interface CatalogSource {
  readonly key: CatalogSourceKey

  /** Voir la doctrine ci-dessus : tout-ou-rien, ne rend jamais un résultat partiel. */
  enumerate(): Promise<CatalogEnumeration>

  thumbnailFor(reference: string): Promise<CatalogThumbnail>
}
