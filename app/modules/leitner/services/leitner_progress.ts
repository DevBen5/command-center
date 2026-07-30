import type { DateTime } from 'luxon'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type LeitnerCard from '#modules/leitner/models/leitner_card'

type CardQuery = ModelQueryBuilderContract<typeof LeitnerCard, LeitnerCard>

/**
 * La progression d'une personne, greffée sur une requête de cartes — **l'unique copie**
 * de cette jointure, comme `applyScope` est l'unique copie de la sous-requête
 * catégorie → thèmes (CC-119).
 *
 * ⚠️ **La jointure est EXTERNE, et le `coalesce` n'est pas une commodité.** L'absence de
 * ligne de progression *est* une valeur — « boîte 1, due aujourd'hui » — c'est elle qui
 * donne à un compte neuf une file pleine sans qu'on ait rien semé, et à une carte créée
 * ce matin d'être due pour tout le monde sans re-semis. Une jointure interne, ou un
 * `where` sur la seule table de progression, rendrait invisibles **toutes** les cartes
 * jamais notées : l'écran de révision d'un nouveau venu serait vide, exactement le
 * symptôme que CC-77 corrige.
 */

/** L'alias de la table jointe. Toutes les colonnes ambiguës sont qualifiées avec lui. */
const P = 'ucp'

/** Boîte d'une carte que personne n'a encore notée. */
export const DEFAULT_BOX = 1

/**
 * `LEFT JOIN` de la progression de `userId`. À appeler **avant** tout `whereDue`,
 * `orderByQueue`, `whereBox` ou `selectWithBox` — ils lisent tous l'alias.
 *
 * ⚠️ **L'utilisateur est dans la condition de jointure, pas dans un `where`.** Mis en
 * `where`, il transformerait la jointure externe en jointure interne (les lignes sans
 * progression ont un `user_id` nul, qu'aucune égalité ne satisfait) et ferait disparaître
 * les cartes jamais notées — sans erreur, avec une file simplement plus courte.
 */
export function joinProgress(query: CardQuery, userId: number): void {
  query.leftJoin(`leitner_card_progress as ${P}`, (join) => {
    join.on(`${P}.leitner_card_id`, '=', 'leitner_cards.id').andOnVal(`${P}.user_id`, '=', userId)
  })
}

/**
 * Les colonnes de la carte **plus** sa boîte pour cette personne.
 *
 * ⚠️ **`leitner_cards.*` est obligatoire, et son oubli est le pire piège du lot.** Sans
 * lui, Lucid émet `select *` : les colonnes de la progression entrent dans le lot et
 * **`ucp.id` écrase `leitner_cards.id`**. Le typecheck reste vert, l'écran affiche des
 * cartes parfaitement plausibles — et noter la carte affichée écrit sur une autre.
 */
export function selectWithBox(query: CardQuery): void {
  query.select('leitner_cards.*').select(`${P}.box as progress_box`)
}

/**
 * La boîte lue sur une carte chargée par `selectWithBox`.
 *
 * ⚠️ **`undefined` et `null` ne veulent pas dire la même chose, et c'est tout l'intérêt
 * de passer par ici** : `null` est une jointure qui n'a rien trouvé (carte jamais notée
 * par cette personne → boîte 1), `undefined` est une requête écrite **sans** la jointure.
 * Le second est un bug, et il lève : rendre le défaut afficherait « boîte 1 » sur toutes
 * les cartes de l'écran — un chiffre faux, présenté comme un fait.
 */
export function progressBox(card: LeitnerCard): number {
  const box = card.$extras.progress_box
  if (box === undefined) {
    throw new Error(
      `La carte ${card.id} a été chargée sans sa progression : appelle joinProgress() ` +
        `puis selectWithBox() sur la requête.`
    )
  }
  return box === null ? DEFAULT_BOX : Number(box)
}

/**
 * Les cartes dues pour cette personne — c'est-à-dire dont l'échéance est passée **ou**
 * qui n'ont aucune progression.
 *
 * ⚠️ **Le jour est celui du process Node, jamais `CURRENT_DATE`.** Le fuseau de Postgres
 * et celui de Node divergeraient au voisinage de minuit, et la file ne dirait plus la
 * même journée que la série ou la heatmap — qui se découpent en JS depuis CC-46. Deux
 * chiffres plausibles qui se contredisent, et rien pour le signaler.
 */
export function whereDue(query: CardQuery, today: DateTime): void {
  const day = today.toSQLDate()!
  query.whereRaw(`coalesce(${P}.next_review, ?::date) <= ?::date`, [day, day])
}

/**
 * L'ordre de la file : la plus en retard d'abord ; à égalité, la moins récemment touchée.
 *
 * ⚠️ **Le second critère lit l'`updated_at` de la PROGRESSION, pas celui de la carte** —
 * c'est la traduction la plus fragile de CC-119. Depuis que noter n'écrit plus sur
 * `leitner_cards`, son `updated_at` ne bouge qu'à l'édition du contenu : s'y fier
 * laisserait une carte notée `again` — due le jour même, donc toujours en tête — se
 * re-présenter **en boucle**, session bloquée. Rien ne le signalerait : ni le typecheck,
 * ni aucun test qui n'assertirait pas l'ordre.
 *
 * ⚠️ **Ne trie jamais par boîte** : un `again` ne rétrograde pas, mais un tri par boîte
 * remettrait la carte ratée exactement où elle était — même boucle, autre cause.
 *
 * Le repli sur `leitner_cards.updated_at` sert les cartes jamais notées : leur âge est
 * tout ce qu'on sait d'elles, et il les place avant celles qu'on vient de rater.
 */
export function orderByQueue(query: CardQuery, today: DateTime): void {
  query
    .orderByRaw(`coalesce(${P}.next_review, ?::date) asc`, [today.toSQLDate()!])
    .orderByRaw(`coalesce(${P}.updated_at, leitner_cards.updated_at) asc`)
    .orderBy('leitner_cards.id', 'asc')
}

/** Le filtre « boîte N » du catalogue, appliqué à la progression de cette personne. */
export function whereBox(query: CardQuery, box: number): void {
  query.whereRaw(`coalesce(${P}.box, ?) = ?`, [DEFAULT_BOX, box])
}

/** Le filtre « coincée en boîte 1-2 » de l'onglet Stats. */
export function whereBoxAtMost(query: CardQuery, box: number): void {
  query.whereRaw(`coalesce(${P}.box, ?) <= ?`, [DEFAULT_BOX, box])
}
