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

/**
 * « aujourd'hui » / « demain » / « dans 90 j » — l'échéance annoncée par un bouton de note,
 * à partir d'un **nombre de jours** (CC-262).
 *
 * ⚠️ **`0` se dit « aujourd'hui », il ne se tait pas.** C'est le privilège d'`again` — la
 * carte reste dans la session — et c'est aussi ce que le bouton doit promettre. Rendre une
 * chaîne vide ferait disparaître la moitié de la phrase sans que rien ne le signale.
 *
 * ⚠️ **Elle prend des JOURS et non une boîte, et c'est ce qui a remplacé `dueLabel`** :
 * depuis CC-261 l'échéance d'une note ne se déduit plus toujours d'une boîte — une carte
 * acquise revient au rythme de l'échelle d'entretien (90, 180, 365 j), pas à celui de la
 * boîte 5. Une fonction qui prend une boîte ne *peut pas* dire cette échéance-là, et c'est
 * exactement ce qui rendait l'ancien libellé faux sans que rien ne le signale. Le nombre
 * de jours, lui, vient de `gradeOutcomes`, donc de la règle elle-même.
 */
export function dueInLabel(days: number): string {
  if (days <= 0) return "aujourd'hui"
  return days === 1 ? 'demain' : `dans ${days} j`
}

/**
 * Ce que le serveur a calculé pour une note — voir `services/leitner_grade_outcomes.ts`,
 * qui **importe ce type d'ici**. La page ne recalcule rien : elle choisit une phrase.
 *
 * ⚠️ **Une seule déclaration, et c'est le côté PAGE qui la porte** — l'inverse ne marche
 * pas : un fichier de `shared/` ne peut pas importer par un alias `#modules/*` (Vite ne le
 * résout pas), alors qu'un service, lui, importe très bien de `shared/` — c'est déjà ce que
 * fait le validateur avec `PREVIEW_MAX_CHARS`. Recopiée des deux côtés, cette forme
 * divergerait au premier champ ajouté : le serveur enverrait autre chose que ce que la page
 * lit, sans que `tsc` ne voie rien (il ne lit pas les `.vue`).
 */
export interface GradeOutcome {
  grade: 'again' | 'hard' | 'good' | 'easy'
  /** La boîte **après** la note. */
  box: number
  /** La carte sera-t-elle un acquis après cette note ? */
  mastered: boolean
  /**
   * Dans combien de jours elle reviendra. **`0` veut dire aujourd'hui**, et c'est une
   * valeur, pas une absence : c'est tout le privilège d'`again`.
   */
  days: number
}

/** La clé i18n d'un bouton et ses variables — jamais la phrase elle-même. */
export interface GradeHint {
  key: string
  params: Record<string, string | number>
}

/**
 * **Quelle phrase annonce l'effet d'une note** (CC-262). Pure : elle ne lit ni horloge, ni
 * réglage, ni base — tout vient de l'`outcome` calculé par la règle elle-même.
 *
 * ⚠️ **Elle rend une CLÉ, pas un texte.** Les libellés du module vivent dans
 * `i18n/fr.json` ; construire la phrase ici la rendrait intraduisible et invisible du test
 * qui vérifie que toute clé écrite dans un template existe.
 *
 * Les quatre cas qui ne se devinent pas, et qu'aucun test d'apparence ne pourrait
 * attraper :
 *
 * - une note qui **acquiert** la carte n'annonce pas une boîte mais un entretien (90 j au
 *   premier palier, pas les 30 j de la boîte 5) ;
 * - `again` **en entretien** ne dit pas « reste boîte 5 » : la carte *sort des acquis* et
 *   revient dans la file normale, aujourd'hui ;
 * - le 2ᵉ `hard` d'affilée sur un acquis le fait tomber en boîte 1 **et** sortir des
 *   acquis — deux effets, une seule phrase ;
 * - tout le reste est exactement ce qui s'affichait avant ce lot.
 *
 * @param card L'état **avant** la note : `mastered` (celui d'`outcome` est celui d'après —
 *   confondre les deux inverserait la phrase la plus importante de l'écran) et `lastGrade`,
 *   qui seul distingue le 2ᵉ `hard` d'affilée. ⚠️ **Ne déduis pas la rétrogradation d'une
 *   boîte 1 en sortie** : une carte *déjà* en boîte 1 y reste sur un `hard` isolé, et
 *   l'écran annoncerait « 2ᵉ d'affilée » sur la première.
 */
export function gradeHint(
  outcome: GradeOutcome,
  card: { mastered: boolean; lastGrade: GradeOutcome['grade'] | null }
): GradeHint {
  const { mastered, lastGrade } = card
  const due = dueInLabel(outcome.days)

  if (outcome.grade === 'again') {
    return mastered
      ? { key: 'leitner.index.grade.lostMasteryAgain', params: { box: outcome.box } }
      : { key: 'leitner.index.grade.againHint', params: { box: outcome.box } }
  }

  if (outcome.mastered) {
    return { key: 'leitner.index.grade.masteredHint', params: { due } }
  }

  if (mastered) {
    return { key: 'leitner.index.grade.lostMasteryHint', params: { box: outcome.box, due } }
  }

  if (outcome.grade === 'hard') {
    return lastGrade === 'hard'
      ? { key: 'leitner.index.grade.hardHintDemote', params: { due } }
      : { key: 'leitner.index.grade.hardHint', params: { box: outcome.box, due } }
  }

  return { key: 'leitner.index.grade.boxDue', params: { box: outcome.box, due } }
}
