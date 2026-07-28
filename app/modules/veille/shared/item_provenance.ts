/**
 * D'où vient un item — la pastille de provenance de `pages/index.vue` (CC-104).
 *
 * **Pur, serveur ET page**, comme `shared/interval.ts` : la dérivation est faite par
 * `VeilleController.serialize`, le template ne fait que traduire et colorer. Ce choix n'est pas
 * une commodité — c'est la même décision que celle prise trois lignes plus haut dans cette
 * méthode pour `immichAssetId` : *ce qui se déduit de `dedup_key` se déduit au serveur, pas dans
 * un template*. Laisser la page trancher supposerait qu'elle reçoive `dedupKey`, or elle ne le
 * lit nulle part et n'a aucune raison de commencer.
 *
 * ⚠️ **Aucun import par alias `#modules/*` dans ce fichier.** L'alias mappe vers
 * `./app/modules/*.js`, qui n'existe qu'après un build : Vite ne le résout pas et la page casse.
 * Ce fichier n'importe rien, et les types sont recopiés structurellement — même motif que
 * `media_item.ts` et `item_selection.ts`. Le garde-fou est `npm run build`, `tsc` ne lisant pas
 * les `.vue`.
 */

/** Recopié structurellement depuis `models/veille_source.ts` : voir l'avertissement ci-dessus. */
export type SourceKind = 'rss' | 'immich' | 'youtube'

/** Le minimum qu'il faut connaître d'une source pour la nommer. */
export type ProvenanceSourceView = {
  id: number
  title: string
  kind: SourceKind
}

/**
 * Le minimum qu'il faut connaître d'un item.
 *
 * ⚠️ **`dedupKey` n'est jamais parsé ici, seule sa nullité est lue.** La tentation est réelle :
 * son préfixe (`immich:`, `youtube:`, `url:`) dirait la provenance sans passer par `sources`.
 * Mais ce préfixe est ce qui aiguille le proxy de vignette (CC-88) — c'est une clé de routage
 * interne, pas une étiquette d'affichage, et la faire lire par deux mécaniques indépendantes en
 * ferait une seconde source de vérité. Ce qui compte ici est binaire : *collecté, ou saisi ?*
 * `dedup_key` est nul pour une capture manuelle, et pour elle seule.
 */
export type ProvenanceItemView = {
  veilleSourceId: number | null
  dedupKey: string | null
  metadata: Record<string, unknown> | null
}

export type ProvenanceOrigin = 'source' | 'manual' | 'orphan'

/**
 * ⚠️ **Des clés i18n, pas des libellés** — même raison que `sourceUrlLabelKey` : traduire ici
 * forcerait `shared/` à connaître `useI18n`, or ce fichier doit rester importable par Japa sans
 * compilateur Vue, et par le contrôleur sans contexte de requête.
 *
 * `labelKey` nul signifie « `text` se suffit » : un titre de source vient de la base et ne se
 * traduit pas. Le template n'a donc qu'une ligne à écrire, sans savoir lequel des deux cas il a.
 */
export type ItemProvenance = {
  origin: ProvenanceOrigin
  /** Ce qui colore la pastille. Nul dès qu'il n'y a plus de source vivante. */
  sourceKind: SourceKind | null
  labelKey: string | null
  /** Ce qui vient de la base : titre de la source, ou titre mémorisé dans `metadata`. */
  text: string | null
}

export const PROVENANCE_MANUAL_KEY = 'veille.index.provenance.manual'
export const PROVENANCE_DELETED_KEY = 'veille.index.provenance.deleted'
export const PROVENANCE_DELETED_NAMED_KEY = 'veille.index.provenance.deletedNamed'

/**
 * Le titre que la collecte avait mémorisé dans `metadata`, s'il est exploitable.
 *
 * ⚠️ **Accès défensif, comme `channelLabel`.** `metadata` est du `jsonb` : son contenu dépend de
 * la version qui a écrit la ligne, et une ligne éditée à la main peut y porter n'importe quoi.
 * Sans ce contrôle, la pastille afficherait `Source supprimée — [object Object]`.
 */
export function rememberedSourceTitle(metadata: Record<string, unknown> | null): string | null {
  const raw = metadata?.sourceTitle
  if (typeof raw !== 'string') return null

  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * La provenance à afficher, dans tous les cas.
 *
 * ⚠️ **Le repli ne masque jamais.** Une provenance inconnue affiche ce qu'elle sait plutôt que
 * rien : une pastille absente laisserait exactement le trou que ce ticket vient combler, et
 * serait indiscernable d'un item dont la provenance est simplement vide. Même raisonnement que
 * `sourceUrlLabelKey`, qui montre l'`url` brute plutôt que de cacher la ligne.
 *
 * ⚠️ **Un `veilleSourceId` non nul mais introuvable dans `sources` retombe sur la branche
 * orpheline.** Le cas est inatteignable aujourd'hui — la FK est `ON DELETE SET NULL`, donc un id
 * non nul désigne une source vivante, et `VeilleController.index` les charge *toutes*, sans
 * filtre sur `active`. Un `where('active', true)` ajouté plus tard le rendrait atteignable en une
 * ligne, et CC-65 parle justement d'afficher l'état des sources désactivées dans cette barre :
 * l'item dirait alors « source supprimée » au lieu de disparaître de l'écran.
 */
export function itemProvenance(
  item: ProvenanceItemView,
  sources: readonly ProvenanceSourceView[]
): ItemProvenance {
  const source =
    item.veilleSourceId === null
      ? undefined
      : sources.find((candidate) => candidate.id === item.veilleSourceId)

  if (source !== undefined) {
    return { origin: 'source', sourceKind: source.kind, labelKey: null, text: source.title }
  }

  // Ni source vivante, ni clé de dédup : personne ne l'a collecté, donc quelqu'un l'a saisi.
  if (item.veilleSourceId === null && item.dedupKey === null) {
    return { origin: 'manual', sourceKind: null, labelKey: PROVENANCE_MANUAL_KEY, text: null }
  }

  const remembered = rememberedSourceTitle(item.metadata)

  return {
    origin: 'orphan',
    sourceKind: null,
    labelKey: remembered === null ? PROVENANCE_DELETED_KEY : PROVENANCE_DELETED_NAMED_KEY,
    text: remembered,
  }
}
