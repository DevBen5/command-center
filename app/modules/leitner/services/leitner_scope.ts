import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type LeitnerCard from '#modules/leitner/models/leitner_card'

/**
 * Un sous-ensemble de cartes désigné par le classement : tout, un thème, une
 * catégorie (donc tous ses thèmes), ou les cartes non classées.
 *
 * C'est le **paquet** d'une session de révision (`/revision?theme=3`) autant que le
 * filtre du catalogue (`/revision/settings`) : les deux disent la même chose, et
 * s'appuient sur `applyScope` plutôt que d'en recopier chacun la traduction SQL.
 */
export type CardScope =
  | { kind: 'all' }
  | { kind: 'unclassified' }
  | { kind: 'category'; id: number }
  | { kind: 'theme'; id: number }

/** Aucune restriction — la valeur par défaut partout où un paquet est facultatif. */
export const ALL_CARDS: CardScope = { kind: 'all' }

/**
 * Restreint une requête sur `leitner_cards` à un paquet. Mute le builder (comme
 * tout Lucid) et ne touche ni à l'ordre, ni aux autres conditions.
 *
 * ⚠️ **Une carte ne connaît que son thème, jamais sa catégorie** : `leitner_cards`
 * n'a pas de `leitner_category_id`. Un paquet de catégorie passe donc par une
 * sous-requête sur `leitner_themes` — et c'est ici, une seule fois, qu'elle s'écrit.
 */
export function applyScope(
  query: ModelQueryBuilderContract<typeof LeitnerCard, LeitnerCard>,
  scope: CardScope
): void {
  switch (scope.kind) {
    case 'all':
      return
    case 'unclassified':
      query.whereNull('leitner_theme_id')
      return
    case 'theme':
      query.where('leitner_theme_id', scope.id)
      return
    case 'category':
      query.whereIn('leitner_theme_id', (sub) =>
        sub.from('leitner_themes').select('id').where('leitner_category_id', scope.id)
      )
  }
}
