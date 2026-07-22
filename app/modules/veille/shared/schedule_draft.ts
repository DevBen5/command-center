/**
 * Le brouillon de cadence de `pages/sources.vue` — ses prédicats et la forme de son payload.
 *
 * ⚠️ **Ce fichier vit ici pour être atteignable par la suite de tests, pas par goût du
 * découpage.** Japa importe des `.ts` et n'a aucun compilateur Vue : tout ce qui reste dans un
 * `<script setup>` est structurellement hors de sa portée. Les fonctions ci-dessous décident
 * si un enregistrement part ou non — c'est exactement ce qui doit pouvoir rougir.
 *
 * ⚠️ **N'importe jamais par un alias `#modules/*` depuis ce dossier.** L'alias mappe vers
 * `./app/modules/*.js`, des fichiers qui n'existent qu'après un build : Vite ne les résout pas,
 * et la page casserait. Seuls le relatif (`./interval.js`) et les paquets npm purs sont permis.
 * Le garde-fou est `npm run build` — `tsc` ne lit pas les `.vue` et ne peut pas le dire.
 *
 * Ce fichier est **pur** : ni base, ni horloge, ni DOM, ni Vue. La page ne garde que des
 * enveloppes d'une ligne, qui lui passent son état.
 */

import {
  formatQuantity,
  normalizeTimeOfDay,
  parseTimeOfDay,
  toMinutes,
  unitBounds,
  type IntervalUnit,
  type ScheduleMode,
} from './interval.js'

/**
 * La cadence en cours d'édition — jamais convertie côté page.
 *
 * Les deux modes coexistent dans le brouillon même si un seul s'applique : basculer de l'un à
 * l'autre ne doit pas effacer ce qui était saisi dans le premier.
 */
export interface ScheduleDraft {
  scheduleMode: ScheduleMode
  interval: number
  intervalUnit: IntervalUnit
  dailyAt: string
}

/**
 * Ce que `isScheduleDirty` a besoin de savoir d'une source **enregistrée**, et rien de plus.
 *
 * ⚠️ Volontairement structurel plutôt que le `VeilleSource` de la page — c'est ce qui garde ce
 * fichier sans dépendance : la source de la page s'y passe telle quelle (typage structurel), et
 * un test se contente d'objets nus.
 */
export interface StoredSchedule {
  scheduleMode: ScheduleMode
  dailyAt: string | null
  fetchIntervalMinutes: number
}

/** Le brouillon est-il enregistrable ? Chaque mode a sa propre règle, et une seule s'applique. */
export function isDraftValid(draft: ScheduleDraft): boolean {
  if (draft.scheduleMode === 'daily') {
    return parseTimeOfDay(draft.dailyAt) !== null
  }
  const { min, max } = unitBounds(draft.intervalUnit)
  return Number.isInteger(draft.interval) && draft.interval >= min && draft.interval <= max
}

/**
 * Ce qui part au serveur. Le mode voyage **toujours**, et seuls les champs du mode retenu
 * l'accompagnent : poster une heure sur une source en mode intervalle enregistrerait un réglage
 * qui ne s'applique pas.
 */
export function schedulePayload(draft: ScheduleDraft): Record<string, unknown> {
  if (draft.scheduleMode === 'daily') {
    return { scheduleMode: 'daily', dailyAt: draft.dailyAt }
  }
  return {
    scheduleMode: 'interval',
    interval: draft.interval,
    intervalUnit: draft.intervalUnit,
  }
}

/** « de 1 à 7 jours » — dit la règle avant qu'on la viole, plutôt qu'après. */
export function boundsHint(unit: IntervalUnit): string {
  const { min, max } = unitBounds(unit)
  return `de ${min} à ${formatQuantity(max, unit)}`
}

/**
 * Changement d'unité : on convertit la durée **si elle tombe juste** (60 minutes → 1 heure),
 * sinon on garde le nombre tel quel (90 minutes → 90 heures). Jamais d'arrondi : « 1,5 heure »
 * se saisit en 90 minutes.
 *
 * ⚠️ Le `<select>` n'est donc pas en `v-model` — il faut lire l'ancienne unité avant qu'elle
 * ne soit écrasée.
 *
 * ⚠️ **Elle mute son brouillon au lieu d'en rendre un neuf, et c'est délibéré.** Rendre une
 * copie obligerait les deux `@change` du template à réassigner — dont celui du formulaire
 * d'ajout, dont le brouillon porte aussi `url` et `title`. Or le template est justement ce que
 * ce lot ne couvre pas : on ne le remue pas pour une élégance qui n'achète aucun test. Muter
 * n'empêche rien ici — un objet nu en entrée, une assertion après, et la fonction est prouvée.
 */
export function switchUnit(draft: ScheduleDraft, next: IntervalUnit): void {
  const minutes = toMinutes(draft.interval, draft.intervalUnit)
  const factor = toMinutes(1, next)

  if (minutes > 0 && minutes % factor === 0) {
    draft.interval = minutes / factor
  }
  draft.intervalUnit = next
}

/**
 * La cadence est-elle différente de ce qui est enregistré ? Le mode compte autant que la valeur.
 *
 * ⚠️ **`normalizeTimeOfDay` sur la valeur STOCKÉE est ce qui fait tenir la comparaison**, et
 * c'est le mode d'échec silencieux que ce fichier existe pour rendre testable. Postgres rend
 * `'07:00:00'` là où le champ manipule `'07:00'` : comparer les deux valeurs brutes est
 * **toujours** vrai, et le bouton *Enregistrer* ne disparaît plus jamais. Normaliser du mauvais
 * côté produit l'inverse — le bouton n'apparaît jamais, et la cadence devient non modifiable.
 * Dans les deux cas, typecheck, lint, build et la suite fonctionnelle restent verts.
 */
export function isScheduleDirty(draft: ScheduleDraft, source: StoredSchedule): boolean {
  if (draft.scheduleMode !== source.scheduleMode) return true

  if (draft.scheduleMode === 'daily') {
    return draft.dailyAt !== normalizeTimeOfDay(source.dailyAt)
  }
  return toMinutes(draft.interval, draft.intervalUnit) !== source.fetchIntervalMinutes
}
