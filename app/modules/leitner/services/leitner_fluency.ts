import { median } from '#modules/leitner/services/leitner_sessions'
import type { Grade, Verdict } from '#modules/leitner/services/leitner_service'

/*
|------------------------------------------------------------------------------
| La fluence de rappel : le temps AFFINE la proposition, il ne la décide pas
|------------------------------------------------------------------------------
|
| Le juge (`LeitnerJudgeService`) sait une chose : juste, partiel ou faux. Il laisse
| donc `hard`, `good` et `easy` indistincts — tous trois sont « juste ». Le **temps
| de réponse** est un proxy réel de la force du souvenir, et c'est lui qui récupère
| les trois nuances perdues.
|
| ⚠️ **Ce fichier est du CODE PUR** — aucune base, aucune horloge, aucun DOM. C'est
| ce qui le rend unitairement testable, et c'est ici que vit la règle du lot : la
| partie base (aller chercher la référence) est dans `LeitnerFluencyService`, et le
| chronométrage lui-même dans `pages/index.vue`, qui ne décide de rien.
|
| ⚠️ **Le chrono est FANTÔME : il ne s'affiche jamais.** Un chrono visible change le
| comportement qu'il prétend mesurer — il stresse et fait bâcler la réponse. Ne
| l'expose pas « pour que l'utilisateur comprenne la suggestion ».
|
| ⚠️ **La fluence ne rend jamais la note automatique.** Une réponse devinée est rapide
| et juste : le timer dira `easy`, le juge dira `juste`, et seul l'utilisateur sait
| qu'il a deviné. C'est l'argument irréductible — la confirmation reste, comme depuis
| CC-43, et elle porte aussi la neutralisation de l'injection de prompt.
*/

/**
 * Au-delà, la mesure ment. Le téléphone sonne, on part chercher un café, on se
 * détourne : huit secondes deviennent quatre cents.
 *
 * ⚠️ **Ni ce plafond ni la détection d'interruption ne suffisent, et il faut savoir
 * lequel couvre quoi.** `visibilitychange` ne se déclenche pas quand on bascule vers une
 * autre application (l'onglet reste visible), et *aucun* événement ne part quand
 * l'utilisateur quitte simplement sa machine des yeux. Ce plafond attrape les
 * distractions **longues** ; la page attrape celles que le navigateur sait nommer.
 *
 * ⚠️ **Il reste donc une bande découverte : 20 à 120 s de distraction silencieuse.**
 * C'est la fenêtre la plus courante, et la seule qui produise un `hard` **plausible** —
 * donc invisible. C'est la limite réelle du lot : la proposition reste confirmable, et
 * une mesure isolée ne déplace pas une médiane. Ne la fais pas passer pour couverte.
 */
export const MAX_THINKING_MS = 120_000

/*
 * ⚠️ **`MEASURE_MAX_MS` ne vit plus ici** — il est dans `shared/review_page.ts` (CC-60).
 * Ce fichier est du code pur, mais il s'importe par l'alias `#modules/*`, que Vite ne résout
 * pas : la page en gardait donc une **copie**, et baisser le plafond d'un seul côté envoyait
 * `POST /review` en 422 sans qu'aucun test ne rougisse. `shared/` est le seul endroit que le
 * serveur et la page atteignent tous les deux. Ne le redéclare pas ici « pour le rapprocher de
 * `MAX_THINKING_MS` » : les deux plafonds n'ont rien à voir, seul le second borne la règle.
 */

/** Mesures nécessaires sur la carte elle-même pour qu'elle soit sa propre référence. */
export const MIN_CARD_SAMPLES = 5

/**
 * Mesures nécessaires sur une boîte pour qu'elle serve de référence de repli. Plus
 * exigeant que pour une carte, et ce n'est pas de la prudence : une boîte agrège des
 * cartes de longueurs et de difficultés très différentes, sa médiane est donc bien
 * plus bruitée que celle d'une carte unique.
 */
export const MIN_BOX_SAMPLES = 20

/**
 * Sous ce plancher, aucune proposition affinée — **quelle que soit la quantité de
 * mesures**.
 *
 * ⚠️ Ce garde-fou ne vient pas du ticket, il vient de l'arithmétique des ratios. Une
 * carte à réponse d'un mot (« quel port pour Postgres ») a une médiane vers 1,5 s :
 * les seuils tomberaient à 0,9 s et 2,4 s, et on classerait `easy` ou `hard` sur du
 * bruit de frappe. Il n'y a pas de nuance à récupérer sur une carte qu'on répond en
 * une seconde et demie.
 */
export const MIN_REFERENCE_MS = 2_000

/**
 * Les deux ratios qui découpent « rapide » et « lent » autour de la référence.
 *
 * ⚠️ **Relatifs, jamais absolus, et c'est le cœur du lot.** Dix secondes sont rapides
 * pour « explique le théorème CAP » et très lentes pour « quel port pour Postgres » :
 * un seuil en secondes n'a aucun sens. Ces deux valeurs sont des **conventions**, au
 * même titre que `SESSION_GAP_MINUTES` — elles ne se vérifient qu'à l'usage, sur
 * plusieurs semaines de mesures réelles.
 */
export const FAST_RATIO = 0.6
export const SLOW_RATIO = 1.6

/**
 * Ce que la page a chronométré. Elle mesure et transmet ; elle ne conclut rien.
 *
 * ⚠️ **Tout est DÉCLARATIF** — voir l'avertissement de `refineGrade`.
 */
export interface FluencyMeasure {
  /** De l'affichage à la première frappe. `null` si personne n'a rien tapé. */
  thinkingMs: number | null
  /** Le document a été masqué ou la fenêtre défocalisée **avant** la première frappe. */
  interrupted: boolean
  /**
   * La carte a déjà été notée aujourd'hui. **Tranché par le serveur, jamais par la
   * page** : depuis CC-41, `again` redonne la carte quelques minutes plus tard, et la
   * seconde réponse est rapide par mémoire de travail, pas par apprentissage.
   * Proposer `easy` reviendrait à promouvoir une carte qu'on vient de rater.
   */
  represented: boolean
}

/**
 * La mesure est-elle comparable à d'autres ?
 *
 * ⚠️ **Ces trois conditions gouvernent à la fois la proposition ET l'écriture en base**,
 * et elles ne peuvent pas diverger : écrire une mesure de re-présentation ferait dériver
 * la médiane de la carte vers le bas (mémoire de travail), et une carte mal sue finirait
 * par se voir proposer `easy`. C'est ce couplage qui permet de lire `thinking_ms` sans
 * jamais filtrer.
 *
 * L'écriture (`LeitnerService.review`) en ajoute **une quatrième** que la proposition n'a
 * pas à connaître : il faut qu'une réponse ait été écrite. Le juge, lui, n'est jamais
 * appelé sans réponse — la question ne s'y pose donc pas.
 *
 * ⚠️ Ce qu'aucune des deux ne filtre : **le verdict**. Une réponse fausse est mesurée et
 * historisée comme les autres, et entre dans la médiane. C'est délibéré — « combien de
 * temps cette carte met à venir » inclut les fois où elle n'est pas venue, et filtrer
 * réduirait le vivier au point de repousser encore l'utilité du lot. Seule la
 * *proposition* est réservée à `juste`, parce que là, la vitesse ne dit rien.
 */
export function isUsableMeasure(measure: FluencyMeasure): measure is FluencyMeasure & {
  thinkingMs: number
} {
  if (measure.thinkingMs === null) return false
  if (measure.represented || measure.interrupted) return false
  return measure.thinkingMs >= 0 && measure.thinkingMs <= MAX_THINKING_MS
}

/**
 * La référence à laquelle comparer : la carte si elle se connaît assez, sa boîte
 * sinon, **et rien du tout en dernier recours**.
 *
 * ⚠️ Ce `null` est le comportement normal des premières semaines, pas une panne : sans
 * historique, ce lot n'a rien à comparer et retombe en silence sur la présélection de
 * CC-43. Un seuil inventé vaudrait moins que pas de seuil.
 *
 * ⚠️ **La médiane de boîte est biaisée sur DEUX axes, sciemment.**
 *
 * 1. *La longueur du recto.* Le temps jusqu'à la première frappe inclut la lecture de
 *    la question : une carte verbeuse est structurellement plus lente. Contre sa
 *    *propre* médiane le biais s'annule (le recto ne change pas) ; contre sa boîte, non.
 * 2. *L'âge des mesures.* `leitner_reviews` ne porte pas de boîte : la requête attribue
 *    chaque mesure à la boîte où sa carte se trouve **aujourd'hui**, pas à celle où elle
 *    était le jour de la mesure. Les cartes montent avec le temps, donc le vivier d'une
 *    boîte haute est dominé par des mesures prises **plus bas**, quand ces cartes
 *    étaient moins sues — donc plus lentes. La référence des boîtes hautes est
 *    systématiquement gonflée, et une carte fraîchement promue y paraît rapide.
 *
 * Les deux vont dans le sens d'un `easy` sur-proposé en boîte haute. Accepté, et
 * borné : ce repli ne sert que tant que la carte n'a pas `MIN_CARD_SAMPLES` mesures à
 * elle, et la proposition reste confirmable. Le corriger demanderait une colonne `box`
 * sur `leitner_reviews` — vide pour tout l'historique existant, donc un lot à part.
 */
export function pickReference(cardSamples: number[], boxSamples: number[]): number | null {
  const source =
    cardSamples.length >= MIN_CARD_SAMPLES
      ? cardSamples
      : boxSamples.length >= MIN_BOX_SAMPLES
        ? boxSamples
        : null

  if (source === null) return null

  // `median` (leitner_sessions.ts) porte déjà le comparateur numérique — sans lui,
  // `[9, 10, 100].sort()` rend `[10, 100, 9]` et donc une médiane fausse et crédible.
  const reference = median(source)
  if (reference === null || reference < MIN_REFERENCE_MS) return null

  return reference
}

/**
 * La proposition affinée. **Elle ne fait que déplacer un surlignage** : les quatre
 * boutons restent cliquables, et c'est la note cliquée qui pilote Leitner.
 *
 * Deux invariants que ce lot ne doit jamais franchir :
 *
 * 1. ⚠️ **Seul `juste` est affiné.** `faux → again` et `partiel → hard` ne bougent pas :
 *    la vitesse ne dit rien de la justesse d'une réponse fausse, et `again` reste hors
 *    d'atteinte du timer — le contraire ferait rétrograder sur un chrono.
 * 2. ⚠️ **Sans référence exploitable, on rend exactement ce que CC-43 rendait**, en
 *    silence, sans badge et sans message. « Aucune proposition affinée » doit être
 *    indiscernable de « ce lot n'existe pas ».
 *
 * ⚠️ **`thinkingMs` est DÉCLARATIF, et la doctrine du module s'arrête ici.**
 * `source`/`sourceName` de l'ingestion, puis `verdict`/`latencyMs` de CC-43, étaient
 * sûrs parce qu'ils **ne calculaient rien**. Celui-ci calcule : il choisit le bouton
 * mis en avant, et il alimente la référence des propositions futures. Ce qui le rend
 * acceptable est plus étroit — la proposition n'est **jamais appliquée sans
 * confirmation**, la valeur est bornée, et un client qui mentirait ne dégraderait que
 * **ses propres** suggestions, sur un tableau de bord mono-utilisateur. Le jour où une
 * règle lirait cette colonne pour décider d'une boîte, c'est ce raisonnement-là qu'il
 * faudrait rouvrir.
 */
export function refineGrade(
  verdict: Verdict | null,
  baseGrade: Grade | null,
  measure: FluencyMeasure,
  reference: number | null
): Grade | null {
  if (verdict !== 'juste') return baseGrade
  if (reference === null) return baseGrade
  if (!isUsableMeasure(measure)) return baseGrade

  if (measure.thinkingMs <= reference * FAST_RATIO) return 'easy'
  if (measure.thinkingMs >= reference * SLOW_RATIO) return 'hard'
  return baseGrade
}
