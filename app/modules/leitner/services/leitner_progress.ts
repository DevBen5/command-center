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
 * « Cette carte n'est pas (ou plus) maîtrisée » — l'**unique copie** de cette condition
 * (CC-261).
 *
 * ⚠️ **Elle est vraie sans ligne de progression**, et il ne faut surtout pas l'« armer »
 * d'un `coalesce` : la jointure étant externe, `ucp.mastered_at` vaut `null` pour une
 * carte que personne n'a notée — ce qui veut bien dire « pas maîtrisée ». Une carte neuve
 * doit rester dans la file normale, c'est tout le principe de ce fichier.
 */
const NOT_MASTERED = `${P}.mastered_at is null`

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
 * qui n'ont aucune progression — **et qui ne sont pas maîtrisées** (CC-261).
 *
 * ⚠️ **Le jour est celui du process Node, jamais `CURRENT_DATE`.** Le fuseau de Postgres
 * et celui de Node divergeraient au voisinage de minuit, et la file ne dirait plus la
 * même journée que la série ou la heatmap — qui se découpent en JS depuis CC-46. Deux
 * chiffres plausibles qui se contredisent, et rien pour le signaler.
 *
 * ⚠️ **L'exclusion des maîtrisées est ICI, et c'est la seule forme qui tienne** (CC-261).
 * Quatre lectures posent la question « qu'est-ce qui est dû ? », dont **deux vivent hors
 * du module** : la file (`LeitnerService.dueCards`), la pastille de la barre latérale
 * (`NavStatsService`), la carte d'accueil (`HomeController`) et les comptes de l'écran de
 * choix (`LeitnerService.dueScopeChoices`). Toutes appellent exactement la même paire
 * `joinProgress` + `whereDue` : un seul point de modification, les quatre suivent **par
 * construction**. Une carte qui disparaîtrait d'un compteur sans disparaître d'un autre
 * ne lèverait aucune erreur — et la réponse à ce risque n'est pas « penser à mettre à
 * jour les quatre », c'est qu'aucun appelant n'ait le choix. C'est aussi ce qui protège
 * le compteur que quelqu'un ajoutera dans six mois.
 */
export function whereDue(query: CardQuery, today: DateTime): void {
  const day = today.toSQLDate()!
  query.whereRaw(`coalesce(${P}.next_review, ?::date) <= ?::date and ${NOT_MASTERED}`, [day, day])
}

/**
 * Les cartes **d'entretien** dues pour cette personne (CC-261) : le pendant exact de
 * `whereDue`, de l'autre côté de la ligne de partage. Les deux files sont **disjointes**
 * par construction — l'une exige `mastered_at is null`, l'autre `is not null` — donc
 * aucune carte ne peut être due deux fois, et rien à synchroniser entre elles.
 *
 * ⚠️ **Aucun `coalesce` ici, et ce n'est pas un oubli** : `mastered_at is not null`
 * implique qu'une ligne de progression existe, or `next_review` y est `notNullable`. Le
 * `coalesce` de `whereDue` ne sert qu'à donner sa valeur à l'**absence** de ligne (« due
 * aujourd'hui ») — un cas qui ne peut pas se présenter ici.
 */
export function whereMaintenanceDue(query: CardQuery, today: DateTime): void {
  query.whereRaw(`${P}.mastered_at is not null and ${P}.next_review <= ?::date`, [
    today.toSQLDate()!,
  ])
}

/**
 * « Écarte les cartes maîtrisées », sans rien dire de l'échéance (CC-261).
 *
 * ⚠️ **Elle existe pour `boxCounts`, le seul compteur du module qui ne passe PAS par
 * `whereDue`** — il compte ce qui est dans chaque boîte, dû ou non. Sans elle, la tuile
 * « boîte 5 » annoncerait des cartes qu'aucun clic n'atteint plus. Elle vit ici, et pas
 * dans un `where` écrit chez l'appelant, pour que l'alias de la jointure reste privé à ce
 * fichier : une seconde formulation de « maîtrisée » finirait par diverger de celle de
 * `whereDue`.
 */
export function whereNotMastered(query: CardQuery): void {
  query.whereRaw(NOT_MASTERED)
}

/**
 * « Cette carte est un acquis » — l'exact contraire de `whereNotMastered` (CC-262).
 *
 * ⚠️ **Elle ne dit rien de l'échéance**, contrairement à `whereMaintenanceDue` : un
 * inventaire d'acquis liste **tout** ce qui est acquis, y compris ce dont l'entretien
 * n'est pas dû avant des mois — c'est même l'essentiel de ce qu'il montre. Confondre les
 * deux réduirait l'inventaire aux seules cartes en retard, c'est-à-dire à l'inverse de ce
 * qu'il célèbre.
 *
 * Elle vit ici, comme ses trois sœurs, pour que l'alias de la jointure reste privé à ce
 * fichier : une seconde formulation de « maîtrisée » finirait par diverger de `whereDue`.
 */
export function whereMastered(query: CardQuery): void {
  query.whereRaw(`${P}.mastered_at is not null`)
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

/**
 * L'ordre de l'**inventaire d'acquis** : la plus récemment acquise d'abord (CC-262).
 *
 * ⚠️ Elle vit ici et non chez l'appelant pour la même raison que `whereMastered` : l'alias
 * de la jointure reste privé à ce fichier. Un `orderByRaw('ucp.…')` écrit ailleurs
 * casserait le jour où l'alias change, et il casserait **en silence** — un `order by` sur
 * une colonne inconnue lève, mais un alias renommé dans un seul des deux endroits ne se
 * voit qu'à l'exécution de la requête concernée.
 */
export function orderByMasteredAt(query: CardQuery): void {
  query.orderByRaw(`${P}.mastered_at desc`).orderBy('leitner_cards.id', 'desc')
}

/** Le filtre « boîte N » du catalogue, appliqué à la progression de cette personne. */
export function whereBox(query: CardQuery, box: number): void {
  query.whereRaw(`coalesce(${P}.box, ?) = ?`, [DEFAULT_BOX, box])
}

/** Le filtre « coincée en boîte 1-2 » de l'onglet Stats. */
export function whereBoxAtMost(query: CardQuery, box: number): void {
  query.whereRaw(`coalesce(${P}.box, ?) <= ?`, [DEFAULT_BOX, box])
}
