import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import LeitnerCard from '#modules/leitner/models/leitner_card'
import { ALL_CARDS, applyScope, type CardScope } from '#modules/leitner/services/leitner_scope'
import {
  joinProgress,
  orderByMasteredAt,
  selectWithBox,
  whereMastered,
} from '#modules/leitner/services/leitner_progress'
import { applyVisibility } from '#modules/leitner/services/leitner_visibility'
import { UNCLASSIFIED_LABEL } from '#modules/leitner/services/leitner_weakness'
import type { MasteredCard } from '#modules/leitner/shared/mastery_inventory'

/**
 * **La partie base de l'inventaire d'acquis** (CC-262) : ce qui se lit en SQL, séparé de
 * ce qui se calcule — même découpage que `leitner_fluency.ts` / `leitner_fluency_service.ts`
 * et que `leitner_mastery.ts` (le critère) / ce fichier (les lignes).
 *
 * Il existe parce que **deux écrans posent la même question** : `/revision` (l'inventaire
 * complet, daté) et `/revision/stats` (la mesure). Une seconde formulation de « qu'est-ce
 * qui est acquis ? » finirait par diverger de la première, et deux écrans annonceraient
 * deux chiffres également plausibles.
 *
 * ⚠️ **Toutes les lectures passent par `applyVisibility`** (CC-139) — sauf `lostSince`,
 * qui compte l'historique de la personne elle-même (voir sa note). Et **aucune ne
 * construit d'arbre de taxonomie** : le chemin d'une carte se lit sur son thème
 * préchargé, sur des cartes déjà filtrées. C'est délibéré — c'est l'oubli que porte
 * encore `leitner_stats_service.ts` sur sa lecture de catégories.
 */
export default class LeitnerMasteryService {
  /**
   * L'inventaire complet : **toutes** les cartes acquises visibles, la plus récemment
   * acquise d'abord, plus les compteurs qui l'accompagnent.
   *
   * ⚠️ **Sans pagination, et c'est le choix du module** : le catalogue, la série et la
   * heatmap chargent déjà leurs lignes pour compter en JS (volumétrie personnelle). Le
   * propriétaire a demandé à voir **tout** son acquis d'un coup — une pagination le
   * transformerait en écran de recherche.
   *
   * ⚠️ **La progression est PRÉCHARGÉE plutôt que lue dans les `$extras` de la jointure.**
   * `mastered_at` et `next_review` sont des dates : passées par un `select` brut elles
   * arrivent dans le type du driver, à charge de l'appelant de deviner lequel. Préchargées,
   * ce sont des `DateTime` Luxon, comme partout ailleurs dans le module. La jointure reste
   * nécessaire — c'est elle qui porte le filtre `whereMastered`.
   */
  async inventory(userId: number, isAdmin: boolean = false): Promise<MasteredCard[]> {
    const query = LeitnerCard.query()
      .preload('theme', (theme) => theme.preload('category'))
      .preload('progress', (progress) => progress.where('user_id', userId))

    joinProgress(query, userId)
    selectWithBox(query)
    whereMastered(query)
    applyVisibility(query, 'leitner_cards', userId, isAdmin)
    orderByMasteredAt(query)

    const cards = await query

    return cards.flatMap((card) => {
      const progress = card.progress[0]
      // ⚠️ Ceinture : `whereMastered` garantit la ligne et sa date. Une carte qui y
      // échapperait est un bug de requête, pas une carte « sans date » — l'ignorer vaut
      // mieux que de publier un `masteredAt` vide que le regroupement par mois rangerait
      // dans un mois inventé.
      if (!progress?.masteredAt) return []
      const theme = card.theme
      return [
        {
          id: card.id,
          front: card.front,
          path: theme ? `${theme.category.name} · ${theme.name}` : UNCLASSIFIED_LABEL,
          masteredAt: progress.masteredAt.toISO()!,
          nextReview: progress.nextReview.toISO()!,
        },
      ]
    })
  }

  /**
   * Le nombre de cartes acquises **dans ce paquet** — le pendant de `boxCounts`, pour la
   * 6ᵉ case de la grille.
   *
   * ⚠️ **Il suit le paquet, comme les cinq autres cases**, alors que l'inventaire
   * ci-dessus est global : la grille décrit ce qu'on est en train de réviser, l'inventaire
   * décrit ce qu'on a appris. Les deux chiffres peuvent donc différer sur une session de
   * thème, exactement comme `totalCards` ne somme déjà pas la grille (voir le tableau
   * « stats de paquet vs stats globales » du module).
   */
  async masteredCount(
    userId: number,
    scope: CardScope = ALL_CARDS,
    isAdmin: boolean = false
  ): Promise<number> {
    const query = LeitnerCard.query().count('leitner_cards.id as total')

    joinProgress(query, userId)
    whereMastered(query)
    applyScope(query, scope)
    applyVisibility(query, 'leitner_cards', userId, isAdmin)

    const rows = await query
    // Postgres rend `count(*)` en `bigint`, donc en **chaîne** : sans `Number`, la tuile
    // afficherait la bonne valeur mais toute arithmétique dessus concaténerait.
    return Number(rows[0].$extras.total)
  }

  /**
   * Combien de cartes ont **perdu** leur acquis depuis `since` — le chiffre qui rend
   * l'inventaire crédible plutôt qu'auto-congratulant.
   *
   * Deux chemins de perte, et il faut les deux : un `again` en entretien (la dé-maîtrise
   * franche) **et** le 2ᵉ `hard` d'affilée, seul chemin de rétrogradation du module, qui
   * efface l'acquis aussi. Le second se reconnaît à `box_after < box_before`.
   *
   * ⚠️ **`count(distinct …)`, jamais `count(*)`** : une carte perdue deux fois dans
   * l'année est **une** carte perdue. Le chiffre annonce des cartes, pas des accidents.
   *
   * ⚠️ **`kind = 'maintenance'` est la borne qui rend ce compte juste**, et elle suffit :
   * une révision d'entretien n'existe que sur une carte qui était acquise **avant** la
   * note (CC-260 — `kind` dit d'où la carte venait, jamais où elle finit). Sans elle, le
   * 2ᵉ `hard` d'une carte jamais acquise entrerait dans le compte.
   *
   * ⚠️ **Aucun filtre de visibilité ici, et c'est volontaire** : ce sont les notes de
   * cette personne, sur des cartes qu'elle a forcément vues pour les noter. Joindre les
   * cartes ferait *disparaître du passé* une perte réelle le jour où quelqu'un dé-partage
   * son paquet.
   */
  async lostSince(userId: number, since: DateTime): Promise<number> {
    const result = await db.rawQuery(
      `SELECT count(DISTINCT leitner_card_id) AS lost
         FROM leitner_reviews
        WHERE user_id = ?
          AND kind = ?
          AND reviewed_at >= ?
          AND (grade = ? OR box_after < box_before)`,
      [userId, 'maintenance', since.toSQL()!, 'again']
    )

    return Number(result.rows[0].lost)
  }

  /**
   * Combien de paliers d'entretien chaque carte a déjà consommés depuis son acquisition —
   * le `rank` de `maintenanceIntervalDays`, pour **toute une file** en une seule requête.
   *
   * ⚠️ **C'est le pendant en LECTURE de `LeitnerService.maintenanceRank`, et les deux
   * doivent compter la même chose** : même borne `reviewed_at >= mastered_at`, même `>=`
   * (voir le docblock de l'autre — la note d'acquisition occupe le palier 0). Ce qu'on
   * annonce sous un bouton et ce qui s'écrira en base doivent être le même nombre, sans
   * quoi l'écran promet 90 jours pendant que la base en programme 180. Rien ne le
   * signalerait avant l'échéance suivante, des mois plus tard.
   *
   * ⚠️ **Une carte absente du résultat vaut 0, pas « inconnue »** : `group by` ne rend que
   * les cartes qui ont au moins une révision dans la fenêtre. C'est exactement le cas de
   * la carte acquise à l'instant, et 0 est sa vraie valeur.
   */
  async maintenanceRanks(userId: number, cardIds: number[]): Promise<Map<number, number>> {
    const ranks = new Map<number, number>()
    if (cardIds.length === 0) return ranks

    const result = await db.rawQuery(
      `SELECT r.leitner_card_id AS card_id, count(*) AS rank
         FROM leitner_reviews r
         JOIN leitner_card_progress p
           ON p.leitner_card_id = r.leitner_card_id AND p.user_id = r.user_id
        WHERE r.user_id = ?
          AND p.mastered_at IS NOT NULL
          AND r.reviewed_at >= p.mastered_at
          AND r.leitner_card_id IN (${cardIds.map(() => '?').join(', ')})
        GROUP BY r.leitner_card_id`,
      [userId, ...cardIds]
    )

    for (const row of result.rows) ranks.set(Number(row.card_id), Number(row.rank))
    return ranks
  }
}
