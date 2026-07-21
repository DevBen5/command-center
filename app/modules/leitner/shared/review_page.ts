/**
 * L'écran de révision (`pages/index.vue`) — le plafond de transport, la mesure du chrono
 * fantôme, et les libellés d'échéance des boutons.
 *
 * ⚠️ **Ce fichier vit ici parce qu'une constante ne peut pas être partagée depuis un `.vue`.**
 * `MEASURE_MAX_MS` était déclaré **deux fois** : dans `services/leitner_fluency.ts` — d'où le
 * validateur l'importait — et recopié dans `pages/index.vue`, qui ne pouvait pas l'importer.
 * Baisser le plafond serveur sans toucher la copie faisait poster une mesure au-dessus de la
 * borne : `POST /review` en **422**, et l'utilisateur cliquait une note sans que rien ne se
 * passe. Aucune erreur visible, aucun test rouge.
 *
 * ⚠️ **N'importe jamais par un alias `#modules/*` depuis ce dossier.** L'alias mappe vers
 * `./app/modules/*.js`, des fichiers qui n'existent qu'après un build : Vite ne les résout pas,
 * et la page casserait. C'est précisément ce qui interdisait à `index.vue` d'importer
 * `leitner_fluency.ts` — lequel est pourtant du code pur. Seuls le relatif et les paquets npm
 * purs sont permis ici. Le garde-fou est `npm run build` ; `tsc` ne lit pas les `.vue`.
 *
 * Ce fichier est **pur** : ni base, ni horloge, ni DOM, ni Vue. L'instant courant est un
 * **paramètre** — un `Date.now()` ici rendrait le test dépendant de l'horloge, donc instable ou
 * écrit pour ne rien prouver.
 */

/**
 * Le plafond **de transport** de la mesure — sans rapport avec `MAX_THINKING_MS` (120 s), qui
 * borne ce qui est *exploitable* et vit, lui, dans la règle.
 *
 * ⚠️ **Il existe pour qu'une mesure absurde ne fasse jamais échouer une note.** Un onglet laissé
 * ouvert trois heures produit onze millions de millisecondes ; envoyé tel quel à un validateur
 * plus serré, `POST /review` partirait en 422. La page écrête **avant** l'envoi, le validateur
 * borne à la même valeur — et c'est la même constante, désormais.
 *
 * ⚠️ **C'est l'unique déclaration, et un test la garde.** `leitner_review_page.spec.ts` relit
 * `pages/index.vue` et rougit si un littéral `3_600_000` y réapparaît.
 */
export const MEASURE_MAX_MS = 3_600_000

/** L'état du chrono fantôme au moment où l'on transmet — quatre valeurs, jamais positionnelles. */
export interface FluencyState {
  presentedAt: number
  /** `null` tant que rien n'a été tapé : c'est cette absence qui vaut « non mesurable ». */
  firstInputAt: number | null
  /** Le dévoilement fige le temps total ; `null` tant qu'il n'a pas eu lieu. */
  revealedAt: number | null
  /** Le document masqué ou la fenêtre défocalisée **avant** la première frappe. */
  interrupted: boolean
}

export interface FluencyMeasure {
  thinkingMs: number | null
  totalMs: number | null
  interrupted: boolean
}

/**
 * Une durée écrêtée, ou **`null` si elle n'a pas de sens**.
 *
 * ⚠️ **Une durée négative se rend `null`, surtout pas `0`.** Une correction NTP, une reprise de
 * machine virtuelle ou un changement d'heure manuel entre l'affichage et la frappe recule
 * l'horloge : ramener ça à zéro donnerait la **meilleure valeur possible**, donc `easy` proposé
 * et un `0` écrit en base qui tirerait la médiane de la carte vers le bas durablement. Une
 * mesure qu'on n'a pas ne vaut pas zéro.
 *
 * ⚠️ **L'écrêtage haut n'est pas cosmétique non plus** — voir `MEASURE_MAX_MS`.
 */
export function duration(from: number, to: number): number | null {
  const elapsed = to - from
  return elapsed < 0 ? null : Math.min(MEASURE_MAX_MS, elapsed)
}

/**
 * Les mesures à transmettre : c'est le serveur qui juge de leur validité, et lui seul.
 *
 * ⚠️ **L'état arrive en objet nommé, jamais en quatre nombres positionnels.** C'est la seule
 * précaution qui rende l'extraction sûre : l'enveloppe de la page est la couture que ce
 * découpage crée, et deux timestamps intervertis y seraient invisibles — module vert, page
 * fausse, `easy` proposé sur une carte qu'on vient de rater.
 *
 * `now` ne sert qu'au cas où le verso n'a pas encore été dévoilé.
 */
export function fluencyMeasure(state: FluencyState, now: number): FluencyMeasure {
  return {
    thinkingMs:
      state.firstInputAt === null ? null : duration(state.presentedAt, state.firstInputAt),
    totalMs: duration(state.presentedAt, state.revealedAt ?? now),
    interrupted: state.interrupted,
  }
}

/**
 * Les intervalles réglés, envoyés par le serveur (`BOX_INTERVAL_DAYS`).
 *
 * ⚠️ La page ne les redéclare **jamais** : ils vivent en base et se règlent depuis
 * `/revision/settings`.
 */
export type BoxIntervals = Record<number, number>

/** « tous les jours » / « tous les 4 j » — libellé de la grille des boîtes. */
export function boxIntervalLabel(intervals: BoxIntervals, box: number): string {
  const days = intervals[box] ?? 0
  return days === 1 ? 'tous les jours' : `tous les ${days} j`
}

/** « demain » / « dans 4 j » — échéance annoncée par un bouton de note. */
export function dueLabel(intervals: BoxIntervals, box: number): string {
  const days = intervals[box] ?? 0
  return days === 1 ? 'demain' : `dans ${days} j`
}
